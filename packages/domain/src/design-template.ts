// Design sets: the project-defined templates of the design phase (ADR-0044, ADR-0045). Pure types
// and the closed vocabulary; the Markdown parser and the checker live in the document reader
// (`@kintsugi/agents/reader`), the member-side copy in the `modernize` plugin
// (`scripts/design_lib.py`). Both are held to the same fixtures.

/** The checks a template section may name. A project chooses and parameterises them; it cannot add code. */
export const DESIGN_CHECKS = ["no-placeholder", "covers-rules", "refs-resolve", "id-pattern", "max-length", "one-of"] as const;
export type DesignCheckName = (typeof DESIGN_CHECKS)[number];

/** What a scaffold may fill in from what Kintsugi already knows. */
export const DESIGN_SEEDS = ["rules"] as const;
export type DesignSeed = (typeof DESIGN_SEEDS)[number];

/** Identifier sources a `refs-resolve` check may name besides the id of a set the design needs. */
export const DESIGN_REFERENCE_SOURCES = ["rules", "requirements", "components"] as const;
export type DesignReferenceSource = (typeof DESIGN_REFERENCE_SOURCES)[number];

/** The variables a scaffold substitutes in a template. */
export const DESIGN_TEMPLATE_VARIABLES = ["unit.id", "unit.title", "app.id", "kind", "set.id", "set.version"] as const;

/** What a design set is written for: each unit (the default), or the application as a whole (ADR-0050). */
export const DESIGN_SCOPES = ["unit", "application"] as const;
export type DesignScope = (typeof DESIGN_SCOPES)[number];

/** The key of the application where a unit key goes: the scope items of a design run, the manifest, the report. */
export const APPLICATION_UNIT_KEY = "@app";

/** A set id is also its folder name under `01-standards/templates/`. */
export const DESIGN_SET_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** A unit kind with a profile is the folder name `01-standards/templates/<set>/<kind>/` (ADR-0053). */
export const DESIGN_KIND_PATTERN = DESIGN_SET_ID_PATTERN;

/** The file of a profile folder that defines the profile; the folder of finished examples is `_examples/`. */
export const DESIGN_PROFILE_FILE = "profile.md";
export const DESIGN_EXAMPLES_DIR = "_examples";

/** A common component id, the file name of `02-architecture/common/<id>.md`. */
export const COMPONENT_ID_PATTERN = /^COM-[A-Z0-9][A-Z0-9-]{0,38}$/;

/** One document of a set: a row of the files table in `set.md` or `profile.md`. */
export interface DesignFileSpec {
  /** Relative to the unit's `<set>/` folder on the modern side. */
  path: string;
  /** A file in the set's folder; for a kind with a profile, the same name in the profile's folder replaces it. */
  template: string;
  required: boolean;
}

/** The variation of a set for one unit kind (ADR-0053): `01-standards/templates/<set>/<kind>/profile.md`. */
export interface DesignProfile {
  kind: string;
  /** Raised on a change that affects the designs written with the profile's templates. */
  version: number;
  /** Files added to the base ones, or redefining a base file of the same path. */
  files: DesignFileSpec[];
  /** Paths of base files this kind does not have. */
  removes: string[];
  /** The `## Instructions` section of `profile.md`, read after the set's. */
  instructions: string;
}

export interface DesignSet {
  id: string;
  title: string;
  /** Raised on a change that affects existing designs. */
  version: number;
  /** `unit`: a design per unit; `application`: one design for the whole application. */
  scope: DesignScope;
  /** Sets that must exist before this one. */
  needs: string[];
  /** The pipeline stage that produces it. */
  stage?: string;
  /** Documents the designer reads besides the ones every design run sees (`{app}` allowed). */
  reads: string[];
  /** The files every kind has, unless its profile changes them; none when the set is only for kinds with a profile. */
  files: DesignFileSpec[];
  /** The `## Instructions` section of `set.md`, for the designer. */
  instructions: string;
}

export type DesignCheck =
  | { name: "no-placeholder" }
  | { name: "covers-rules"; column: string }
  | { name: "refs-resolve"; column: string; source: string }
  | { name: "id-pattern"; column: string; pattern: string }
  | { name: "max-length"; limit: number }
  | { name: "one-of"; column: string; options: string[] };

/** One heading of a template and the contract written under it. */
export interface DesignSection {
  heading: string;
  level: number;
  required: boolean;
  /** The columns, when the section is a table. */
  table?: string[];
  seed?: DesignSeed;
  checks: DesignCheck[];
  guidance?: string;
}

export interface DesignTemplate {
  sections: DesignSection[];
}

/** What kind of fault a design document has against its template. */
export const DESIGN_PROBLEM_CODES = [
  "missing-template-ref",
  "wrong-template-ref",
  "missing-section",
  "empty-section",
  "missing-table",
  "table-columns",
  "placeholder",
  "uncovered-rules",
  "unresolved-reference",
  "id-pattern",
  "too-long",
  "not-allowed",
] as const;
export type DesignProblemCode = (typeof DESIGN_PROBLEM_CODES)[number];

export interface DesignProblem {
  code: DesignProblemCode;
  /** The heading of the section, absent for a fault of the whole document. */
  section?: string;
  message: string;
}

/** Where a unit stands with one design file, one set, or one set of a unit (the portal's conformance mark). */
export const DESIGN_STATES = ["conformant", "problems", "stale", "missing", "waived", "not-applicable"] as const;
export type DesignState = (typeof DESIGN_STATES)[number];

/** `<set>@<version>` for a base template, `<set>/<kind>@<version>` for a profile's: the provenance a design file carries in its front matter. */
export function designTemplateRef(set: string, version: number, kind?: string): string {
  return `${kind === undefined ? set : `${set}/${kind}`}@${version}`;
}

/** The set, kind (of a profile's template) and version a `template` front-matter value names, or undefined when it has neither form. */
export function parseDesignTemplateRef(value: string): { set: string; kind?: string; version: number } | undefined {
  const match = /^([a-z][a-z0-9-]{0,39})(?:\/([a-z][a-z0-9-]{0,39}))?@([1-9][0-9]{0,8})$/.exec(value.trim());
  return match === null ? undefined : { set: match[1] as string, ...(match[2] === undefined ? {} : { kind: match[2] }), version: Number(match[3]) };
}

/** A waiver in the `waived` list of the unit card (`README.md`): `<set>/<file>: <reason>`. */
export function parseDesignWaiver(value: string): { set: string; file: string; reason: string } | undefined {
  const match = /^([a-z][a-z0-9-]{0,39})\/([^:\s][^:]*?):\s*(.+)$/.exec(value.trim());
  return match === null ? undefined : { set: match[1] as string, file: (match[2] as string).trim(), reason: (match[3] as string).trim() };
}
