// Typed access to governance reads: the audit log (audit.read). Mirrors apps/api →
// modules/governance/audit. Restricted records are in ./job-runs (they belong to runs).

import { apiGet, type Page } from "../api";
import { queryString } from "./job-runs";

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
  action?: string;
  subject?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export const governanceApi = {
  audit: (filter: AuditFilter = {}) => apiGet<Page<AuditEntry>>(`/api/governance/audit${queryString(filter)}`),
};
