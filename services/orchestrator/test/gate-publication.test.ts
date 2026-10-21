import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatGateRecord, gateEvidenceCanonicalJson, type GateEvidence } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { startGitHttpServer, type GitHttpServer } from "@kintsugi/git/testing";
import { PostgresGateReconciler } from "../src/gates/reconcile.js";
import type { ObservedPullRequest } from "@kintsugi/git";
import * as effective from "../src/gates/effective.js";
import { DocumentWriteStore } from "../src/document-write/store.js";
import { writeDocument } from "../src/document-write/writer.js";
import { RepositoryStore } from "../src/git-sync/repositories.js";
import { publishGate } from "../src/gates/publish.js";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./support/database.js";

const sha = (c: string) => c.repeat(40);
const path = "applications/web/units/core/invoice/reviews/G4.md";

describe.skipIf(!hasDatabase)("gate publication reconciliation with real writer and Postgres", () => {
  let db: TestDatabase;
  let remote: GitHttpServer;
  let storage: CheckoutStorage;
  let root: string;
  let providerState: "open" | "closed" | "merged" = "open";
  let recordCommit = sha("e");
  let number = 0;
  const repositories = () => new RepositoryStore(db.pool);
  beforeAll(async () => {
    db = await createTestDatabase();
    remote = await startGitHttpServer();
    await remote.createRepository("docs");
    root = await mkdtemp(join(tmpdir(), "kintsugi-gate-"));
    storage = new CheckoutStorage(root);
    await storage.prepare();
    await db.pool.query("insert into core.app_user (id,username,password_hash,password_salt) values ('human','human','test','test')");
    await db.pool.query("insert into admin.project (id,name) values ('shop','Shop')");
    await db.pool.query("insert into admin.git_server (id,kind,name,base_url,auth_type) values ('github','gitlab','GitLab','https://github.example.invalid','none')");
    await db.pool.query("insert into admin.git_repository (id,server_id,url,default_branch) values ('docs','github',$1,'main')", [remote.baseUrl + "/docs.git"]);
    await db.pool.query("insert into admin.project_repository (project_id,repository_id,role) values ('shop','docs','document')");
  });
  afterAll(async () => { await remote?.close(); await db?.drop(); if (root) await rm(root, { recursive: true, force: true }); });

  async function seed(prepare?: (evidence: GateEvidence) => void) {
    number++;
    providerState = "open";
    const evidence: GateEvidence = {
      schemaVersion: "1", decisionId: "gate_" + number.toString(16).padStart(48, "0"), projectId: "shop", unitId: "web/core/invoice", gateId: "G4", decision: "approved",
      auditEventId: "0", policyRevision: "member-context-v1", contextRevision: "sha256:" + "a".repeat(64),
      requiredDeliverableIds: ["code"], actor: { userId: "human", authorizationId: "session:" + "b".repeat(64) },
      deliverables: [{ deliverableId: "code", repositoryId: "target", pullRequestId: "7", reviewResultId: "review-7", reviewedRevision: sha("c"), mergedRevision: sha("d") }],
    };
    prepare?.(evidence);
    const evidenceHash = createHash("sha256").update(gateEvidenceCanonicalJson(evidence)).digest("hex");
    const audit = {
      action: "gate.decision.request", actor: "human", projectId: "shop", subject: evidence.decisionId,
      detail: { authorizationId: evidence.actor.authorizationId, gateId: "G4", decision: "approved", contextRevision: evidence.contextRevision, policyRevision: evidence.policyRevision, evidenceHash },
    };
    const auditRow = await db.pool.query<{ id: string }>("insert into governance.audit_event (action,actor,project_id,subject,detail) values ($1,$2,$3,$4,$5) returning id::text", [audit.action, audit.actor, audit.projectId, audit.subject, JSON.stringify(audit.detail)]);
    evidence.auditEventId = auditRow.rows[0]!.id;
    await db.pool.query("insert into workflow.document_write (id,project_id,kind,message) values ($1,'shop','state-change','Gate')", [evidence.decisionId]);
    await db.pool.query("insert into workflow.gate_publication (decision_id,project_id,unit_id,gate_id,decision,evidence,evidence_hash,document_repository_id,record_path,document_write_id,created_by) values ($1,'shop','web/core/invoice','G4','approved',$2,$3,'docs',$4,$1,'human')", [evidence.decisionId, JSON.stringify(evidence), evidenceHash, path]);
    const deps = {
      pool: db.pool,
      async mergedRecord() { return providerState === "merged" ? { status: "merged" as const, location: { repo: "docs", commit: recordCommit, path } } : { status: providerState }; },
      verification: {
        async readRecord() { return remote.git("docs", "show", `${recordCommit}:${path}`); },
        async auditEvent() { return { ...audit, id: evidence.auditEventId }; },
        async currentContext() { return { contextRevision: evidence.contextRevision, policyRevision: evidence.policyRevision, requiredDeliverableIds: ["code"] }; },
        async deliverable() { return { deliverableId: "code", repositoryId: "target", pullRequestId: "7", state: "merged" as const, headSha: sha("c"), mergeCommitSha: sha("d"), authorProviderActorId: "bot", review: { reviewId: "review-7", currentness: "current" as const, verdict: "pass" as const, coverage: "complete" as const, reviewedHead: sha("c"), contextRevision: evidence.contextRevision, policyRevision: evidence.policyRevision }, authorizedHumanApproval: { reviewerId: "human", providerActorId: "100", reviewedHead: sha("c"), state: "APPROVED", hasProjectAccess: true } }; },
      },
    };
    return { evidence, evidenceHash, deps };
  }

  async function publish(evidence: GateEvidence) {
    const writes = new DocumentWriteStore(db.pool, repositories());
    const original = writes.target.bind(writes);
    writes.target = async (id) => { const target = await original(id); return target ? { ...target, apiToken: "test-token" } : undefined; };
    const fakeFetch = (async () => new Response(JSON.stringify({ web_url: `https://github.example.invalid/docs/-/merge_requests/${number}`, iid: number }), { status: 201 })) as typeof fetch;
    const request = { writeId: evidence.decisionId, projectId: "shop", kind: "state-change" as const, actor: "human", unit: evidence.unitId, message: "Publish gate", reviewAll: true, files: [{ path, content: formatGateRecord(evidence) }] };
    const operation = { operationId: "operation", transitionKey: evidence.decisionId, projectId: "shop", queue: "document-write", intentKey: "publish-gate-record", attempts: 1, payload: JSON.parse(JSON.stringify({ documentRepositoryId: "docs", request })) };
    await publishGate({ async enqueue(_repositoryId, write) { await writeDocument({ writes, repositories: repositories(), storage, fetch: fakeFetch }, write); } }, operation);
    return (await db.pool.query<{ branch: string; branch_commit_sha: string; status: string }>("select branch,branch_commit_sha,status from workflow.document_write where id=$1", [evidence.decisionId])).rows[0]!;
  }

  it("GATE-01 keeps a DB decision and an unmerged reviewed Git write pending", async () => {
    const { evidence, deps } = await seed();
    await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).resolves.toMatchObject({ status: "pending-publication" });
    const before = remote.git("docs", "rev-parse", "main").trim();
    const write = await publish(evidence);
    expect(write.status).toBe("pr-opened");
    expect(remote.git("docs", "rev-parse", "main").trim()).toBe(before);
    await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).resolves.toMatchObject({ status: "awaiting-merge" });
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='gate.effective'")).rows[0].count).toBe(0);
  });

  it("GATE-06 binds a squash merge to final Git evidence and advances exactly once under concurrent replay", async () => {
    const { evidence, deps } = await seed();
    const write = await publish(evidence);
    recordCommit = await remote.commit("docs", path, formatGateRecord(evidence));
    expect(recordCommit).not.toBe(write.branch_commit_sha);
    providerState = "merged";
    const results = await Promise.all([effective.reconcileGatePublication(deps, evidence.decisionId), effective.reconcileGatePublication(deps, evidence.decisionId)]);
    expect(results.map(result => result.status)).toEqual(["effective", "effective"]);
    const publication = (await db.pool.query("select state,record_commit from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0];
    expect(publication).toEqual({ state: "effective", record_commit: recordCommit });
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='gate.effective' and metadata->>'decisionId'=$1", [evidence.decisionId])).rows[0].count).toBe(1);
  });

  it("GATE-03 rejects a record that replaces the immutable decision evidence", async () => {
    const { evidence, deps } = await seed();
    await publish(evidence);
    recordCommit = await remote.commit("docs", path, formatGateRecord({ ...evidence, decisionId: "different-decision" }));
    providerState = "merged";
    await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).resolves.toMatchObject({ status: "failed", code: "GATE_PUBLICATION_MISMATCH" });
  });

  it("GATE-04 preserves the same decision after a failed writer", async () => {
    const { evidence, deps } = await seed();
    await db.pool.query("update workflow.document_write set status='failed' where id=$1", [evidence.decisionId]);
    await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).resolves.toMatchObject({ status: "pending-publication" });
    expect((await db.pool.query("select state from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0].state).toBe("pending-publication");
  });

  it("rolls effective projection back if durable event persistence fails", async () => {
    const { evidence, deps } = await seed();
    await publish(evidence);
    recordCommit = await remote.commit("docs", path, formatGateRecord(evidence));
    providerState = "merged";
    await db.pool.query("create function public.fail_gate_event() returns trigger language plpgsql as $$ begin if new.kind='gate.effective' then raise exception 'event crash'; end if; return new; end $$; create trigger fail_gate_event before insert on workflow.member_event for each row execute function public.fail_gate_event()");
    try { await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).rejects.toThrow("event crash"); }
    finally { await db.pool.query("drop trigger fail_gate_event on workflow.member_event; drop function public.fail_gate_event()"); }
    expect((await db.pool.query("select state,record_commit from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0]).toEqual({ state: "pending-publication", record_commit: null });
    await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).resolves.toMatchObject({ status: "effective" });
  });
  it("runs the production provider/SQL/Git adapter and rejects dismissed approvals and changed context", async () => {
    const { evidence, evidenceHash } = await seed(item => {
      item.deliverables[0] = {...item.deliverables[0]!,repositoryId:"docs",pullRequestId:"7",reviewResultId:"rev_"+randomUUID()};
    });
    const unitPath = "applications/web/units/core/invoice/unit.md";
    const unitText = "---\nid: web/core/invoice\napplication: web\nmodule: core\nkind: module\ntitle: Invoice\nphase: migrate\nstatus: in-progress\nrequiredDeliverables:\n  - {id: code, repositoryId: docs, path: result.md}\n---\n";
    const unitCommit = await remote.commit("docs", unitPath, unitText);
    const inputId=evidence.decisionId;
    await db.pool.query("insert into admin.project_access (project_id,user_id,granted_by) values ('shop','human','human') on conflict do nothing");
    await db.pool.query("insert into core.user_role (user_id,role_id) values ('human','admin') on conflict do nothing");
    await db.pool.query("insert into workflow.member_provider_actor_mapping (project_id,server_id,provider_actor_id,user_id,confirmed_by) values ('shop','github','200','human','human') on conflict do nothing");
    await db.pool.query("insert into admin.application (project_id,id,name,disposition) values ('shop','web','Web','refactor') on conflict do nothing");
    await db.pool.query("insert into delivery.member_task_projection (project_id,application_id,unit_id,repository_id,source_commit,source_path,source_hash,work_item,required_inputs,source_references,predecessor_gates) values ('shop','web','web/core/invoice','docs',$1,$2,$3,$4,'[]','[]','[]') on conflict (project_id,unit_id) do nothing", [unitCommit, unitPath, createHash("sha256").update(unitText).digest("hex"), JSON.stringify({ requiredDeliverables: [{ id: "code", repositoryId: "docs", path: "result.md" }] })]);
    const snapshotId = "ctx_" + randomUUID();
    const manifest = { policyRevision: evidence.policyRevision, sources: [{ repositoryId: "docs", path: unitPath, contentHash: "sha256:" + createHash("sha256").update(unitText).digest("hex"), availability: "present" }] };
    await db.pool.query("insert into delivery.member_snapshot (snapshot_id,project_id,unit_id,activity,requested_by_user_id,context_revision,task,readiness,manifest,created_at,expires_at) values ($1,'shop','web/core/invoice','implementation','human',$2,'{}','{}',$3,now(),now()+interval '1 day')", [snapshotId, evidence.contextRevision, JSON.stringify(manifest)]);
    for (const [pr, num] of [["7", 7], ["99", 99]] as const) await db.pool.query("insert into workflow.member_provider_observation (server_id,repository_id,provider_repository_id,provider_pull_request_id,pull_request_number,state,head_sha,head_ref,base_sha,base_ref,provider_updated_at) values ('github','docs','42',$1,$2,'open',$3,'feature',$4,'main',now())", [pr, num, sha("c"), sha("b")]);
    await db.pool.query("insert into workflow.member_task_pull_request (server_id,repository_id,provider_repository_id,provider_pull_request_id,pull_request_number,project_id,unit_id,association_state,association_source,context_revision,deliverable_ids,confirmed_by,confirmed_at) values ('github','docs','42','7',7,'shop','web/core/invoice','confirmed','maintainer',$1,'[\"code\"]','human',now())", [evidence.contextRevision]);
    await db.pool.query("insert into workflow.member_review (review_id,review_key,generation,project_id,unit_id,implementation_repository_id,server_id,provider,provider_repository_id,provider_pull_request_id,pull_request_number,snapshot_id,head_sha,base_sha,merge_base_sha,context_revision,policy_revision,agent_version,status,currentness,coverage,verdict,input_manifest,report,finished_at) values ($1,$2,1,'shop','web/core/invoice','docs','github','github','42','7',7,$3,$4,$5,$5,$6,$7,'1','succeeded','current','complete','pass','{}','{}',now())", [evidence.deliverables[0]!.reviewResultId, evidenceHash, snapshotId, sha("c"), sha("b"), evidence.contextRevision, evidence.policyRevision]);
    await publish(evidence);
    const gateMerge = await remote.commit("docs", path, formatGateRecord(evidence));
    const prUrl = "https://github.example.invalid/org/docs/pull/99";
    await db.pool.query("update workflow.document_write set pr_url=$2 where id=$1", [inputId, prUrl]);
    const repo = repositories();
    repo.githubProviderConnection = async () => ({ kind: "github", baseUrl: "https://github.example.invalid", token: "test", repositoryPath: "org/docs" });
    let approvalState = "DISMISSED";
    const observer = { async get(_connection: unknown, identity: { pullRequestId: string; number: number }) { return { repositoryId: "42", pullRequestId: identity.pullRequestId, htmlUrl: identity.pullRequestId === "99" ? prUrl : "https://github.example.invalid/org/docs/pull/7", state: "merged", headSha: sha("c"), mergeCommitSha: identity.pullRequestId === "99" ? gateMerge : sha("d"), authorId: "bot", mergedAt: "2026-10-22T00:00:00Z", reviews: [{ id: "review-1", actorId: "200", state: "APPROVED", commitSha: sha("c"), submittedAt: "2026-10-20T00:00:00Z" }, { id: "review-2", actorId: "200", state: approvalState, commitSha: sha("c"), submittedAt: "2026-10-21T00:00:00Z" }] } as ObservedPullRequest; } };
    const adapter = new PostgresGateReconciler({ pool: db.pool, repositories: repo, storage, observer });
    const live = { pool: db.pool, verification: adapter.verification, mergedRecord: adapter.mergedRecord.bind(adapter) };
    await expect(effective.reconcileGatePublication(live, inputId)).resolves.toMatchObject({ status: "awaiting-merge" });
    approvalState = "APPROVED";
    await expect(effective.reconcileGatePublication(live, inputId)).resolves.toMatchObject({ status: "effective" });
    expect((await db.pool.query("select record_commit from workflow.gate_publication where decision_id=$1", [inputId])).rows[0].record_commit).toBe(gateMerge);
    await remote.commit("docs", unitPath, unitText + "Changed relevant instructions.\n");
    expect(await adapter.verification.currentContext("shop", "web/core/invoice")).toBeUndefined();
  });

  it("GATE-05 repeats publication through one durable write and branch", async () => {
    const { evidence } = await seed();
    const first = await publish(evidence);
    const retry = await publish(evidence);
    expect(retry).toEqual(first);
    expect((await db.pool.query("select count(*)::int as count from workflow.document_write where id=$1", [evidence.decisionId])).rows[0].count).toBe(1);
    expect((await db.pool.query("select count(*)::int as count from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0].count).toBe(1);
  });

  it("rotates a bounded reconciliation scan so pending records cannot starve later decisions",async()=>{
    await db.pool.query("insert into workflow.document_write (id,project_id,kind,message) select 'gate_'||lpad(to_hex(n),48,'0'),'shop','state-change','Gate' from generate_series(1000,1100) n");
    await db.pool.query("insert into workflow.gate_publication (decision_id,project_id,unit_id,gate_id,decision,evidence,evidence_hash,document_repository_id,record_path,document_write_id,created_by,updated_at) select 'gate_'||lpad(to_hex(n),48,'0'),'shop','web/core/invoice','G4','approved','{}',lpad(to_hex(n),64,'0'),'docs',$1,'gate_'||lpad(to_hex(n),48,'0'),'human','2000-01-01' from generate_series(1000,1100) n",[path]);
    const tailId="gate_"+(1100).toString(16).padStart(48,"0");
    const lastUpdated=async()=>(await db.pool.query<{updated_at:Date}>("select updated_at from workflow.gate_publication where decision_id=$1",[tailId])).rows[0]!.updated_at.getTime();
    const before=await lastUpdated();
    const adapter=new PostgresGateReconciler({pool:db.pool,repositories:repositories(),storage,observer:{async get(){throw new Error("queued writes must not call the provider");}}});
    await adapter.scan(()=>undefined);
    expect(await lastUpdated()).toBe(before);
    await adapter.scan(()=>undefined);
    expect(await lastUpdated()).toBeGreaterThan(before);
  });

});
