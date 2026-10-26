// Stage plans (ADR-0027): what a pipeline stage runs, as data. A plan is a list of steps; the
// generic executor (executor.ts) runs them in the stage's job workspace, each leaf step as a
// child run with its own in/out/tmp folders in the job workspace. Types and the placeholder filler only: this module is
// imported by the API too (prerequisites, `runnable`), so it pulls in nothing at run time.
//
// Placeholders, filled when a step starts. Paths are relative to the job workspace, which is the working directory
// of every process of the job (ADR-0055), so the same step has the same text in every attempt:
//
//   {src}    the read-only as-is checkouts (as-is/)     {in}    the step's read-only inputs
//   {tobe}   the read-only to-be checkouts (to-be/)     {out}   the step's output directory
//   {tmp}    its scratch directory
//   {sources} the legacy repositories and their commits, `id@commit,id@commit`; {src} holds one folder
//            per repository, named by its id (ADR-0052)
//   {app}    the application id                 {run}   the stage run's id
//   {item} {key}         the current item of a forEach step
//   {round} {maxRounds}  the current round of a repeat step
//   {error}              why the script a repair step fixes failed (redacted)
//
// Every step sees, under {in} at their document-repo paths: the stage's declared documents,
// then the outputs of the steps before it (intermediate ones included). Outputs of steps marked
// `intermediate` are inputs for later steps only; everything else is the stage's output and goes
// to the document repo through the writer.

export const PLACEHOLDER_NAMES = ["src", "tobe", "in", "out", "tmp", "sources", "app", "run", "item", "key", "round", "maxRounds", "error"] as const;
export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];
export type Placeholders = Partial<Record<PlaceholderName, string>>;

const PLACEHOLDER = new RegExp(`\\{(${PLACEHOLDER_NAMES.join("|")})\\}`, "g");

/**
 * Fills the known placeholders. A placeholder without a value is an error, never left in —
 * unless `partial`, which leaves it for a later fill (the executor fills the stage's values,
 * the step's own run fills its workspace paths).
 */
export function fill(template: string, values: Placeholders, options: { partial?: boolean } = {}): string {
  return template.replace(PLACEHOLDER, (match, name: PlaceholderName) => {
    const value = values[name];
    if (value !== undefined) return value;
    if (options.partial === true) return match;
    throw new Error(`placeholder {${name}} has no value for this run`);
  });
}

/** The catalog items a scoped run works on and their files (ADR-0033, inputs.scope). */
export interface StageScope {
  /** Catalog item ids, `<module>/<item>`. */
  readonly items: readonly string[];
  /** Repository paths of the items' files. */
  readonly files: readonly string[];
  /** The design set a design run generates for its units (ADR-0049). */
  readonly set?: string;
  /** A design run writes the set again over a design the units already have (ADR-0081). */
  readonly regenerate?: boolean;
  /** A non-final design; incomplete evidence is explicitly allowed. */
  readonly draft?: boolean;
  /** The target repository a review run reads (ADR-0071). */
  readonly target?: string;
  /** The merge request a review run reads: the member recorded it for the units; the reviewer reads the repository at `commit`. */
  readonly mr?: { readonly url: string; readonly commit: string; readonly branch?: string };
}

/** What a plan's dynamic parts (conditions, arguments, items) can look at while the stage runs. */
export interface StageContext {
  readonly app: string;
  /** The legacy repositories and their commits, `id@commit,id@commit` (the `{sources}` placeholder). */
  readonly sources: string;
  /** The selection of a scoped run (understand); undefined for a whole-application stage. */
  readonly scope: StageScope | undefined;
  /** The current round of the enclosing repeat step (1-based); 0 outside one. */
  readonly round: number;
  /** A file the next step would see under {in} (document-repo path, placeholders filled); undefined when absent. */
  readText(path: string): Promise<string | undefined>;
  /** Like readText, parsed as JSON; an invalid file fails the stage. */
  readJson(path: string): Promise<unknown>;
  /** Standard output of an earlier script step (bounded, redacted). */
  stdout(stepId: string): string | undefined;
  /** The choice taken at a gate step: the person's, or the documented default. */
  gate(stepId: string): string | undefined;
  /** Agent jobs this stage may still start; Infinity when it has no limit. */
  agentsLeft(): number;
}

export type Dynamic<T> = T | ((ctx: StageContext) => T | Promise<T>);

interface StepBase {
  /** Unique within the plan; names the step in events, the summary and StageContext lookups. */
  id: string;
  /** Skip the step when false (recorded as skipped). */
  when?: (ctx: StageContext) => boolean | Promise<boolean>;
  /**
   * Outputs for later steps only, never published: true for all of the step's outputs, or the
   * document-repo paths (prefixes, placeholders allowed) that are intermediate.
   */
  intermediate?: boolean | readonly string[];
  /** Files the step must have written (document-repo paths, placeholders allowed); missing ones fail it. */
  expects?: readonly string[];
}

export interface ScriptStep extends StepBase {
  kind: "script";
  /** A built-in script (scripts/<name>), or with `fromInputs` the document-repo path of a model-written one. */
  script: string;
  fromInputs?: boolean;
  args: Dynamic<readonly string[]>;
  /** Saves the script's standard output (redacted) at this document-repo path. */
  stdoutTo?: string;
  /**
   * When the script fails: this agent job is given the error ({error}) once, then the script
   * runs again; a second failure fails the stage.
   */
  repair?: AgentStep;
}

export interface AgentStep extends StepBase {
  kind: "agent";
  agent: string;
  /** The brief; a function when it depends on the run (the design set of a design run). */
  task: Dynamic<string>;
  /** Extra document-repo files for this step only (the plan's `documents` are always there); a function when they depend on the run. */
  documents?: Dynamic<readonly string[]>;
  /** Structured result: the job writes it as JSON matching this schema. */
  schema?: Record<string, unknown>;
  /** Where the structured result is saved (document-repo path). */
  resultTo?: string;
}

export interface WorkflowStep extends StepBase {
  kind: "workflow";
  workflow: string;
  args: Dynamic<Record<string, unknown>>;
  /** Where the workflow's returned object is saved (document-repo path). */
  resultTo?: string;
}

export type LeafStep = ScriptStep | AgentStep | WorkflowStep;

/** Independent steps run at the same time; they all see the same inputs. */
export interface ParallelStep extends StepBase {
  kind: "parallel";
  steps: readonly LeafStep[];
}

/** One agent job per item, at most `concurrency` at a time; all see the same inputs. */
export interface ForEachStep extends StepBase {
  kind: "forEach";
  /** Each item fills {item} and {key}. */
  items: (ctx: StageContext) => Promise<ReadonlyArray<{ key: string; item: string }>>;
  step: AgentStep;
  concurrency?: number;
  /** A failed item is recorded and the stage goes on (default: it fails the stage). */
  tolerateFailures?: boolean;
}

/** Runs its steps in rounds until `until` holds after a round, at most `max` rounds. */
export interface RepeatStep extends StepBase {
  kind: "repeat";
  max: number;
  steps: ReadonlyArray<LeafStep | GateStep>;
  until: (ctx: StageContext) => boolean | Promise<boolean>;
}

/**
 * A human decision the command describes. Persisted gates are not wired yet: the executor asks
 * its GateDecider, whose default takes `default` at once and records "gate defaulted: …".
 */
export interface GateStep extends StepBase {
  kind: "gate";
  question: Dynamic<string>;
  options: readonly string[];
  default: string;
  /** Required gates wait for an authenticated human choice; default gates record the documented default. */
  decisionMode: "required-human" | "default";
  /** Choices that end the stage here (it fails with "stopped at gate …"). */
  stopOn?: readonly string[];
}

export type StageStep = LeafStep | ParallelStep | ForEachStep | RepeatStep | GateStep;

/** A document-repo file a stage needs, written by an earlier stage. */
export interface StagePrerequisite {
  /** Document-repo path ({app} filled), read at the default branch tip. */
  path: string;
  /** The stage that writes it. */
  stage: string;
}

export interface StagePlan {
  id: string;
  /** Commit message of the stage's document write (first line = pull-request title); `scope` for a scoped run. */
  message(app: string, scope?: StageScope): string;
  /**
   * The document-repo path (intermediate, never published) of a Markdown file the stage writes for the pull request
   * description; the runner reads it when the stage is done (ADR-0054).
   */
  description?(app: string): string;
  /** Document-repo files (or folders, ending in "/") every step sees under {in}; missing ones are skipped. */
  documents?: readonly string[];
  /** Files that must exist on the document repo's default branch before the stage starts. */
  requires?: readonly StagePrerequisite[];
  /**
   * Files of earlier stages the plan uses when they are on the default branch: every step sees them
   * like `documents`, and the stage summary lists the missing ones (`missingInputs`).
   */
  optional?: readonly StagePrerequisite[];
  /**
   * Every output goes through the pull request, even when its path is in the auto-commit allowlist: for
   * proposals a person reviews as a whole before they become state (default: the writer splits).
   */
  reviewAll?: boolean;
  /** Optional deterministic scope check before a stage indexes or publishes its outputs. */
  validateOutputs?(app: string, scope: StageScope | undefined, paths: readonly string[]): void;
  steps: readonly StageStep[];
}
