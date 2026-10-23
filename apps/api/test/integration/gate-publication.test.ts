import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatGateRecord, gateEvidenceCanonicalJson, type GateEvidence } from "@kintsugi/domain";
import { hasDatabase } from "../support/database.js";
import { adminClient, memberClient, startTestApp, type TestApp } from "../support/app.js";
import { PgGatePublicationRepository } from "../../src/modules/governance/gate-publication/infrastructure/pg-gate-publication.repository.js";

import { PgTaskApprovalEvidenceReader } from "../../src/modules/delivery/agent-context/infrastructure/pg-task-approval-evidence.reader.js";
import { TaskQueryService } from "../../src/modules/delivery/agent-context/application/task-query.service.js";

const sha = (char: string): string => char.repeat(40);

describe.skipIf(!hasDatabase)("evidence-bound gate publication (integration)", () => {
  let app: TestApp;
  let adminId: string;
  let repository: PgGatePublicationRepository;

  beforeAll(async () => {
    app = await startTestApp();
    const admin = await adminClient(app);
    await app.db.query("insert into admin.git_server (id, kind, name, base_url, auth_type) values ('github', 'github', 'GitHub', 'https://github.example.invalid', 'none')");
    await app.db.query("insert into admin.git_repository (id, server_id, url, sync_status) values ('shop-docs', 'github', 'https://github.example.invalid/org/shop-docs.git', 'ready')");
    expect((await admin.request("POST", "/admin/projects", { body: { id: "shop", name: "Shop", documentRepositoryId: "shop-docs" } })).status).toBe(201);
    adminId = (await app.db.query<{ id: string }>("select id from core.app_user where username = 'admin'")).rows[0]!.id;
    repository = app.nest.get(PgGatePublicationRepository, { strict: false });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  function createInput(decisionId: string, actorId = adminId, gateId = "G4", unitId = "web/core/invoice") {
    const evidenceBase = {
      schemaVersion: "1" as const,
      decisionId,
      projectId: "shop",
      unitId,
      gateId,
      decision: "approved" as const,
      policyRevision: "member-context-v1",
      contextRevision: `sha256:${"a".repeat(64)}`,
      requiredDeliverableIds: ["code", "docs"],
      actor: { userId: actorId, authorizationId: `session:${"b".repeat(64)}` },
      deliverables: [
        { deliverableId: "code", repositoryId: "shop-api", pullRequestId: "pr-101", reviewResultId: "rev-101", reviewedRevision: sha("c"), mergedRevision: sha("d") },
        { deliverableId: "docs", repositoryId: "shop-docs", pullRequestId: "pr-102", reviewResultId: "rev-102", reviewedRevision: sha("e"), mergedRevision: sha("f") },
      ],
    };
    const evidenceForHash: GateEvidence = { ...evidenceBase, auditEventId: "0" };
    const evidenceHash = createHash("sha256").update(gateEvidenceCanonicalJson(evidenceForHash)).digest("hex");
    return {
      evidence: evidenceBase,
      evidenceHash,
      audit: {
        actor: actorId,
        action: "gate.decision.request",
        projectId: "shop",
        subject: decisionId,
        detail: {
          authorizationId: evidenceBase.actor.authorizationId,
          gateId,
          decision: "approved",
          contextRevision: evidenceBase.contextRevision,
          policyRevision: evidenceBase.policyRevision,
          evidenceHash,
        },
      },
      documentRepositoryId: "shop-docs",
      recordPath: "10-applications/web/02-modern/core/invoice/reviews/G4.md",
      message: "Publish G4 decision for web/core/invoice",
      actorLabel: "admin",
    };
  }

  it("commits audit, immutable evidence, document write, event and outbox once under concurrent retries", async () => {
    const input = createInput("gate_" + "1".repeat(48));
    const [first, retry] = await Promise.all([repository.createDecision(input), repository.createDecision(input)]);

    expect(first).toMatchObject({ state: "pending-publication", documentWriteStatus: "queued", recordPath: input.recordPath });
    expect(retry).toMatchObject({ decisionId: first.decisionId, evidenceHash: input.evidenceHash });
    const publicationPage = await repository.listByProject("shop", 10, 0);
    expect(publicationPage).toMatchObject({ total: 1, limit: 10, offset: 0 });
    expect(publicationPage.items[0]).toMatchObject({ decisionId: first.decisionId, state: "pending-publication" });
    const portal = await adminClient(app);
    expect((await portal.request("PUT", `/admin/project-access/shop/${adminId}`, { body: {} })).status).toBe(204);
    const response = await portal.get<{ items: Array<{ decisionId: string; state: string }>; total: number }>("/governance/gate-publications?projectId=shop");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ total: 1, items: [expect.objectContaining({ decisionId: first.decisionId, state: "pending-publication" })] });
    expect((await portal.get("/governance/gate-publications?projectId=other")).status).toBe(403);
    const counts = await app.db.query<{ audits: number; writes: number; transitions: number; events: number; outbox: number }>(
      `select
         (select count(*)::int from governance.audit_event where subject = $1 and action = 'gate.decision.request') as audits,
         (select count(*)::int from workflow.document_write where id = $1) as writes,
         (select count(*)::int from workflow.member_transition where transition_key = $1) as transitions,
         (select count(*)::int from workflow.member_event where transition_key = $1) as events,
         (select count(*)::int from workflow.outbox where transition_key = $1) as outbox`,
      [first.decisionId],
    );
    expect(counts.rows[0]).toEqual({ audits: 1, writes: 1, transitions: 1, events: 1, outbox: 1 });

    const stored = await app.db.query<{ evidence: GateEvidence; payload: { request: { reviewAll: boolean; files: Array<{ path: string; content: string }> } } }>(
      `select p.evidence, o.payload
         from workflow.gate_publication p
         join workflow.outbox o on o.transition_key = p.decision_id
        where p.decision_id = $1`,
      [first.decisionId],
    );
    expect(stored.rows[0]?.evidence.auditEventId).toMatch(/^\d+$/);
    expect(stored.rows[0]?.payload.request.reviewAll).toBe(true);
    expect(stored.rows[0]?.payload.request.files[0]?.content).toBe(formatGateRecord(stored.rows[0]!.evidence));
  });

  it("allows a primary member with exact Project Access to read publication status", async () => {
    const admin = await adminClient(app);
    const member = await memberClient(app, admin, "gate-reader", ["user"]);
    expect((await admin.request("PUT", "/admin/project-access/shop/" + member.id, { body: {} })).status).toBe(204);
    const publication = await repository.createDecision(createInput("gate_" + "4".repeat(48)));
    expect((await member.client.get("/governance/gate-publications?projectId=shop")).status).toBe(200);
    expect((await member.client.get("/governance/gate-publications/" + publication.decisionId)).status).toBe(200);
    expect((await member.client.get("/governance/gate-publications?projectId=other")).status).toBe(403);
  });
  it("returns only the latest publication for each requested task gate", async () => {
    const olderInput = createInput("gate_" + "5".repeat(48), adminId, "G2");
    olderInput.recordPath = "10-applications/web/02-modern/core/invoice/reviews/G2-older.md";
    const older = await repository.createDecision(olderInput);

    const newerInput = createInput("gate_" + "6".repeat(48), adminId, "G2");
    newerInput.recordPath = "10-applications/web/02-modern/core/invoice/reviews/G2-newer.md";
    const newer = await repository.createDecision(newerInput);
    const dependencyInput = createInput("gate_" + "7".repeat(48), adminId, "G2", "web/catalog/product");
    dependencyInput.recordPath = "10-applications/web/02-modern/catalog/product/reviews/G2.md";
    const dependency = await repository.createDecision(dependencyInput);
    await app.db.query("update workflow.gate_publication set updated_at = $2 where decision_id = $1", [older.decisionId, "2030-10-19T00:00:00.000Z"]);
    await app.db.query("update workflow.gate_publication set updated_at = $2 where decision_id = $1", [newer.decisionId, "2026-10-20T00:00:00.000Z"]);

    const latest = await repository.listLatestForTask("shop", [
      { unitId: "web/core/invoice", gateId: "G2" },
      { unitId: "web/catalog/product", gateId: "G2" },
    ]);
    expect(latest).toHaveLength(2);
    expect(latest).toEqual(expect.arrayContaining([
      expect.objectContaining({ decisionId: newer.decisionId, unitId: "web/core/invoice", gateId: "G2", state: "pending-publication" }),
      expect.objectContaining({ decisionId: dependency.decisionId, unitId: "web/catalog/product", gateId: "G2", state: "pending-publication" }),
    ]));
    expect(latest.some((publication) => publication.decisionId === older.decisionId)).toBe(false);
  });
  it("rolls the audit back when the publication cannot satisfy its user foreign key", async () => {
    const input = createInput("gate_" + "2".repeat(48), "missing-user");
    await expect(repository.createDecision(input)).rejects.toThrow();
    const counts = await app.db.query<{ audits: number; writes: number; transitions: number; publications: number }>(
      `select
         (select count(*)::int from governance.audit_event where subject = $1) as audits,
         (select count(*)::int from workflow.document_write where id = $1) as writes,
         (select count(*)::int from workflow.member_transition where transition_key = $1) as transitions,
         (select count(*)::int from workflow.gate_publication where decision_id = $1) as publications`,
      [input.evidence.decisionId],
    );
    expect(counts.rows[0]).toEqual({ audits: 0, writes: 0, transitions: 0, publications: 0 });
  });
  it("uses a retained design approval after the implementation task replaces its deliverable list", async () => {
    const input = createInput("gate_" + "3".repeat(48));
    const designPath = "10-applications/web/02-modern/core/invoice/detail/logic.md";
    input.evidence.gateId = "G2";
    input.recordPath = "10-applications/web/02-modern/core/invoice/reviews/G2.md";
    input.evidence.deliverables = input.evidence.deliverables.map(item => ({ ...item, ...(item.repositoryId === "shop-docs" ? { path: designPath } : {}) }));
    input.evidenceHash = createHash("sha256").update(gateEvidenceCanonicalJson({ ...input.evidence, auditEventId: "0" })).digest("hex");
    input.audit.detail = { ...input.audit.detail, gateId: "G2", evidenceHash: input.evidenceHash };
    const publication = await repository.createDecision(input);
    const stored = (await app.db.query<{ evidence: GateEvidence }>("select evidence from workflow.gate_publication where decision_id=$1", [publication.decisionId])).rows[0]!.evidence;
    let changed = false;
    const approvals = new PgTaskApprovalEvidenceReader({
      async context() { return { repo: { repositoryId: "shop-docs" } }; },
      async isAncestor() { return true; },
      async readText(_context: unknown, commit: string, path: string) { return path === input.recordPath ? formatGateRecord(stored) : (changed && commit === sha("8") ? "changed design" : "approved design"); },
    } as never);
    await expect(approvals.predecessorStatus("shop", "web/core/invoice", "G2", sha("8"))).resolves.toBe("pending");
    await app.db.query("update workflow.gate_publication set state='effective',record_commit=$2 where decision_id=$1", [publication.decisionId, sha("7")]);
    const source = { sourceId: "design", role: "detailed-design", repositoryId: "shop-docs", path: designPath, requiredFor: ["implementation"], availability: "present", publication: "published", approval: "unknown" };
    const record = { projectId: "shop", unitId: "web/core/invoice", repositoryId: "shop-docs", sourceCommit: sha("8"), workItem: { id: "web/core/invoice", application: "web", module: "core", kind: "module", title: "Invoice", phase: "migrate", status: "pending", requiredDeliverables: [{ id: "code", repositoryId: "shop-api", path: "src/invoice.ts" }] }, requiredInputs: [source], sourceReferences: [source], predecessorGates: [{ gateId: "G2", status: "unknown", requiredFor: ["implementation"] }] };
    const revision = { repositoryId: "shop-docs", commit: sha("8"), applicationIdsFingerprint: "fingerprint" };
    const tasks = new TaskQueryService({ currentRevision: async () => revision } as never, { indexRevision: async () => revision, get: async () => record } as never, { requireRead: async () => undefined } as never, approvals);
    const principal = { userId: adminId, tokenId: "test", projectIds: ["shop"], credentialKind: "coding-agent-read" as const };
    await expect(approvals.sourceApproval("shop", designPath, sha("8"))).resolves.toBe("approved");
    expect((await tasks.get(principal, { projectId: "shop", unitId: "web/core/invoice" })).readiness.byActivity.implementation.ready).toBe(true);
    changed = true;
    expect((await tasks.get(principal, { projectId: "shop", unitId: "web/core/invoice" })).readiness.byActivity.implementation.ready).toBe(false);
  });

});
