import { planContinuation } from "../src/member-workflow/continue.js";
import { dispatchContinuation } from "../src/member-workflow/dispatch.js";
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
const path = "10-applications/web/02-modern/core/invoice/reviews/G4.md";

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
      async recheckAuthority() { return true; },
      verification: {
        async readRecord() { return remote.git("docs", "show", `${recordCommit}:${path}`); },
        async auditEvent() { return { ...audit, id: evidence.auditEventId }; },
        async currentContext() { return { contextRevision: evidence.contextRevision, policyRevision: evidence.policyRevision, requiredDeliverableIds: ["code"] }; },
        async deliverable() { return { deliverableId: "code", repositoryId: "target", pullRequestId: "7", state: "merged" as const, headSha: sha("c"), mergeCommitSha: sha("d"), authorProviderActorId: "bot", review: { reviewId: "review-7", currentness: "current" as const, verdict: "pass" as const, coverage: "complete" as const, reviewedHead: sha("c"), contextRevision: evidence.contextRevision, policyRevision: evidence.policyRevision }, authorizedHumanApproval: { reviewerId: "human", providerActorId: "100", serverId: "github", reviewedHead: sha("c"), state: "APPROVED", hasProjectAccess: true } }; },
      },
    };
    return { evidence, evidenceHash, deps };
  }

  async function grantGateAuthority(reviewerId: string, providerActorId = "100") {
    await db.pool.query("update core.app_user set enabled=true where id='human'");
    await db.pool.query("insert into core.app_user (id,username,password_hash,password_salt) values ($1,$1,'test','test') on conflict do nothing", [reviewerId]);
    await db.pool.query("insert into admin.project_access (project_id,user_id,granted_by) values ('shop','human','human'),('shop',$1,'human') on conflict do nothing", [reviewerId]);
    await db.pool.query("insert into core.user_role (user_id,role_id) values ('human','admin') on conflict do nothing");
    await db.pool.query("insert into workflow.member_provider_actor_mapping (project_id,server_id,provider_actor_id,user_id,confirmed_by) values ('shop','github',$1,$2,'human') on conflict do nothing", [providerActorId, reviewerId]);
  }

  async function reconcileWhileProviderObservationIsBlocked(evidence: GateEvidence, reviewerId: string, providerActorId: string, revoke: () => Promise<unknown>) {
    await grantGateAuthority(reviewerId, providerActorId);
    await db.pool.query("update workflow.document_write set status='pr-opened',pr_url='https://github.example.invalid/org/docs/pull/99' where id=$1", [evidence.decisionId]);
    let enteredObservation!: () => void;
    let releaseObservation!: () => void;
    const observationEntered = new Promise<void>(resolve => { enteredObservation = resolve; });
    const observationReleased = new Promise<void>(resolve => { releaseObservation = resolve; });
    const adapter = new PostgresGateReconciler({
      pool: db.pool,
      repositories: repositories(),
      storage,
      observer: { async get() { throw new Error("verification supplies the blocked observation"); } },
    });
    const deps = {
      pool: db.pool,
      mergedRecord: async () => ({ status: "merged" as const, location: { repo: "docs", commit: recordCommit, path } }),
      recheckAuthority: adapter.recheckAuthority.bind(adapter),
      verification: {
        ...adapter.verification,
        async readRecord() { return formatGateRecord(evidence); },
        async currentContext() { return { contextRevision: evidence.contextRevision, policyRevision: evidence.policyRevision, requiredDeliverableIds: ["code"] }; },
        async deliverable() {
          enteredObservation();
          await observationReleased;
          return {
            deliverableId: "code", repositoryId: "target", pullRequestId: "7", state: "merged" as const, headSha: sha("c"), mergeCommitSha: sha("d"), authorProviderActorId: "bot",
            review: { reviewId: "review-7", currentness: "current" as const, verdict: "pass" as const, coverage: "complete" as const, reviewedHead: sha("c"), contextRevision: evidence.contextRevision, policyRevision: evidence.policyRevision },
            authorizedHumanApproval: { reviewerId, providerActorId, serverId: "github", reviewedHead: sha("c"), state: "APPROVED", hasProjectAccess: true },
          };
        },
      },
    };
    const reconciliation = effective.reconcileGatePublication(deps, evidence.decisionId);
    await observationEntered;
    try { await revoke(); }
    finally { releaseObservation(); }
    return reconciliation;
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
    const intents = await db.pool.query("select queue,intent_key,payload from workflow.outbox where transition_key=$1", [`gate-effective:${evidence.decisionId}:${(await db.pool.query("select evidence_hash from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0].evidence_hash}`]);
    expect(intents.rows).toEqual([{queue:"workflow-next-step",intent_key:"continue-effective-gate",payload:expect.objectContaining({decisionId:evidence.decisionId,recordCommit})}]);
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='gate.effective' and metadata->>'decisionId'=$1", [evidence.decisionId])).rows[0].count).toBe(1);
  });

  it("EVT-03 resumes after gate commit and consume-before-ack without repeating continuation, including after event expiry",async()=>{
    const {evidence,deps}=await seed();
    await publish(evidence);
    recordCommit=await remote.commit("docs",path,formatGateRecord(evidence));
    providerState="merged";
    await effective.reconcileGatePublication(deps,evidence.decisionId);
    // A restarted worker can consume the committed intent with all clients disconnected.
    const operation=(await db.pool.query("select operation_id,transition_key,project_id,queue,intent_key,payload,attempts from workflow.outbox where queue='workflow-next-step' and payload->>'decisionId'=$1",[evidence.decisionId])).rows[0];
    const item={operationId:operation.operation_id,transitionKey:operation.transition_key,projectId:operation.project_id,queue:operation.queue,intentKey:operation.intent_key,payload:operation.payload,attempts:operation.attempts};
    const consumer={pool:db.pool,current:async()=>({plan:{status:"unavailable" as const,code:"PIPELINE_NOT_DECLARED"},evidence,reviewers:[]}),recheckAuthority:deps.recheckAuthority};
    const outcomes=await Promise.all([dispatchContinuation(consumer,item),dispatchContinuation(consumer,item)]);
    expect(outcomes.map(result=>result.created).sort()).toEqual([false,true]);
    expect((await db.pool.query("select count(*)::int as count from workflow.member_transition where transition_key=$1",[`gate-continuation:${evidence.decisionId}:${operation.payload.evidenceHash}`])).rows[0].count).toBe(1);
    const event=(await db.pool.query("select metadata from workflow.member_event where transition_key=$1",[`gate-continuation:${evidence.decisionId}:${operation.payload.evidenceHash}`])).rows[0];
    expect(event.metadata).toMatchObject({schemaVersion:"1",status:"blocked",code:"PIPELINE_NOT_DECLARED",decisionId:evidence.decisionId,recordCommit});
    // Simulate a crash before outbox acknowledgement, then retention cleanup before replay.
    await db.pool.query("delete from workflow.member_event where transition_key=$1",[`gate-continuation:${evidence.decisionId}:${operation.payload.evidenceHash}`]);
    await expect(dispatchContinuation({...consumer,current:async()=>{throw new Error("offline on replay");}},item)).resolves.toMatchObject({created:false});
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where transition_key=$1",[`gate-continuation:${evidence.decisionId}:${operation.payload.evidenceHash}`])).rows[0].count).toBe(0);
  });

  it("does not emit continuation when effective evidence is stale",async()=>{
    const {evidence,deps}=await seed();
    await publish(evidence);
    recordCommit=await remote.commit("docs",path,formatGateRecord(evidence));
    providerState="merged";
    await effective.reconcileGatePublication(deps,evidence.decisionId);
    const operation=(await db.pool.query("select * from workflow.outbox where queue='workflow-next-step' and payload->>'decisionId'=$1",[evidence.decisionId])).rows[0];
    const consumer={pool:db.pool,current:async()=>undefined,recheckAuthority:deps.recheckAuthority};
    await expect(dispatchContinuation(consumer,{operationId:operation.operation_id,transitionKey:operation.transition_key,projectId:operation.project_id,queue:operation.queue,intentKey:operation.intent_key,payload:operation.payload,attempts:1})).rejects.toThrow("no longer current");
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='task.continuation' and metadata->>'decisionId'=$1",[evidence.decisionId])).rows[0].count).toBe(0);
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

  it("rolls projection and event back when continuation intent persistence fails", async () => {
    const { evidence, deps } = await seed();
    await publish(evidence);
    recordCommit = await remote.commit("docs", path, formatGateRecord(evidence));
    providerState = "merged";
    await db.pool.query("create function public.fail_continuation_intent() returns trigger language plpgsql as $$ begin if new.queue='workflow-next-step' then raise exception 'intent crash'; end if; return new; end $$; create trigger fail_continuation_intent before insert on workflow.outbox for each row execute function public.fail_continuation_intent()");
    try { await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).rejects.toThrow("intent crash"); }
    finally { await db.pool.query("drop trigger fail_continuation_intent on workflow.outbox; drop function public.fail_continuation_intent()"); }
    expect((await db.pool.query("select state,record_commit from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0]).toEqual({state:"pending-publication",record_commit:null});
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='gate.effective' and metadata->>'decisionId'=$1", [evidence.decisionId])).rows[0].count).toBe(0);
    await expect(effective.reconcileGatePublication(deps, evidence.decisionId)).resolves.toMatchObject({status:"effective"});
  });
  it("does not record effective state when reviewer access is revoked during provider observation", async () => {
    const { evidence } = await seed();
    const reviewerId = `reviewer-${number}`;
    const providerActorId = `provider-${number}`;
    const reconciliation = reconcileWhileProviderObservationIsBlocked(evidence, reviewerId, providerActorId,
      () => db.pool.query("delete from admin.project_access where project_id='shop' and user_id=$1", [reviewerId]));

    await expect(reconciliation).resolves.toMatchObject({ status: "awaiting-merge", code: "GATE_AUTHORITY_REVOKED" });
    expect((await db.pool.query("select state,record_commit from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0]).toEqual({ state: "pending-publication", record_commit: null });
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='gate.effective' and metadata->>'decisionId'=$1", [evidence.decisionId])).rows[0].count).toBe(0);
  });

  it("does not record effective state when the mapped reviewer account is disabled during provider observation", async () => {
    const { evidence } = await seed();
    const reviewerId = `reviewer-${number}`;
    const providerActorId = `provider-${number}`;
    const reconciliation = reconcileWhileProviderObservationIsBlocked(evidence, reviewerId, providerActorId,
      () => db.pool.query("update core.app_user set enabled=false where id=$1", [reviewerId]));
    await expect(reconciliation).resolves.toMatchObject({ status: "awaiting-merge", code: "GATE_AUTHORITY_REVOKED" });
    expect((await db.pool.query("select state,record_commit from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0]).toEqual({ state: "pending-publication", record_commit: null });
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='gate.effective' and metadata->>'decisionId'=$1", [evidence.decisionId])).rows[0].count).toBe(0);
  });

  it.each([
    ["account is disabled", () => db.pool.query("update core.app_user set enabled=false where id='human'")],
    ["gates.decide is revoked", () => db.pool.query("delete from core.user_role where user_id='human' and role_id='admin'")],
    ["Project Access is revoked", () => db.pool.query("delete from admin.project_access where project_id='shop' and user_id='human'")],
  ])("does not record effective state when decision actor %s during provider observation", async (_reason, revoke) => {
    const { evidence } = await seed();
    const reviewerId = `reviewer-${number}`;
    const providerActorId = `provider-${number}`;
    const reconciliation = reconcileWhileProviderObservationIsBlocked(evidence, reviewerId, providerActorId, revoke);
    await expect(reconciliation).resolves.toMatchObject({ status: "awaiting-merge", code: "GATE_AUTHORITY_REVOKED" });
    expect((await db.pool.query("select state,record_commit from workflow.gate_publication where decision_id=$1", [evidence.decisionId])).rows[0]).toEqual({ state: "pending-publication", record_commit: null });
    expect((await db.pool.query("select count(*)::int as count from workflow.member_event where kind='gate.effective' and metadata->>'decisionId'=$1", [evidence.decisionId])).rows[0].count).toBe(0);
  });
  it("runs the production provider/SQL/Git adapter and rejects dismissed approvals and changed context", async () => {
    const { evidence, evidenceHash } = await seed(item => {
      item.deliverables[0] = {...item.deliverables[0]!,repositoryId:"docs",pullRequestId:"7",reviewResultId:"rev_"+randomUUID()};
    });
    const unitPath = "10-applications/web/02-modern/core/invoice/README.md";
    const unitText = "---\nid: web/core/invoice\napplication: web\nmodule: core\nkind: module\ntitle: Invoice\nphase: migrate\nstatus: in-progress\nrequiredDeliverables:\n  - {id: code, repositoryId: docs, path: result.md}\n---\n";
    await remote.commit("docs", "kintsugi.yaml", "schemaVersion: 1\nproject: {id: shop, name: Shop}\ndocument: {server: github, path: org/docs}\nunitKinds: [module]\napplications:\n  - {id: web, disposition: refactor, pipeline: prepared, repos: []}\npipelines:\n  - id: prepared\n    phases:\n      - id: migrate\n        perUnit: true\n        stages:\n          - {id: approve, performer: {member: [core-team]}, gate: G4}\n      - id: verify\n        perUnit: true\n        stages:\n          - {id: test, performer: {member: [qc]}}\n");
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
    const live = { pool: db.pool, verification: adapter.verification, mergedRecord: adapter.mergedRecord.bind(adapter), recheckAuthority: adapter.recheckAuthority.bind(adapter) };
    await expect(effective.reconcileGatePublication(live, inputId)).resolves.toMatchObject({ status: "awaiting-merge" });
    approvalState = "APPROVED";
    await expect(effective.reconcileGatePublication(live, inputId)).resolves.toMatchObject({ status: "effective" });
    expect((await db.pool.query("select record_commit from workflow.gate_publication where decision_id=$1", [inputId])).rows[0].record_commit).toBe(gateMerge);
    const continuationFacts={projectId:"shop",unitId:evidence.unitId,gateId:evidence.gateId,decisionId:evidence.decisionId,evidenceHash,recordCommit:gateMerge};
    const continuation=await adapter.currentContinuation(continuationFacts);
    expect(continuation).toBeDefined();
    expect(planContinuation(continuationFacts,continuation!.plan)[0]).toMatchObject({status:"member-action",phase:"verify",stage:"test"});
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
