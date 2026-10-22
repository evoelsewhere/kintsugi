// Document-repository fixtures for the API tests: the Markdown the assess and understand stages commit
// (ADR-0042), written by hand so a test does not need a stage to have run.

export interface CatalogItemFixture {
  id: string;
  name?: string;
  kind?: string;
  status?: "active" | "retired";
  files: string[];
  leaves?: string[];
  entryPoints?: string[];
  loc?: number;
  /** Items this one calls (kinds default to call). */
  dependsOn?: string[];
  /** Data stores it reads. */
  dataStores?: string[];
  aliases?: string[];
}

const table = (header: string[], rows: string[][]): string => [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

/** assessment/catalog/index.md and one document per module, as render_catalog.py writes them. */
export function catalogDocuments(
  app: string,
  modules: Array<{ id: string; name: string }>,
  items: CatalogItemFixture[],
  unassigned: string[] = [],
  /** The `<repository id>@<commit>` entries the catalog was built from (ADR-0052). */
  sources?: string[],
  ambiguities: string[] = [],
): Record<string, string> {
  const base = `10-applications/${app}/01-legacy/_catalog`;
  const documents: Record<string, string> = {};
  const active = items.filter((item) => item.status !== "retired");

  documents[`${base}/index.md`] = [
    "---",
    `app: "${app}"`,
    'generatedBy: "reconcile_catalog.py"',
    ...(sources === undefined ? [] : ["sources:", ...sources.map((entry) => `  - "${entry}"`)]),
    `modules: ${modules.length}`,
    `items: ${active.length}`,
    `retired: ${items.length - active.length}`,
    `unassigned: ${unassigned.length}`,
    "---",
    `# Item catalog of ${app}`,
    "",
    "## Modules",
    "",
    table(["Module", "Name", "Items", "Summary"], modules.map((module) => [module.id, module.name, String(items.filter((item) => item.id.startsWith(`${module.id}/`)).length), ""])),
    "",
    ...(ambiguities.length === 0 ? [] : ["## Ambiguities", "", ...ambiguities.map((line) => `- ${line}`), ""]),
    ...(unassigned.length === 0 ? [] : ["## Unassigned files", "", ...unassigned.map((file) => `- \`${file}\``), ""]),
  ].join("\n");

  for (const module of modules) {
    const lines = ["---", `module: "${module.id}"`, `name: "${module.name}"`, "---", `# ${module.name}`, ""];

    for (const item of items.filter((entry) => entry.id.startsWith(`${module.id}/`))) {
      const name = item.name ?? item.id.split("/")[1] ?? item.id;
      lines.push(
        `## ${item.id}: ${name}`,
        "",
        `- **kind:** ${item.kind ?? "module"}`,
        `- **status:** ${item.status ?? "active"}`,
        `- **loc:** ${item.loc ?? 10}`,
        "- **complexity:** low",
        `- **digest:** \`sha256:${item.id.split("/")[1]}\``,
        item.aliases === undefined ? "- **aliases:**" : ["- **aliases:**", ...item.aliases.map((alias) => `  - ${alias}`)].join("\n"),
        "",
      );
      if ((item.leaves ?? []).length > 0) {
        lines.push("### Leaves", "", table(["Leaf", "Name", "Kind", "File", "LOC", "Entry point"], (item.leaves ?? []).map((leaf) => [leaf, leaf, "module", item.files[0] ?? "", "", (item.entryPoints ?? []).includes(leaf) ? "yes" : ""])), "");
      }
      if ((item.dependsOn ?? []).length > 0) lines.push("### Depends on", "", table(["Item", "Kinds", "Edges"], (item.dependsOn ?? []).map((target) => [target, "call", "1"])), "");
      if ((item.dataStores ?? []).length > 0) lines.push("### Data stores", "", table(["Store", "Access"], (item.dataStores ?? []).map((store) => [store, "read"])), "");
      lines.push("### Files", "", ...item.files.map((file) => `- \`${file}\``), "");
    }
    documents[`${base}/${module.id}.md`] = lines.join("\n");
  }

  return documents;
}

export interface UnderstoodUnitOptions {
  digest: string;
  commit: string;
  runId?: string;
  rule?: { id: string; name: string; source: string };
  /** Outbound dependencies of its trace: items it calls, data stores it reads. */
  dependencies?: Array<{ target: string; kind?: string }>;
  findings?: string[];
  openQuestions?: number;
}

/** The documents of one understood unit, as the understand stage commits them (a minimal rule, no findings table). */
export function understoodUnit(app: string, item: string, options: UnderstoodUnitOptions): Record<string, string> {
  const base = `10-applications/${app}/01-legacy/${item}`;
  const bullets = (values: string[]): string => values.map((value) => `- \`${value}\`\n`).join("");
  const documents: Record<string, string> = {
    [`${base}/understanding.md`]: `---\napp: "${app}"\nitem: "${item}"\nstatus: "understood"\ndigest: "${options.digest}"\nsources:\n  - "legacy@${options.commit}"\n${options.runId === undefined ? "" : `runId: "${options.runId}"\n`}---\n# Understanding record - ${item}\n`,
    [`${base}/spec.md`]: `# ${item}\n`,
    [`${base}/trace.md`]: `---\napp: "${app}"\nitem: "${item}"\nopenQuestions: ${options.openQuestions ?? 0}\n---\n# Traceability - ${item}\n\n## Rules applied\n\n${bullets(options.rule === undefined ? [] : [options.rule.id])}\n## Findings\n\n${bullets(options.findings ?? [])}\n## Dependencies\n\n${table(["Target", "Kind", "Direction"], (options.dependencies ?? []).map((dependency) => [dependency.target, dependency.kind ?? "call", "outbound"]))}\n`,
  };

  if (options.rule !== undefined) {
    const { id, name, source } = options.rule;
    documents[`${base}/rules.md`] = [
      "---",
      `app: "${app}"`,
      `item: "${item}"`,
      "rules: 1",
      "---",
      `# Business rules - ${item}`,
      "",
      table(["ID", "Name", "Category", "Priority", "Confidence", "Version", "Status", "Source", "Rule file"], [[id, name, "Calculation", "P0", "High", "1", "confirmed", `\`${source}\``, `[${id}](rules/${id}.md)`]]),
      "",
    ].join("\n");
  }

  return documents;
}

/** The findings.md of a unit with the given findings (id, cwe, severity, location, title). */
export function findingsDocument(item: string, findings: Array<{ id: string; cwe: string; severity: string; source: string; title: string }>): string {
  return [
    "---",
    `item: "${item}"`,
    `findings: ${findings.length}`,
    "---",
    `# Security findings - ${item}`,
    "",
    "## Findings by severity",
    "",
    table(["ID", "CWE", "Severity", "Confidence", "Location", "Title", "Exploit scenario"], findings.map((finding) => [finding.id, finding.cwe, finding.severity, "High", `\`${finding.source}\``, finding.title, ""])),
    "",
  ].join("\n");
}
