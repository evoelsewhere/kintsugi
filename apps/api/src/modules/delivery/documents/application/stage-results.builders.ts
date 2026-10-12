// The results of each stage with a results view, built from the files it wrote under
// `assessment/<app>/` with the parsers of @kintsugi/agents/reader (never parsed again here).
// Each stage has a full build (the results tab) and a counts build that reads as little as
// possible (the Delivery overview's headline numbers and the comparison with the previous run).

import {
  bulletsIn,
  findingsOfTable,
  paragraphsIn,
  parseInventory,
  parseSecurityFindings,
  parseTopology,
  patchSummary,
  ruleCatalog,
  sectionMatching,
  sectionsOf,
  tablesIn,
  type Inventory,
  type RuleCatalog,
  type SecurityReport,
  type Topology,
} from "@kintsugi/agents/reader";
import type { AssessResults, HardenResults, MapDiagram, MapNode, MapResults, ResultStage, RulesResults, StageFile } from "../domain/document.js";

/** The stage's output directory at one commit: what is there, and a reader for a file in it. */
export interface StageSource {
  files: StageFile[];
  /** A file by its name in `assessment/<app>/`; null when missing, too large or binary. */
  read(name: string): Promise<string | null>;
}

/** What every build returns besides the stage-specific fields. */
interface Built {
  counts: Record<string, number>;
  headline: string[];
  document?: { path: string; markdown: string };
}

type Full<T> = Omit<T, "stage" | "applicationId" | "ref" | "files" | "empty" | "previous">;

/** The files each stage writes (under assessment/<app>/), its main document and the files its counts need. */
export const STAGE_OUTPUTS: Record<ResultStage, { files: readonly string[]; main?: string; countsFrom: readonly string[] }> = {
  assess: { files: ["inventory.json", "ASSESSMENT.md", "ARCHITECTURE.mmd"], main: "ASSESSMENT.md", countsFrom: ["inventory.json"] },
  map: {
    files: ["topology.json", "topology.summary.txt", "call-graph.mmd", "data-lineage.mmd", "critical-path.mmd", "extract_topology.py", "TOPOLOGY_SCRIPT.md"],
    countsFrom: ["topology.json"],
  },
  "extract-rules": {
    files: ["rules_result.json", "BUSINESS_RULES.md", "DATA_OBJECTS.md", "extract-rules.modules.json"],
    main: "BUSINESS_RULES.md",
    countsFrom: ["rules_result.json", "BUSINESS_RULES.md"],
  },
  harden: { files: ["SECURITY_FINDINGS.md", "security_remediation.patch"], main: "SECURITY_FINDINGS.md", countsFrom: ["SECURITY_FINDINGS.md"] },
};

const plural = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

// ---- assess ---------------------------------------------------------------------------------

function assessCounts(inventory: Inventory | null): Pick<Built, "counts" | "headline"> {
  if (inventory === null) return { counts: {}, headline: [] };
  return {
    counts: {
      files: inventory.sourceFileCount,
      sloc: inventory.sloc,
      ksloc: inventory.ksloc,
      complexityIndex: inventory.complexityIndex,
      languages: inventory.languages.length,
    },
    headline: [`${inventory.sloc.toLocaleString("en-US")} SLOC`, plural(inventory.sourceFileCount, "file")],
  };
}

export async function assessResults(source: StageSource, appDir: string): Promise<Full<AssessResults>> {
  const [inventoryText, markdown, architecture] = await Promise.all([source.read("inventory.json"), source.read("ASSESSMENT.md"), source.read("ARCHITECTURE.mmd")]);
  const inventory = inventoryText === null ? null : parseInventory(inventoryText);
  const sections = markdown === null ? [] : sectionsOf(markdown);
  const section = (pattern: RegExp) => sectionMatching(sections, pattern);
  const debt = section(/technical debt/i);
  const security = section(/security/i);
  const gaps = [section(/documentation gaps/i), section(/confidence|gaps/i)].flatMap((entry) => (entry === undefined ? [] : bulletsIn(entry.body)));
  const { counts, headline } = assessCounts(inventory);
  const findings = security === undefined ? [] : tablesIn(security.body).flatMap((table) => findingsOfTable(table));
  const debtTable = debt === undefined ? null : (tablesIn(debt.body)[0] ?? null);
  const summary = section(/executive summary|summary/i);
  const recommendation = section(/recommend/i);
  return {
    inventory,
    ...(architecture === null ? {} : { architecture }),
    highlights: {
      ...(summary === undefined || paragraphsIn(summary.body)[0] === undefined ? {} : { summary: paragraphsIn(summary.body)[0] }),
      ...(recommendation === undefined || paragraphsIn(recommendation.body)[0] === undefined ? {} : { recommendation: paragraphsIn(recommendation.body)[0] }),
      debt: debtTable,
      security: findings,
      gaps: [...new Set(gaps)],
    },
    counts: { ...counts, debtItems: debtTable?.rows.length ?? 0, securityFindings: findings.length },
    headline,
    ...(markdown === null ? {} : { document: { path: `${appDir}/ASSESSMENT.md`, markdown } }),
  };
}

export async function assessHeadline(source: StageSource): Promise<Pick<Built, "counts" | "headline">> {
  const text = await source.read("inventory.json");
  return assessCounts(text === null ? null : parseInventory(text));
}

// ---- map ------------------------------------------------------------------------------------

const STRUCTURAL = new Set(["system", "domain"]);

function mapNodes(topology: Topology): MapNode[] {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const edge of topology.edges) {
    outbound.set(edge.source, (outbound.get(edge.source) ?? 0) + 1);
    inbound.set(edge.target, (inbound.get(edge.target) ?? 0) + 1);
  }
  return topology.nodes
    .filter((node) => !STRUCTURAL.has(node.kind))
    .map((node) => ({
      ...node,
      inDegree: inbound.get(node.id) ?? 0,
      outDegree: outbound.get(node.id) ?? 0,
      entryPoint: topology.entryPoints.has(node.id),
      deadEnd: topology.deadEnds.has(node.id),
    }));
}

function mapCounts(topology: Topology | null): Pick<Built, "counts" | "headline"> {
  if (topology === null) return { counts: {}, headline: [] };
  const nodes = mapNodes(topology);
  const dataStores = nodes.filter((node) => node.kind === "datastore").length;
  return {
    counts: {
      nodes: nodes.length,
      modules: topology.modules.length,
      edges: topology.edges.length,
      entryPoints: topology.entryPoints.size,
      deadEnds: topology.deadEnds.size,
      dataStores,
      flows: topology.flows.length,
    },
    headline: [plural(topology.modules.length, "module"), plural(topology.edges.length, "edge")],
  };
}

const DIAGRAMS: Array<Omit<MapDiagram, "path" | "source">> = [
  { id: "call-graph", title: "Call graph" },
  { id: "data-lineage", title: "Data lineage" },
  { id: "critical-path", title: "Critical path" },
];

export async function mapResults(source: StageSource, appDir: string): Promise<Full<MapResults>> {
  const [topologyText, summary, ...diagramSources] = await Promise.all([
    source.read("topology.json"),
    source.read("topology.summary.txt"),
    ...DIAGRAMS.map((diagram) => source.read(`${diagram.id}.mmd`)),
  ]);
  const topology = topologyText === null ? null : parseTopology(topologyText);
  const diagrams = DIAGRAMS.flatMap((diagram, index) => {
    const text = diagramSources[index];
    return text === null || text === undefined ? [] : [{ ...diagram, path: `${appDir}/${diagram.id}.mmd`, source: text }];
  });
  const nodes = topology === null ? [] : mapNodes(topology);
  return {
    topology:
      topology === null
        ? null
        : {
            system: topology.system,
            nodes,
            edges: topology.edges,
            flows: topology.flows,
            observations: topology.observations,
            domains: [...new Set(nodes.map((node) => node.domain).filter((domain): domain is string => domain !== undefined))],
          },
    diagrams,
    ...(summary === null ? {} : { summary }),
    ...mapCounts(topology),
  };
}

export async function mapHeadline(source: StageSource): Promise<Pick<Built, "counts" | "headline">> {
  const text = await source.read("topology.json");
  return mapCounts(text === null ? null : parseTopology(text));
}

// ---- extract-rules ----------------------------------------------------------------------------

function rulesCounts(catalog: RuleCatalog): Pick<Built, "counts" | "headline"> {
  const confirmed = catalog.rules.filter((rule) => rule.status !== "refuted");
  const byPriority = (priority: string) => confirmed.filter((rule) => rule.priority === priority).length;
  if (catalog.source === "none") return { counts: {}, headline: [] };
  return {
    counts: {
      rules: confirmed.length,
      p0: byPriority("P0"),
      p1: byPriority("P1"),
      p2: byPriority("P2"),
      refuted: catalog.rules.length - confirmed.length,
      needsReview: confirmed.filter((rule) => rule.smeQuestion !== undefined || rule.suspectedDefect !== undefined || (rule.confidence !== undefined && rule.confidence !== "High")).length,
      possibleDuplicates: confirmed.filter((rule) => rule.duplicateGroup !== undefined).length,
      dataObjects: catalog.dataObjects.length,
    },
    headline: [plural(confirmed.length, "rule"), `${byPriority("P0")} P0`],
  };
}

export async function rulesResults(source: StageSource, appDir: string): Promise<Full<RulesResults>> {
  const [result, markdown, dataObjects] = await Promise.all([source.read("rules_result.json"), source.read("BUSINESS_RULES.md"), source.read("DATA_OBJECTS.md")]);
  const catalog = ruleCatalog(result, markdown, dataObjects);
  const gaps = markdown === null ? undefined : sectionMatching(sectionsOf(markdown), /coverage gaps/i);
  return {
    rules: catalog.rules,
    dataObjects: catalog.dataObjects,
    stats: catalog.stats,
    coverageGaps: [...new Set([...(gaps === undefined ? [] : bulletsIn(gaps.body)), ...catalog.skippedPhases])],
    source: catalog.source,
    ...rulesCounts(catalog),
    ...(markdown === null ? {} : { document: { path: `${appDir}/BUSINESS_RULES.md`, markdown } }),
  };
}

export async function rulesHeadline(source: StageSource): Promise<Pick<Built, "counts" | "headline">> {
  const result = await source.read("rules_result.json");
  // The Markdown is read only when there is no structured result.
  return rulesCounts(ruleCatalog(result, result === null ? await source.read("BUSINESS_RULES.md") : null, null));
}

// ---- harden ---------------------------------------------------------------------------------

function hardenCounts(report: SecurityReport | null): Pick<Built, "counts" | "headline"> {
  if (report === null) return { counts: {}, headline: [] };
  const { scorecard } = report;
  const severe = scorecard.Critical + scorecard.High;
  return {
    counts: {
      findings: scorecard.total,
      critical: scorecard.Critical,
      high: scorecard.High,
      medium: scorecard.Medium,
      low: scorecard.Low,
      refuted: report.refutedCount ?? 0,
      coverageGaps: report.coverageGaps.length,
    },
    headline: [plural(scorecard.total, "finding"), ...(severe > 0 ? [`${severe} critical/high`] : report.coverageGaps.length > 0 ? [plural(report.coverageGaps.length, "coverage gap")] : [])],
  };
}

export async function hardenResults(source: StageSource, appDir: string): Promise<Omit<Full<HardenResults>, "restrictedRecords" | "runId">> {
  const [markdown, patch] = await Promise.all([source.read("SECURITY_FINDINGS.md"), source.read("security_remediation.patch")]);
  const report = markdown === null ? null : parseSecurityFindings(markdown);
  const { counts, headline } = hardenCounts(report);
  const summary = patch === null ? undefined : patchSummary(patch);
  return {
    report,
    ...(patch === null || summary === undefined ? {} : { patch: { path: `${appDir}/security_remediation.patch`, text: patch, ...summary } }),
    counts: { ...counts, ...(summary === undefined ? {} : { hunks: summary.hunks }) },
    headline,
    ...(markdown === null ? {} : { document: { path: `${appDir}/SECURITY_FINDINGS.md`, markdown } }),
  };
}

export async function hardenHeadline(source: StageSource): Promise<Pick<Built, "counts" | "headline">> {
  const text = await source.read("SECURITY_FINDINGS.md");
  return hardenCounts(text === null ? null : parseSecurityFindings(text));
}
