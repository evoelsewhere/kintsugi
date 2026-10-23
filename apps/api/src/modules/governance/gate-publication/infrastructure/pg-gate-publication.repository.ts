import { Injectable } from "@nestjs/common";
import { formatGateRecord, type GateEvidence } from "@kintsugi/domain";
import { DOCUMENT_WRITE_QUEUE, type DocumentWriteRequest } from "@kintsugi/orchestrator/queues";
import { recordTransition, type JsonValue } from "@kintsugi/orchestrator/outbox";
import type { Pool, PoolClient } from "pg";
import { AuditTrail } from "#common/audit/audit-trail.js";
import { getPool, withTransaction, type Queryable } from "#common/db/pool.js";
import { GatePublicationRepository } from "../domain/gate-publication.repository.js";
import type { CreateGatePublication, GatePublication, GatePublicationState } from "../domain/gate-publication.js";
import type { GatePublicationIdentity, GatePublicationPage } from "../domain/gate-publication.repository.js";

interface GatePublicationRow {
  decision_id: string;
  project_id: string;
  unit_id: string;
  gate_id: string;
  decision: GateEvidence["decision"];
  stored_state: GatePublicationState;
  evidence_hash: string;
  record_path: string;
  document_write_id: string;
  document_write_status: string;
  created_at: Date;
  updated_at: Date;
  pr_url: string | null;
  record_commit: string | null;
}

const SELECT_COLUMNS = `p.decision_id, p.project_id, p.unit_id, p.gate_id, p.decision, p.state as stored_state,
       p.evidence_hash, p.record_path, p.document_write_id, d.status as document_write_status,
       p.created_at, p.updated_at, coalesce(p.pr_url, d.pr_url) as pr_url, p.record_commit`;
const SELECT_FROM = `from workflow.gate_publication p
  join workflow.document_write d on d.id = p.document_write_id`;
const SELECT = `select ${SELECT_COLUMNS} ${SELECT_FROM}`;
const SELECT_LATEST_FOR_TASK = `select distinct on (p.unit_id, p.gate_id) ${SELECT_COLUMNS} ${SELECT_FROM}`;

function toPublication(row: GatePublicationRow): GatePublication {
  let state: GatePublicationState = row.stored_state;
  if (!(["effective", "stale", "failed", "rejected"] as const).includes(state as "effective" | "stale" | "failed" | "rejected")) {
    if (row.document_write_status === "failed") state = "failed";
    else if (row.document_write_status === "pr-opened" || row.document_write_status === "merged") state = "awaiting-merge";
  }
  return {
    decisionId: row.decision_id,
    projectId: row.project_id,
    unitId: row.unit_id,
    gateId: row.gate_id,
    decision: row.decision,
    state,
    evidenceHash: row.evidence_hash,
    recordPath: row.record_path,
    documentWriteId: row.document_write_id,
    documentWriteStatus: row.document_write_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.pr_url === null ? {} : { prUrl: row.pr_url }),
    ...(row.record_commit === null ? {} : { recordCommit: row.record_commit }),
  };
}

@Injectable()
export class PgGatePublicationRepository extends GatePublicationRepository {
  constructor(private readonly audit: AuditTrail) {
    super();
  }

  async createDecision(input: CreateGatePublication): Promise<GatePublication> {
    return withTransaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [input.evidence.decisionId]);
      const existing = await this.#find(tx, input.evidence.decisionId);
      if (existing !== undefined) {
        if (existing.evidenceHash !== input.evidenceHash) throw new Error("gate decision id was reused with different evidence");
        return existing;
      }

      const [auditEventId] = await this.audit.recordWithIds([input.audit], tx);
      if (auditEventId === undefined) throw new Error("gate decision audit did not return a durable ID");
      const evidence: GateEvidence = { ...input.evidence, auditEventId };
      const content = formatGateRecord(evidence);
      const request: DocumentWriteRequest = {
        writeId: evidence.decisionId,
        projectId: evidence.projectId,
        kind: "state-change",
        message: input.message,
        files: [{ path: input.recordPath, content }],
        actor: input.actorLabel,
        unit: evidence.unitId,
        reviewAll: true,
      };

      await recordTransition(tx, {
        transitionKey: evidence.decisionId,
        projectId: evidence.projectId,
        unitId: evidence.unitId,
        event: { kind: "gate.publication.requested", metadata: { decisionId: evidence.decisionId, gateId: evidence.gateId } },
        queueIntents: [{
          intentKey: "publish-gate-record",
          queue: DOCUMENT_WRITE_QUEUE,
          payload: JSON.parse(JSON.stringify({ documentRepositoryId: input.documentRepositoryId, request })) as JsonValue,
        }],
      }, async (transaction: PoolClient) => {
        await transaction.query(
          "insert into workflow.document_write (id, project_id, kind, message, actor) values ($1, $2, 'state-change', $3, $4)",
          [evidence.decisionId, evidence.projectId, input.message, input.actorLabel],
        );
        await transaction.query(
          `insert into workflow.gate_publication
            (decision_id, project_id, unit_id, gate_id, decision, state, evidence, evidence_hash,
             document_repository_id, record_path, document_write_id, created_by)
           values ($1, $2, $3, $4, $5, 'pending-publication', $6, $7, $8, $9, $10, $11)`,
          [
            evidence.decisionId,
            evidence.projectId,
            evidence.unitId,
            evidence.gateId,
            evidence.decision,
            JSON.stringify(evidence),
            input.evidenceHash,
            input.documentRepositoryId,
            input.recordPath,
            evidence.decisionId,
            evidence.actor.userId,
          ],
        );
      });

      const publication = await this.#find(tx, evidence.decisionId);
      if (publication === undefined) throw new Error("gate publication was not stored");
      return publication;
    });
  }

  async get(decisionId: string): Promise<GatePublication | undefined> {
    return this.#find(getPool(), decisionId);
  }

  async listByProject(projectId: string, limit: number, offset: number): Promise<GatePublicationPage> {
    const db = getPool();
    const [count, result] = await Promise.all([
      db.query<{ total: string }>("select count(*)::text as total from workflow.gate_publication where project_id = $1", [projectId]),
      db.query<GatePublicationRow>(SELECT + " where p.project_id = $1 order by p.updated_at desc, p.decision_id desc limit $2 offset $3", [projectId, limit, offset]),
    ]);
    return { items: result.rows.map(toPublication), total: Number(count.rows[0]?.total ?? 0), limit, offset };
  }

  async listLatestForTask(projectId: string, gates: readonly GatePublicationIdentity[]): Promise<GatePublication[]> {
    if (gates.length === 0) return [];
    const result = await getPool().query<GatePublicationRow>(
      SELECT_LATEST_FOR_TASK +
        " where p.project_id = $1 and (p.unit_id, p.gate_id) in (select * from unnest($2::text[], $3::text[])) " +
        "order by p.unit_id, p.gate_id, p.created_at desc, p.decision_id desc",
      [projectId, gates.map(({ unitId }) => unitId), gates.map(({ gateId }) => gateId)],
    );
    return result.rows.map(toPublication);
  }

  async #find(db: Queryable | Pick<Pool, "query"> | Pick<PoolClient, "query">, decisionId: string): Promise<GatePublication | undefined> {
    const result = await db.query<GatePublicationRow>(SELECT + " where p.decision_id = $1", [decisionId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toPublication(row);
  }
}
