// Typed access to the design views of a project (ADR-0044, ADR-0045). Mirrors apps/api →
// modules/delivery/design: the design sets the project defined and the conformance of each unit's
// design documents, derived on every read from the document repo.

import type { DesignState } from "@kintsugi/domain";
import { apiGet } from "../api";

export type { DesignState };

export interface DesignProblem {
  code: string;
  section?: string;
  message: string;
}

export interface DesignTemplateProblem {
  path: string;
  message: string;
}

export interface DesignSection {
  heading: string;
  level: number;
  required: boolean;
  table?: string[];
  seed?: string;
  checks: string[];
  guidance?: string;
}

export interface DesignSetFile {
  path: string;
  template: string;
  required: boolean;
  when: string[];
  sections: DesignSection[];
}

export interface DesignSet {
  id: string;
  title: string;
  version: number;
  appliesTo: string[];
  needs: string[];
  stage?: string;
  description: string;
  producedBy: Array<{ pipeline: string; stage: string }>;
  files: DesignSetFile[];
  usage?: { units: number; onCurrent: number; stale: number };
}

export interface DesignSetsView {
  ref: { ref: string; commit: string };
  sets: DesignSet[];
  problems: DesignTemplateProblem[];
}

export interface UnitSetSummary {
  set: string;
  version: number;
  state: DesignState;
  files: { total: number; conformant: number; problems: number; missing: number; stale: number; waived: number };
  ready: boolean;
}

export interface UnitDesignRow {
  /** `<module>/<unit>`. */
  key: string;
  module: string;
  unit: string;
  kind: string;
  title?: string;
  wave?: string;
  owner?: string;
  sets: Record<string, UnitSetSummary>;
  rules: { total: number; uncovered: number | null };
}

export interface DesignAttention {
  kind: "template-error" | "unresolved-component" | "uncovered-rules" | "stale";
  count: number;
  label: string;
}

export interface DesignOverview {
  ref: { ref: string; commit: string };
  sets: Array<{ id: string; title: string; version: number; needs: string[] }>;
  units: UnitDesignRow[];
  counts: Record<string, Partial<Record<DesignState, number>>>;
  rules: { units: number; total: number; uncovered: number };
  attention: DesignAttention[];
  templateProblems: number;
}

export type DesignFileState = "conformant" | "problems" | "missing" | "waived";

export interface DesignFile {
  path: string;
  required: boolean;
  state: DesignFileState;
  stale: boolean;
  template?: string;
  problems: DesignProblem[];
  waiver?: string;
}

export interface UnitSetDetail {
  set: string;
  title: string;
  version: number;
  state: DesignState;
  needs: string[];
  files: DesignFile[];
}

export interface UnitDesign {
  ref: { ref: string; commit: string };
  unit: { key: string; module: string; unit: string; kind: string; title?: string };
  sets: UnitSetDetail[];
  coverage: Array<{ rule: string; title: string; coveredBy: Array<{ set: string; file: string; section: string }> }>;
  unresolved: Array<{ id: string; source: string; set: string; file: string; section: string }>;
}

export interface CommonComponent {
  id: string;
  title?: string;
  status?: string;
  path: string;
  referencedBy: string[];
}

export interface CommonDesign {
  ref: { ref: string; commit: string };
  components: CommonComponent[];
  unresolved: Array<{ id: string; referencedBy: string[] }>;
}

const project = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}`;
const application = (projectId: string, applicationId: string): string => `${project(projectId)}/applications/${encodeURIComponent(applicationId)}/design`;
const refQuery = (ref: string | undefined): string => (ref === undefined || ref === "" ? "" : `?ref=${encodeURIComponent(ref)}`);

export const designApi = {
  /** The design sets of the project; with an application, how its units stand with each. */
  sets: (projectId: string, options: { app?: string; ref?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.ref !== undefined && options.ref !== "") query.set("ref", options.ref);
    if (options.app !== undefined) query.set("app", options.app);
    const text = query.toString();
    return apiGet<DesignSetsView>(`${project(projectId)}/design/sets${text === "" ? "" : `?${text}`}`);
  },
  overview: (projectId: string, applicationId: string, ref?: string) => apiGet<DesignOverview>(`${application(projectId, applicationId)}${refQuery(ref)}`),
  unit: (projectId: string, applicationId: string, key: string, ref?: string) => apiGet<UnitDesign>(`${application(projectId, applicationId)}/units/${key.split("/").map(encodeURIComponent).join("/")}${refQuery(ref)}`),
  common: (projectId: string, applicationId: string, ref?: string) => apiGet<CommonDesign>(`${application(projectId, applicationId)}/common${refQuery(ref)}`),
};
