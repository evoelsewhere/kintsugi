// Typed access to the document repo as Kintsugi's mirror holds it, and to the results of a stage
// built from it. Mirrors apps/api → modules/delivery/documents (read-only; never restricted/).

import { apiGet } from "../api";

export type RefStatus = "default" | "merged" | "open" | "commit";

export interface DocumentRef {
  ref: string;
  kind: "default" | "run" | "write" | "commit";
  commit: string;
  status: RefStatus;
  branch?: string;
  date?: string;
  stage?: string;
  applicationId?: string;
  runId?: string;
  writeId?: string;
  label: string;
}

export interface DocumentRefs {
  defaultBranch: string;
  refs: DocumentRef[];
}

export interface Citation {
  path: string;
  base: string;
  from: number;
  to: number;
}

export interface Table {
  header: string[];
  rows: string[][];
}

export interface InventoryLanguage {
  language: string;
  files: number;
  lines: number;
  sloc: number;
  complexity: number;
}

export interface InventoryFile {
  path: string;
  language: string;
  lines: number;
  sloc: number;
  complexity: number;
  bytes: number;
}

export interface Inventory {
  app?: string;
  sourceRepository?: string;
  sourceCommit?: string;
  method?: string;
  complexityIndexFormula?: string;
  fileCount: number;
  sourceFileCount: number;
  totalLines: number;
  sloc: number;
  ksloc: number;
  totalBytes: number;
  complexity: number;
  complexityIndex: number;
  complexityPerKsloc?: number;
  languages: InventoryLanguage[];
  files: InventoryFile[];
}

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";

export interface Finding {
  id: string;
  title: string;
  severity: Severity | "Unknown";
  /** How sure the scan is; older documents carry none. */
  confidence?: "High" | "Medium" | "Low";
  cwe?: string;
  location?: string;
  citations: Citation[];
  status: "confirmed" | "refuted" | "unverified";
  detail?: string;
}

/** A security highlight of the assessment and how it ended in harden. */
export interface CarryOverItem {
  id?: string;
  highlight: string;
  location?: string;
  severity?: Severity;
  verdict: "confirmed" | "refuted" | "not judged";
  /** The harden finding the highlight became. */
  findingId?: string;
  reason?: string;
}

export interface ToolNotRun {
  tool: string;
  reason?: string;
}

export interface SecurityReport {
  scorecard: Record<Severity, number> & { total: number };
  scorecardStated: boolean;
  topCwes?: string;
  refutedCount: number | null;
  /** How the code was reviewed and which files (newer documents only). */
  reviewCoverage?: string;
  coverageGaps: string[];
  coverageComplete: boolean;
  findings: Finding[];
  cves: Table | null;
  carryOver?: Table | null;
  /** Optional: payloads of older API builds lack it. */
  carryOverItems?: CarryOverItem[];
  toolsNotRun: Table | null;
  toolsNotRunItems?: ToolNotRun[];
  remediationLog: Table | null;
  patchReview: string[];
  injectionFlags?: string;
  credentials?: string;
}

export interface CatalogRule {
  id: string;
  name: string;
  category?: string;
  priority: string;
  confidence?: string;
  status: "confirmed" | "refuted" | "unverified";
  source?: string;
  plainEnglish?: string;
  given?: string;
  when?: string;
  then?: string;
  and?: string;
  parameters?: string;
  edgeCases: string[];
  suspectedDefect?: string;
  smeQuestion?: string;
  rejectionReason?: string;
  citations: Citation[];
  duplicateGroup?: number;
}

export interface DataObject {
  name: string;
  source?: string;
  fields: Array<{ name: string; type?: string; note?: string }>;
  consumedBy: string[];
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

export interface TopoEdge {
  source: string;
  target: string;
  kind: string;
}

export interface TopoFlow {
  name: string;
  persona?: string;
  description?: string;
  steps: Array<{ label: string; nodes: string[] }>;
}

export interface MapDiagram {
  id: "call-graph" | "data-lineage" | "critical-path";
  title: string;
  path: string;
  source: string;
}

export type ResultStage = "assess" | "map" | "extract-rules" | "harden" | "understand";

export const RESULT_STAGES: readonly ResultStage[] = ["assess", "map", "extract-rules", "harden", "understand"];

export const hasResultsView = (stage: string): stage is ResultStage => (RESULT_STAGES as readonly string[]).includes(stage);

interface ResultsBase {
  applicationId: string;
  ref: DocumentRef;
  files: Array<{ path: string; size: number }>;
  empty: boolean;
  document?: { path: string; markdown: string };
  counts: Record<string, number>;
  headline: string[];
  previous?: { ref: DocumentRef; counts: Record<string, number> };
}

export interface AssessResults extends ResultsBase {
  stage: "assess";
  inventory: Inventory | null;
  architecture?: string;
  highlights: { summary?: string; recommendation?: string; debt: Table | null; security: Finding[]; gaps: string[] };
}

export interface MapResults extends ResultsBase {
  stage: "map";
  topology: { system: string; nodes: MapNode[]; edges: TopoEdge[]; flows: TopoFlow[]; observations: string[]; domains: string[] } | null;
  diagrams: MapDiagram[];
  summary?: string;
}

export interface RulesResults extends ResultsBase {
  stage: "extract-rules";
  rules: CatalogRule[];
  dataObjects: DataObject[];
  stats: Record<string, number>;
  coverageGaps: string[];
  source: "result" | "markdown" | "none";
}

export interface HardenResults extends ResultsBase {
  stage: "harden";
  report: SecurityReport | null;
  patch?: { path: string; text: string; hunks: number; files: string[]; findings: string[] };
  restrictedRecords: number;
  runId?: string;
}

/** A unit of the understand stage: its row of traceability.json and its work item at the ref. */
export interface UnderstandUnit {
  id: string;
  /** `<module>/<unit>`. */
  key: string;
  module: string;
  unit: string;
  title: string;
  kind?: string;
  loc: number;
  entryPoint: boolean;
  /** The specification's path; null when none was written. */
  spec: string | null;
  files: string[];
  dependsOn: string[];
  usedBy: string[];
  dataStores: Array<{ id: string; access: string[] }>;
  externalSystems: string[];
  rules: string[];
  findings: string[];
  dataObjects: string[];
  entryPoints: string[];
  openQuestions: number;
  workItem?: { path: string; status: string; complexity?: string };
}

export interface AsIsDocument {
  id: "readme" | "architecture" | "data-model" | "integrations";
  title: string;
  path: string;
  markdown: string;
}

export interface UnderstandResults extends ResultsBase {
  stage: "understand";
  units: UnderstandUnit[];
  matrix: {
    path: string;
    inputs: { businessRules: boolean; securityFindings: boolean };
    rulesCovered: string[];
    findingsMapped: string[];
    unmappedRules: string[];
    unmappedFindings: string[];
    dataStores: string[];
    cycles: string[][];
    notes: Record<string, number>;
  } | null;
  documents: AsIsDocument[];
  missingInputs: Array<{ path: string; stage: string }>;
}

export type StageResults = AssessResults | MapResults | RulesResults | HardenResults | UnderstandResults;

/** A text file of the document repo at a ref. */
export interface DocumentFile {
  ref: string;
  commit: string;
  path: string;
  size: number;
  format: "text" | "json";
  content: string;
  json?: unknown;
}

export interface StageHeadline {
  stage: ResultStage;
  headline: string[];
  ref?: DocumentRef;
}

const project = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}`;

export const documentsApi = {
  refs: (projectId: string): Promise<DocumentRefs> => apiGet(`${project(projectId)}/documents/refs`),
  file: (projectId: string, path: string, ref?: string): Promise<DocumentFile> => {
    const query = new URLSearchParams({ path });
    if (ref !== undefined) query.set("ref", ref);
    return apiGet(`${project(projectId)}/documents/file?${query.toString()}`);
  },
  results: (projectId: string, applicationId: string, stage: ResultStage, options: { ref?: string | undefined; compare?: boolean } = {}): Promise<StageResults> => {
    const query = new URLSearchParams();
    if (options.ref !== undefined) query.set("ref", options.ref);
    if (options.compare === true) query.set("compare", "true");
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return apiGet(`${project(projectId)}/applications/${encodeURIComponent(applicationId)}/stages/${encodeURIComponent(stage)}/results${suffix}`);
  },
  headlines: (projectId: string, applicationId: string): Promise<StageHeadline[]> => apiGet(`${project(projectId)}/applications/${encodeURIComponent(applicationId)}/results/headlines`),
};
