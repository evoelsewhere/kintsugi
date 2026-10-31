// Typed access to the design views of a project (ADR-0044, ADR-0045). Mirrors apps/api →
// modules/delivery/design: the design sets the project defined and the conformance of each unit's
// design documents, derived on every read from the document repo.

import type { DesignState } from "@kintsugi/domain";
import { apiGet, apiSend } from "../api";
import type { JobRunView } from "./job-runs";

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
  /** The unit kind whose profile folder holds the template; absent when the file uses the set's own template (ADR-0053). */
  profile?: string;
  /** What a document of the file names in its `template:` front matter (`detail@2`, or `detail/screen@3`). */
  ref: string;
  /** A finished example for the designer, relative to the set folder. */
  example?: string;
  sections: DesignSection[];
}

/** The variation of a set for one unit kind (ADR-0053). */
export interface DesignProfile {
  kind: string;
  version: number;
  /** Paths of the set's files this kind does not have. */
  removes: string[];
  /** The profile's instructions to the designer, read after the set's. */
  instructions: string;
  /** The files of the set for this kind, with the template each is written with. */
  files: DesignSetFile[];
  /** The names in the profile's `_examples/` folder. */
  examples: string[];
}

export interface DesignSet {
  id: string;
  title: string;
  version: number;
  /** `unit`: a design per unit; `application`: one design for the whole application (ADR-0050). */
  scope: "unit" | "application";
  /** The unit kinds the set is for: none when it has files every kind has. */
  appliesTo: string[];
  needs: string[];
  stage?: string;
  description: string;
  /** Documents the designer also reads when it generates the set (`{app}` allowed). */
  reads: string[];
  /** The project's instructions to the designer for this kind of design. */
  instructions: string;
  producedBy: Array<{ pipeline: string; stage: string }>;
  /** The files every kind has unless its profile changes them. */
  files: DesignSetFile[];
  /** One profile per unit kind that has a folder in the set. */
  profiles: DesignProfile[];
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
  /** Input evidence missing for a final design; an explicit draft may proceed. */
  blockers?: string[];
  /** A draft still needs an active unit in the merged catalog. */
  draftAllowed?: boolean;
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
  sets: Array<{ id: string; title: string; version: number; needs: string[]; scope: "unit" | "application" }>;
  /** The unit kinds of the project: kintsugi.yaml's `unitKinds`, else the default the portal renders. */
  unitKinds: string[];
  /** Where the application's own design stands, per set of scope `application`. */
  application: { sets: Record<string, UnitSetSummary> };
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
  /** What the design names in its front matter. */
  template?: string;
  /** What a design of this file must name: the template of the unit's kind, in its current version. */
  expected: string;
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

/** A unit whose design set a run is generating or a pull request carries (ADR-0049). */
export interface UnitSetActivity {
  /** `<module>/<unit>`. */
  unit: string;
  set: string;
  state: "running" | "in-pr";
  runId: string;
  pr?: { branch: string; url?: string };
}

export interface DesignActivity {
  items: UnitSetActivity[];
}

/** A conflict of a refused selection (409): a unit that has the set, lacks one it needs, or is running or in a pull request. */
export interface DesignConflict {
  unit: string;
  state: "running" | "in-pr" | "written" | "unwritten" | "needs" | "not-ready";
  runId?: string;
  needs?: string[];
  reasons?: string[];
}

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
  /** The application's own design (its sets of scope `application`), shaped like a unit's; the unit is `@app`. */
  application: (projectId: string, applicationId: string, ref?: string) => apiGet<UnitDesign>(`${application(projectId, applicationId)}/application${refQuery(ref)}`),
  /** The units a run is generating or a pull request carries (what a new selection cannot take). */
  activity: (projectId: string, applicationId: string) => apiGet<DesignActivity>(`${application(projectId, applicationId)}/activity`),
  /** Generates one design set for units (202), or with `regenerate` writes it again over the units' design (ADR-0081); 409 with details.conflicts when some cannot be designed now. */
  generate: (projectId: string, applicationId: string, selection: { set: string; units: string[]; regenerate?: boolean; draft?: boolean }) => apiSend<JobRunView>(`${application(projectId, applicationId)}/runs`, "POST", selection),
  common: (projectId: string, applicationId: string, ref?: string) => apiGet<CommonDesign>(`${application(projectId, applicationId)}/common${refQuery(ref)}`),
};
