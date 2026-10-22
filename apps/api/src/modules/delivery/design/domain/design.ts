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
  /** The unit kind whose profile folder holds the template; absent when the file uses the set's own template (ADR-0053). */
  profile?: string;
  /** What a document of the file names in its `template:` front matter: `detail@2`, or `detail/screen@3` for a profile's template. */
  ref: string;
  /** A finished example for the designer, relative to the set folder. */
  example?: string;
  sections: DesignSectionView[];
}

/** The variation of a set for one unit kind (ADR-0053). */
export interface DesignProfileView {
  kind: string;
  version: number;
  /** Paths of the set's files this kind does not have. */
  removes: string[];
  /** The profile's instructions to the designer, read after the set's. */
  instructions: string;
  /** The files of the set for this kind, with the template each is written with. */
  files: DesignSetFileView[];
  /** The names in the profile's `_examples/` folder. */
  examples: string[];
}

export interface DesignSetView {
  id: string;
  title: string;
  version: number;
  /** `unit`: a design per unit; `application`: one design for the whole application (ADR-0050). */
  scope: "unit" | "application";
  /** The unit kinds the set is for: none when it has files every kind has; else the kinds with a profile that leaves it files. */
  appliesTo: string[];
  needs: string[];
  stage?: string;
  description: string;
  /** Documents the designer also reads when it generates the set (`{app}` allowed). */
  reads: string[];
  /** The project's instructions to the designer for this kind of design. */
  instructions: string;
  /** The pipeline stages of the manifest that produce this set (`produces`). */
  producedBy: Array<{ pipeline: string; stage: string }>;
  /** The files every kind has unless its profile changes them. */
  files: DesignSetFileView[];
  /** One profile per unit kind that has a folder in the set (ADR-0053). */
  profiles: DesignProfileView[];
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
  /** What the design names in its front matter (`<set>@<version>` or `<set>/<kind>@<version>`). */
  template?: string;
  /** What a design of this file must name: the template of the unit's kind in its current version. */
  expected: string;
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
  sets: Array<{ id: string; title: string; version: number; needs: string[]; scope: "unit" | "application" }>;
  /** Where the application's own design stands, per set of scope `application` (ADR-0050). */
  application: { sets: Record<string, UnitSetSummary> };
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

/** A unit whose design set a run is generating or a pull request is carrying (ADR-0049). */
export interface UnitSetActivity {
  /** `<module>/<unit>`. */
  unit: string;
  set: string;
  state: "running" | "in-pr";
  runId: string;
  pr?: { branch: string; url?: string };
}

export interface DesignActivityView {
  items: UnitSetActivity[];
}
