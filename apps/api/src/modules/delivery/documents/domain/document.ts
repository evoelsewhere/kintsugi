// Domain of document repo reads (ADR-0028): the project's document repo as Kintsugi's mirror of it
// holds it, read-only — the refs the stages wrote to, its tree and files at a commit, and the
// results of a stage built from the files it wrote. Never read from anywhere but the mirror;
// never `restricted/` (restricted records are not committed, ADR-0029) or `.git`. Pure types.

import type { CatalogRule, DataObject, Finding, Inventory, SecurityReport, Table, TopoEdge, TopoFlow } from "@kintsugi/agents/reader";

/** The mirror of a project's document repository (ADR-0025). */
export interface DocumentRepo {
  serverId: string;
  repositoryId: string;
  /** The default branch as registered, when known. */
  defaultBranch?: string;
}

/** A branch of the mirror. */
export interface MirrorBranch {
  /** Without `refs/heads/`. */
  name: string;
  commit: string;
  /** Committer date of the tip (ISO-8601). */
  date: string;
}

export type RefKind = "default" | "run" | "write" | "commit";

/** `merged`: the branch tip is on the default branch; `open`: it is not (yet). */
export type RefStatus = "default" | "merged" | "open" | "commit";

/** A ref of the document repo someone can look at: the default branch or the output of a run or write. */
export interface DocumentRef {
  /** `refs/heads/<branch>`, or a commit id for kind `commit`. */
  ref: string;
  kind: RefKind;
  commit: string;
  status: RefStatus;
  branch?: string;
  /** When the output was produced (the run's end, or the tip's committer date). */
  date?: string;
  stage?: string;
  applicationId?: string;
  runId?: string;
  /** The document write that carried it. */
  writeId?: string;
  label: string;
}

export interface DocumentRefs {
  defaultBranch: string;
  refs: DocumentRef[];
}

export type TreeEntryKind = "file" | "dir";

export interface TreeEntry {
  /** Path from the repository root. */
  path: string;
  name: string;
  kind: TreeEntryKind;
  /** Bytes, for files. */
  size?: number;
}

export interface DocumentTree {
  ref: string;
  commit: string;
  path: string;
  entries: TreeEntry[];
}

export interface DocumentFile {
  ref: string;
  commit: string;
  path: string;
  size: number;
  /** `json` when the path ends in .json and parses. */
  format: "text" | "json";
  content: string;
  json?: unknown;
}

/** What reading a file at a commit found. */
export type FileRead =
  | { status: "ok"; size: number; content: string }
  | { status: "missing" }
  | { status: "not-a-file" }
  | { status: "too-large"; size: number }
  | { status: "binary"; size: number };

/** Largest file the documents API serves (and the stage results read). */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** Stages with a results view. */
export const RESULT_STAGES = ["assess", "map", "extract-rules", "harden"] as const;
export type ResultStage = (typeof RESULT_STAGES)[number];

/** A stage output file found at the ref. */
export interface StageFile {
  path: string;
  size: number;
}

/** The ref a stage's results were read at, and what it is. */
export type ResultRef = DocumentRef;

interface StageResultsBase {
  stage: ResultStage;
  applicationId: string;
  ref: ResultRef;
  /** The stage's output files at the ref. */
  files: StageFile[];
  /** True when none of the stage's outputs exist at the ref. */
  empty: boolean;
  /** The main document, raw Markdown (capped at MAX_DOCUMENT_BYTES). */
  document?: { path: string; markdown: string };
  /** Numbers for KPI cards and the comparison with the previous run. */
  counts: Record<string, number>;
  /** One or two short phrases for the Delivery overview ("52 SLOC", "6 files"). */
  headline: string[];
  /** The counts of the stage's previous successful run, when asked for and known. */
  previous?: { ref: ResultRef; counts: Record<string, number> };
}

export interface AssessResults extends StageResultsBase {
  stage: "assess";
  inventory: Inventory | null;
  /** ARCHITECTURE.mmd (Mermaid source). */
  architecture?: string;
  highlights: {
    summary?: string;
    recommendation?: string;
    /** The Technical Debt table. */
    debt: Table | null;
    /** The Security Findings section. */
    security: Finding[];
    /** Documentation gaps, confidence notes and questions for an SME. */
    gaps: string[];
  };
}

export interface MapNode {
  id: string;
  name: string;
  kind: string;
  domain?: string;
  language?: string;
  loc: number;
  file?: string;
  description?: string;
  inDegree: number;
  outDegree: number;
  entryPoint: boolean;
  deadEnd: boolean;
}

export interface MapDiagram {
  id: "call-graph" | "data-lineage" | "critical-path";
  title: string;
  path: string;
  source: string;
}

export interface MapResults extends StageResultsBase {
  stage: "map";
  topology: {
    system: string;
    nodes: MapNode[];
    edges: TopoEdge[];
    flows: TopoFlow[];
    observations: string[];
    domains: string[];
  } | null;
  diagrams: MapDiagram[];
  /** topology.summary.txt. */
  summary?: string;
}

export interface RulesResults extends StageResultsBase {
  stage: "extract-rules";
  rules: CatalogRule[];
  dataObjects: DataObject[];
  stats: Record<string, number>;
  /** Parts of the code that were not fully mined (Coverage gaps of BUSINESS_RULES.md, skipped phases). */
  coverageGaps: string[];
  source: "result" | "markdown" | "none";
}

export interface HardenResults extends StageResultsBase {
  stage: "harden";
  report: SecurityReport | null;
  patch?: { path: string; text: string; hunks: number; files: string[]; findings: string[] };
  /** Restricted records of the run (count only, never names or content). */
  restrictedRecords: number;
  runId?: string;
}

export type StageResults = AssessResults | MapResults | RulesResults | HardenResults;

/** Headline numbers of every result stage of one application, for the Delivery overview. */
export interface StageHeadline {
  stage: ResultStage;
  headline: string[];
  ref?: ResultRef;
}
