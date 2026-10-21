// Domain of the design view (ADR-0044, ADR-0045): what the portal shows of a project's design sets and
// of each unit's design documents. Pure types; the checks themselves are the reader's
// (`@kintsugi/agents/reader`, the same code the member's `check_design.py` mirrors).

import type { DesignState } from "@kintsugi/domain";

/** A fault of a design document against its template, as the checks word it. */
export interface DesignProblemView {
  code: string;
  section?: string;
  message: string;
}

/** A fault of a design set's own definition. */
export interface DesignTemplateProblemView {
  path: string;
  message: string;
}

export interface DesignSectionView {
  heading: string;
  level: number;
  required: boolean;
  table?: string[];
  seed?: string;
  /** Each check as written in the template: `covers-rules(Rule)`. */
  checks: string[];
  guidance?: string;
}

export interface DesignSetFileView {
  path: string;
  template: string;
  required: boolean;
  when: string[];
  sections: DesignSectionView[];
}

export interface DesignSetView {
  id: string;
  title: string;
  version: number;
  appliesTo: string[];
  needs: string[];
  stage?: string;
  description: string;
  /** The pipeline stages of the manifest that produce this set (`produces`). */
  producedBy: Array<{ pipeline: string; stage: string }>;
  files: DesignSetFileView[];
  /** How the units of the application stand with the set; present when an application was asked for. */
  usage?: { units: number; onCurrent: number; stale: number };
}

export interface DesignSetsView {
  ref: { ref: string; commit: string };
  sets: DesignSetView[];
  /** Faults of the definitions of the sets, and of what the manifest says about them. */
  problems: DesignTemplateProblemView[];
}

/** The state of one file: `stale` is a separate flag, since a stale design is also conformant or has problems. */
export type DesignFileState = "conformant" | "problems" | "missing" | "waived";

export interface DesignFileView {
  path: string;
  required: boolean;
  state: DesignFileState;
  stale: boolean;
  /** `<set>@<version>` the design was written against. */
  template?: string;
  problems: DesignProblemView[];
  waiver?: string;
}

export interface UnitSetSummary {
  set: string;
  version: number;
  state: DesignState;
  files: { total: number; conformant: number; problems: number; missing: number; stale: number; waived: number };
  /** The sets this one needs are written, and this one is not started: what to design next. */
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
  /** How many rules the unit has, and how many of them a written design leaves out (null while no design lists rules). */
  rules: { total: number; uncovered: number | null };
}

export type DesignAttentionKind = "template-error" | "unresolved-component" | "uncovered-rules" | "stale";

export interface DesignAttention {
  kind: DesignAttentionKind;
  count: number;
  label: string;
}

export interface DesignOverviewView {
  ref: { ref: string; commit: string };
  /** The sets of the project, in the order they are written (a set after the ones it needs). */
  sets: Array<{ id: string; title: string; version: number; needs: string[] }>;
  units: UnitDesignRow[];
  /** Units per state, for each set. */
  counts: Record<string, Partial<Record<DesignState, number>>>;
  rules: { units: number; total: number; uncovered: number };
  attention: DesignAttention[];
  templateProblems: number;
}

export interface UnitSetDetail {
  set: string;
  title: string;
  version: number;
  state: DesignState;
  needs: string[];
  files: DesignFileView[];
}

export interface UnitCoverageRow {
  rule: string;
  title: string;
  coveredBy: Array<{ set: string; file: string; section: string }>;
}

export interface UnresolvedReference {
  id: string;
  source: string;
  set: string;
  file: string;
  section: string;
}

export interface UnitDesignView {
  ref: { ref: string; commit: string };
  unit: { key: string; module: string; unit: string; kind: string; title?: string };
  sets: UnitSetDetail[];
  /** Uncovered rules first. */
  coverage: UnitCoverageRow[];
  unresolved: UnresolvedReference[];
}

export interface CommonComponentView {
  id: string;
  title?: string;
  status?: string;
  path: string;
  /** The units whose designs name the component. */
  referencedBy: string[];
}

export interface CommonDesignView {
  ref: { ref: string; commit: string };
  components: CommonComponentView[];
  /** `COM-` ids that designs name and no component document defines. */
  unresolved: Array<{ id: string; referencedBy: string[] }>;
}
