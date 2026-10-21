import { createHash } from "node:crypto";
import { parseUnitDocument } from "@kintsugi/agents";
import { MEMBER_CONTEXT_POLICY_REVISION, evaluateReviewEvidence, type GateDeliverableEvidence, type GateEvidence, type GitLocation } from "@kintsugi/domain";
import { assertSafeRepoPath, runGit, type CheckoutStorage, type GitHubObservationConnection, type ObservedPullRequest, type PullRequestObserver } from "@kintsugi/git";
import type { Pool, PoolClient } from "pg";
import type { RepositoryStore } from "../git-sync/repositories.js";
import { syncRepository } from "../git-sync/sync.js";
import { reconcileGatePublication, type GateAuditProof, type GateDeliverableFact, type GateEffectiveDependencies, type GateMappedReviewer, type GatePublicationCandidate } from "./effective.js";

interface Dependencies {
  pool: Pool;
  repositories: RepositoryStore;
  storage: CheckoutStorage;
  observer: Pick<PullRequestObserver<GitHubObservationConnection>, "get">;
}
interface ProviderIdentity {
  server_id: string;
  provider_repository_id: string;
  provider_pull_request_id: string;
  pull_request_number: number;
}
interface ReviewRow extends ProviderIdentity {
  repository_id: string;
  review_id: string;
  currentness: GateDeliverableFact["review"]["currentness"];
  verdict: GateDeliverableFact["review"]["verdict"];
  coverage: GateDeliverableFact["review"]["coverage"];
  head_sha: string;
  context_revision: string;
  policy_revision: string;
}

/** Worker adapter: provider I/O happens before the short publication/event transaction. */
export class PostgresGateReconciler {
  readonly verification: GateEffectiveDependencies;
  constructor(private readonly deps: Dependencies) {
    this.verification = {
      readRecord: async location => {
        await syncRepository({ store: this.deps.repositories, storage: this.deps.storage }, location.repo);
        return this.readText(location);
      },
      auditEvent: id => this.auditEvent(id),
      currentContext: (projectId, unitId) => this.currentContext(projectId, unitId),
      deliverable: evidence => this.deliverable(evidence),
    };
  }

  async scan(log: (message: string) => void): Promise<void> {
    const candidates = await this.deps.pool.query<{ decision_id: string }>(
      `select decision_id from workflow.gate_publication
        where state in ('pending-publication','awaiting-merge') order by updated_at,decision_id limit 100`,
    );
    for (const candidate of candidates.rows) {
      try { await reconcileGatePublication({ pool: this.deps.pool, verification: this.verification, mergedRecord: row => this.mergedRecord(row), recheckAuthority: (client, evidence, reviewers) => this.recheckAuthority(client, evidence, reviewers) }, candidate.decision_id); }
      catch { log(`gate reconciliation ${candidate.decision_id}: retry pending`); }
      finally {
        // Rotate even blocked attempts; a pending publication must not starve the next batch.
        await this.deps.pool.query("update workflow.gate_publication set updated_at=clock_timestamp() where decision_id=$1 and state in ('pending-publication','awaiting-merge')",[candidate.decision_id]);
      }
    }
  }

  async recheckAuthority(client: PoolClient, evidence: GateEvidence, reviewers: readonly GateMappedReviewer[]): Promise<boolean> {
    const actor = await client.query<{ id: string }>(
      `select account.id from core.app_user account
         join admin.project_access access on access.project_id=$1 and access.user_id=account.id
         join core.user_role user_role on user_role.user_id=account.id
         join core.role_permission role_permission on role_permission.role_id=user_role.role_id and role_permission.permission_code='gates.decide'
        where account.id=$2 and account.enabled=true
        for share of account, access, user_role, role_permission`,
      [evidence.projectId, evidence.actor.userId],
    );
    if (actor.rows.length === 0) return false;
    for (const reviewer of reviewers) {
      const mapped = await client.query<{ user_id: string }>(
        `select mapping.user_id from workflow.member_provider_actor_mapping mapping
           join admin.project_access access on access.project_id=mapping.project_id and access.user_id=mapping.user_id
           join core.app_user account on account.id=mapping.user_id and account.enabled=true
          where mapping.project_id=$1 and mapping.server_id=$2 and mapping.provider_actor_id=$3 and mapping.user_id=$4
          for share of mapping, access, account`,
        [evidence.projectId, reviewer.serverId, reviewer.providerActorId, reviewer.reviewerId],
      );
      if (mapped.rows.length === 0) return false;
    }
    return true;
  }

  async mergedRecord(publication: GatePublicationCandidate): Promise<{ status: "merged"; location: GitLocation } | { status: "open" | "closed" | "unavailable" }> {
    const linked = await this.deps.pool.query<{repository_id:string}>(
      "select repository_id from admin.project_repository where project_id=$1 and role='document' and repository_id=$2",
      [publication.project_id,publication.document_repository_id],
    );
    if (linked.rows.length !== 1) return {status:"unavailable"};
    const connection = await this.deps.repositories.githubProviderConnection(publication.document_repository_id);
    if (connection === undefined || publication.pr_url === null) return { status: "unavailable" };
    const expected = new URL(`${connection.repositoryPath}/pull/`, new URL(connection.baseUrl).origin + "/");
    const url = new URL(publication.pr_url);
    const numberText = url.pathname.slice(expected.pathname.length);
    if (url.origin !== expected.origin || !url.pathname.startsWith(expected.pathname) || !/^[1-9][0-9]*$/.test(numberText) || url.search !== "" || url.hash !== "") return { status: "unavailable" };
    const found = await this.deps.pool.query<ProviderIdentity>(
      `select server_id,provider_repository_id,provider_pull_request_id,pull_request_number
         from workflow.member_provider_observation where repository_id=$1 and pull_request_number=$2`,
      [publication.document_repository_id, Number(numberText)],
    );
    const identity = found.rows[0];
    if (identity === undefined) return { status: "unavailable" };
    const observed = await this.observe(connection, identity);
    if (observed.htmlUrl !== publication.pr_url) return { status: "unavailable" };
    if (observed.state !== "merged") return { status: observed.state };
    if (observed.mergeCommitSha === undefined || await this.humanApproval(publication.project_id, identity.server_id, observed) === undefined) return { status: "unavailable" };
    return { status: "merged", location: { repo: publication.document_repository_id, commit: observed.mergeCommitSha, path: publication.record_path } };
  }

  private async observe(connection: GitHubObservationConnection, identity: ProviderIdentity): Promise<ObservedPullRequest> {
    return this.deps.observer.get(connection, {
      host: new URL(connection.baseUrl).hostname.toLowerCase(), repositoryPath: connection.repositoryPath,
      repositoryId: identity.provider_repository_id, pullRequestId: identity.provider_pull_request_id, number: identity.pull_request_number,
    });
  }

  private async readText(location: GitLocation): Promise<string | undefined> {
    assertSafeRepoPath(location.path);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(location.commit)) return undefined;
    const target = await this.deps.repositories.target(location.repo);
    if (target === undefined) return undefined;
    const mirror = this.deps.storage.mirror(target.serverId, target.id);
    try {
      const size = Number((await runGit(["cat-file", "-s", `${location.commit}:${location.path}`], { cwd: mirror })).stdout.trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > 512 * 1024) return undefined;
      return (await runGit(["show", `${location.commit}:${location.path}`], { cwd: mirror })).stdout;
    } catch { return undefined; }
  }

  private async auditEvent(id: string): Promise<GateAuditProof | undefined> {
    const found = await this.deps.pool.query<{ id: string; action: string; actor: string; project_id: string; subject: string; detail: Record<string, unknown> }>(
      `select e.id::text,e.action,e.actor,e.project_id,e.subject,e.detail
         from governance.audit_event e
         join core.app_user u on u.id=e.actor and u.enabled=true
         join admin.project_access access on access.project_id=e.project_id and access.user_id=e.actor
        where e.id::text=$1 and exists (
          select 1 from core.user_role ur join core.role_permission rp on rp.role_id=ur.role_id
           where ur.user_id=e.actor and rp.permission_code='gates.decide')`, [id],
    );
    const row = found.rows[0];
    return row === undefined ? undefined : { id: row.id, action: row.action, actor: row.actor, projectId: row.project_id, subject: row.subject, detail: row.detail };
  }

  private async currentContext(projectId: string, unitId: string): Promise<Awaited<ReturnType<GateEffectiveDependencies["currentContext"]>>> {
    const found = await this.deps.pool.query<{ context_revision: string; manifest: { policyRevision: string; sources: Array<{ repositoryId: string; path: string; contentHash?: string; availability: string }> }; repository_id: string; source_path: string }>(
      `select snapshot.context_revision,snapshot.manifest,task.repository_id,task.source_path
         from delivery.member_task_projection task
         join delivery.member_snapshot snapshot on snapshot.project_id=task.project_id and snapshot.unit_id=task.unit_id
        where task.project_id=$1 and task.unit_id=$2 and snapshot.activity='implementation'
        order by snapshot.created_at desc,snapshot.snapshot_id limit 1`, [projectId, unitId],
    );
    const row = found.rows[0];
    if (row === undefined || row.manifest.policyRevision !== MEMBER_CONTEXT_POLICY_REVISION || !Array.isArray(row.manifest.sources)) return undefined;
    const tips = new Map<string, string>();
    for (const source of row.manifest.sources) {
      if (!tips.has(source.repositoryId)) {
        const synced = await syncRepository({ store: this.deps.repositories, storage: this.deps.storage }, source.repositoryId);
        if (synced === undefined) return undefined;
        tips.set(source.repositoryId, synced.commit);
      }
      const text = await this.readText({ repo: source.repositoryId, commit: tips.get(source.repositoryId)!, path: source.path });
      if (source.availability === 'missing') { if (text !== undefined) return undefined; }
      else if (text === undefined || source.contentHash !== "sha256:" + createHash("sha256").update(text).digest("hex")) return undefined;
    }
    const tip = tips.get(row.repository_id);
    if (tip === undefined) return undefined;
    const text = await this.readText({ repo: row.repository_id, commit: tip, path: row.source_path });
    if (text === undefined) return undefined;
    const unit = parseUnitDocument(text, unitId);
    if (!unit.ok) return undefined;
    return { contextRevision: row.context_revision, policyRevision: row.manifest.policyRevision, requiredDeliverableIds: (unit.value.requiredDeliverables ?? []).map(item => item.id) };
  }

  private async deliverable(evidence: GateDeliverableEvidence): Promise<GateDeliverableFact | undefined> {
    const found = await this.deps.pool.query<ReviewRow & { project_id: string }>(
      `select association.server_id,association.repository_id,association.provider_repository_id,
              association.provider_pull_request_id,association.pull_request_number,association.project_id,
              review.review_id,review.currentness,review.verdict,review.coverage,review.head_sha,review.context_revision,review.policy_revision
         from workflow.member_task_pull_request association
         join delivery.member_task_projection task on task.project_id=association.project_id and task.unit_id=association.unit_id
         join admin.project_repository linked on linked.project_id=association.project_id and linked.repository_id=association.repository_id
          and (linked.role='document' or (linked.role='target' and linked.application_id=task.application_id))
         join workflow.member_review review on review.review_id=$4 and review.project_id=association.project_id
          and review.unit_id=association.unit_id and review.server_id=association.server_id
          and review.provider_repository_id=association.provider_repository_id
          and review.provider_pull_request_id=association.provider_pull_request_id and review.status='succeeded'
        where association.repository_id=$1 and association.provider_pull_request_id=$2
          and association.association_state='confirmed' and association.deliverable_ids @> jsonb_build_array($3::text)
          and not exists (select 1 from workflow.member_task_pull_request replacement
            where replacement.project_id=association.project_id and replacement.unit_id=association.unit_id
              and replacement.repository_id=association.repository_id and replacement.association_state='confirmed'
              and replacement.deliverable_ids @> jsonb_build_array($3::text) and replacement.updated_at>association.updated_at)
        limit 1`, [evidence.repositoryId, evidence.pullRequestId, evidence.deliverableId, evidence.reviewResultId],
    );
    const row = found.rows[0];
    if (row === undefined) return undefined;
    const connection = await this.deps.repositories.githubProviderConnection(evidence.repositoryId);
    if (connection === undefined) return undefined;
    const observed = await this.observe(connection, row);
    const approval = await this.humanApproval(row.project_id, row.server_id, observed);
    return {
      deliverableId: evidence.deliverableId, repositoryId: row.repository_id, pullRequestId: observed.pullRequestId, state: observed.state, headSha: observed.headSha,
      ...(observed.mergeCommitSha === undefined ? {} : { mergeCommitSha: observed.mergeCommitSha }),
      ...(observed.authorId === undefined ? {} : { authorProviderActorId: observed.authorId }),
      review: { reviewId: row.review_id, currentness: row.currentness, verdict: row.verdict, coverage: row.coverage, reviewedHead: row.head_sha, contextRevision: row.context_revision, policyRevision: row.policy_revision },
      ...(approval === undefined ? {} : { authorizedHumanApproval: approval }),
    };
  }

  private async humanApproval(projectId: string, serverId: string, observed: ObservedPullRequest): Promise<GateDeliverableFact["authorizedHumanApproval"]> {
    if (observed.authorId === undefined) return undefined;
    const mergedAt = observed.state === "merged" ? Date.parse(observed.mergedAt ?? "") : undefined;
    if (mergedAt !== undefined && !Number.isFinite(mergedAt)) return undefined;
    const found = await this.deps.pool.query<{ provider_actor_id: string; user_id: string }>(
      `select mapping.provider_actor_id,mapping.user_id from workflow.member_provider_actor_mapping mapping
         join admin.project_access access on access.project_id=mapping.project_id and access.user_id=mapping.user_id
         join core.app_user u on u.id=mapping.user_id and u.enabled=true
        where mapping.project_id=$1 and mapping.server_id=$2 and mapping.provider_actor_id<>$3`, [projectId, serverId, observed.authorId ?? ""],
    );
    const contextRevision = "sha256:" + "0".repeat(64);
    for (const mapping of found.rows) {
      const latestReviewAt = Math.max(...observed.reviews.filter(review => review.actorId === mapping.provider_actor_id).map(review => Date.parse(review.submittedAt ?? "")));
      if (mergedAt !== undefined && (!Number.isFinite(latestReviewAt) || latestReviewAt > mergedAt)) continue;
      const policy = evaluateReviewEvidence(
        { contextRevision, observedHeadSha: observed.headSha, evaluatedRevision: observed.headSha, coverage: "complete", observationComplete: true, checks: [], reviews: observed.reviews.map(review => ({ ...review, ...(review.actorId === undefined ? {} : { reviewerId: review.actorId }) })) }, { contextRevision, expectedHeadSha: observed.headSha, evaluatedRevision: observed.headSha, requiredChecks: [], requiredApprovals: 1, authorizedReviewerIds: [mapping.provider_actor_id], latestReviewablePush: true });
      if (policy.status === "satisfied") return { reviewerId: mapping.user_id, providerActorId: mapping.provider_actor_id, serverId, reviewedHead: observed.headSha, state: "APPROVED", hasProjectAccess: true };
    }
    return undefined;
  }
}
