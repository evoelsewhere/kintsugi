import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatGateRecord, gateEvidenceCanonicalJson, type GateEvidence } from "@kintsugi/domain";
import { hasDatabase } from "../support/database.js";
import { adminClient, startTestApp, type TestApp } from "../support/app.js";
import { PgGatePublicationRepository } from "../../src/modules/governance/gate-publication/infrastructure/pg-gate-publication.repository.js";

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

  function createInput(decisionId: string, actorId = adminId) {
    const evidenceBase = {
      schemaVersion: "1" as const,
      decisionId,
      projectId: "shop",
      unitId: "web/core/invoice",
      gateId: "G4",
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
          gateId: "G4",
          decision: "approved",
          contextRevision: evidenceBase.contextRevision,
          policyRevision: evidenceBase.policyRevision,
          evidenceHash,
        },
      },
      documentRepositoryId: "shop-docs",
      recordPath: "applications/web/units/core/invoice/reviews/G4.md",
      message: "Publish G4 decision for web/core/invoice",
      actorLabel: "admin",
    };
  }

  it("commits audit, immutable evidence, document write, event and outbox once under concurrent retries", async () => {
    const input = createInput("gate_" + "1".repeat(48));
    const [first, retry] = await Promise.all([repository.createDecision(input), repository.createDecision(input)]);

    expect(first).toMatchObject({ state: "pending-publication", documentWriteStatus: "queued", recordPath: input.recordPath });
    expect(retry).toMatchObject({ decisionId: first.decisionId, evidenceHash: input.evidenceHash });
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
});
