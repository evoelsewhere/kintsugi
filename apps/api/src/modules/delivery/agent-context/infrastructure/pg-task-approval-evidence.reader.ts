import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { gateEvidenceCanonicalJson, parseGateRecord, unitGateReviewPath, validateGateEvidence, type GateEvidence } from "@kintsugi/domain";
import { getPool } from "#common/db/pool.js";
import { DocumentsService, type DocumentContext } from "#modules/delivery/documents/index.js";
import { TaskApprovalEvidenceReader } from "../domain/task.js";

interface GateEvidenceRow {
  decision_id: string;
  project_id: string;
  unit_id: string;
  gate_id: string;
  decision: GateEvidence["decision"];
  state: string;
  evidence: unknown;
  evidence_hash: string;
  record_path: string;
  record_commit: string | null;
  document_repository_id: string;
  deliverable_path?: string;
  deliverable_revision?: string;
}

const GATE_RECORD_MAX_BYTES = 65_536;

@Injectable()
export class PgTaskApprovalEvidenceReader extends TaskApprovalEvidenceReader {
  constructor(private readonly documents: DocumentsService) {
    super();
  }

  async sourceApproval(projectId: string, path: string, commit: string): Promise<"approved" | "pending" | "rejected" | "unknown" | "not-required"> {
    const result = await getPool().query<GateEvidenceRow>(
      `select p.decision_id, p.project_id, p.unit_id, p.gate_id, p.decision, p.state, p.evidence,
              p.evidence_hash, p.record_path, p.record_commit, p.document_repository_id,
              deliverable.value->>'path' as deliverable_path,
              deliverable.value->>'mergedRevision' as deliverable_revision
         from workflow.gate_publication p
         cross join lateral jsonb_array_elements(p.evidence->'deliverables') deliverable(value)
        where p.project_id = $1 and p.state = 'effective' and p.decision in ('approved', 'waived')
          and deliverable.value->>'path' = $2
          and deliverable.value->>'repositoryId' = p.document_repository_id
        order by p.updated_at desc, p.decision_id
        limit 20`,
      [projectId, path],
    );
    if (result.rows.length === 0) return "unknown";

    const context = await this.documents.context(projectId);
    if (context.repo.repositoryId !== result.rows[0]?.document_repository_id) return "unknown";
    for (const row of result.rows) {
      if (row.deliverable_path !== path || row.deliverable_revision === undefined) continue;
      const evidence = await this.#effectiveRecordAtCommit(context, row, commit);
      if (evidence === undefined) continue;
      if (!(await this.documents.isAncestor(context, row.deliverable_revision, commit))) return "pending";
      const approved = await this.documents.readText(context, row.deliverable_revision, path);
      const current = await this.documents.readText(context, commit, path);
      if (approved === undefined || current === undefined || approved !== current) return "pending";
      return evidence.decision === "approved" || evidence.decision === "waived" ? "approved" : "pending";
    }
    return "unknown";
  }

  async predecessorStatus(projectId: string, unitId: string, gateId: string, commit: string): Promise<"pending" | "approved" | "rejected" | "unknown"> {
    const result = await getPool().query<GateEvidenceRow>(
      `select decision_id, project_id, unit_id, gate_id, decision, state, evidence, evidence_hash,
              record_path, record_commit, document_repository_id
         from workflow.gate_publication
        where project_id = $1 and unit_id = $2 and gate_id = $3
        order by created_at desc, decision_id desc
        limit 1`,
      [projectId, unitId, gateId],
    );
    const row = result.rows[0];
    if (row === undefined) return "unknown";
    if (row.state !== "effective" && row.state !== "rejected") return "pending";
    const context = await this.documents.context(projectId);
    if (context.repo.repositoryId !== row.document_repository_id) return "unknown";
    const evidence = await this.#effectiveRecordAtCommit(context, row, commit);
    if (evidence === undefined) return "unknown";
    if (evidence.decision === "rejected") return "rejected";
    return evidence.decision === "approved" || evidence.decision === "waived" ? "approved" : "unknown";
  }

  async #effectiveRecordAtCommit(context: DocumentContext, row: GateEvidenceRow, indexedCommit: string): Promise<GateEvidence | undefined> {
    if (row.record_commit === null || row.state !== "effective" && row.state !== "rejected") return undefined;
    if (!(await this.documents.isAncestor(context, row.record_commit, indexedCommit))) return undefined;
    const stored = validateGateEvidence(row.evidence);
    if (!stored.ok || stored.value.decisionId !== row.decision_id || stored.value.projectId !== row.project_id ||
        stored.value.unitId !== row.unit_id || stored.value.gateId !== row.gate_id || stored.value.decision !== row.decision) return undefined;
    const expectedHash = createHash("sha256").update(gateEvidenceCanonicalJson(stored.value)).digest("hex");
    if (expectedHash !== row.evidence_hash) return undefined;
    const segments = row.unit_id.split("/");
    const [application, module, unit] = segments;
    if (application === undefined || module === undefined || unit === undefined ||
        row.record_path !== unitGateReviewPath(application, module, unit, row.gate_id)) return undefined;
    const markdown = await this.documents.readText(context, indexedCommit, row.record_path, GATE_RECORD_MAX_BYTES);
    if (markdown === undefined) return undefined;
    const parsed = parseGateRecord(markdown);
    if (parsed.status !== "valid" || parsed.evidence.auditEventId !== stored.value.auditEventId ||
        gateEvidenceCanonicalJson(parsed.evidence) !== gateEvidenceCanonicalJson(stored.value)) return undefined;
    return parsed.evidence;
  }
}
