// Typed access to governance: the audit log (audit.read) and quality and stage gates (read with
// a session, request with gates.request, decide with gates.decide). Mirrors apps/api →
// modules/governance/audit and modules/governance/gates. Restricted records are in ./job-runs
// (they belong to runs).

import type { GateDecision, GateStatus } from "@kintsugi/domain";
import { apiGet, apiSend, type Page } from "../api";
import { queryString } from "./job-runs";

export type { GateDecision, GateStatus } from "@kintsugi/domain";

export interface AuditEntry {
  id: string;
  at: string;
  /** User id of who acted. */
  actor: string;
  action: string;
  projectId?: string;
  subject?: string;
  detail: Record<string, unknown>;
}

export interface AuditFilter {
  /** One action or a comma-separated list. */
  action?: string;
  actor?: string;
  subject?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface Gate {
  id: string;
  projectId: string;
  applicationId?: string;
  /** `G0`–`G4` or a stage gate key such as `stage:assess`. */
  gateKey: string;
  title: string;
  status: GateStatus;
  /** What the gate is about, e.g. a job run id. */
  subject?: string;
  detail: Record<string, unknown>;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export interface GateFilter {
  projectId?: string;
  applicationId?: string;
  gateKey?: string;
  status?: GateStatus[];
  limit?: number;
  offset?: number;
}

export interface RequestGateInput {
  projectId: string;
  applicationId?: string;
  gateKey: string;
  title: string;
  subject?: string;
}

export const governanceApi = {
  audit: (filter: AuditFilter = {}) => apiGet<Page<AuditEntry>>(`/api/governance/audit${queryString(filter)}`),
  /** The actions the audit log records, sorted. */
  auditActions: () => apiGet<string[]>("/api/governance/audit/actions"),
  gates: (filter: GateFilter = {}) => apiGet<Page<Gate>>(`/api/governance/gates${queryString(filter)}`),
  gateHistory: (id: string) => apiGet<Gate[]>(`/api/governance/gates/${encodeURIComponent(id)}/history`),
  requestGate: (input: RequestGateInput) => apiSend<Gate>("/api/governance/gates", "POST", input),
  decideGate: (id: string, decision: GateDecision, note?: string) =>
    apiSend<Gate>(`/api/governance/gates/${encodeURIComponent(id)}/decision`, "POST", { decision, ...(note === undefined || note.trim() === "" ? {} : { note }) }),
};
