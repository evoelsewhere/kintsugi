import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  atxHeading,
  BRAIN_MAX_LINKS_PER_NODE,
  BRAIN_ROOT_ID,
  buildBrainDocument,
  buildBrainTree,
  isBrainIndexedPath,
  parseBrainNodeId,
} from "../src/brain.js";
import { describeDocumentFolder } from "../src/document-layout.js";
import { headingSlug } from "../src/heading-slug.js";

const SPEC = [
  "---",
  'status: "understood"',
  "rules: 2",
  'digest: "0123456789abcdef0123456789abcdef"',
  "---",
  "# Calculate tax",
  "",
  "How the legacy batch computes the tax of an invoice line.",
  "",
  "## Business rules",
  "",
  "| ID | Name |",
  "| --- | --- |",
  "| RULE-INV01-0001 | Late fee |",
  "| RULE-INV01-0002 | Rounding |",
  "",
  "### RULE-INV01-0001: Late fee",
  "",
  "- **priority:** P0",
  "- **confidence:** High",
  "",
  "### RULE-INV01-0002: Rounding",
  "",
  "Amounts round half up to two decimals, see [the data objects](data-objects.md#invoice-line).",
  "",
  "## Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  A --> B",
  "## not a heading",
  "```",
  "",
  "## Flow",
  "",
  "Second section with the same title.",
].join("\n");

describe("buildBrainDocument", () => {
  const { nodes, links } = buildBrainDocument("10-applications/billing/01-legacy/invoice/tax/spec.md", SPEC);
  const byTitle = (title: string) => nodes.filter((node) => node.title === title);

  it("takes the single top heading as the title and its intro as the summary", () => {
    const document = nodes[0];
    expect(document).toMatchObject({ kind: "document", title: "Calculate tax", lineStart: 1, lineEnd: 9, children: 3 });
    expect(document?.summary).toBe("How the legacy batch computes the tax of an invoice line.");
    expect(document?.summarySource).toBe("text");
  });

  it("makes a card of a heading that starts with a reference id, anchored by the id", () => {
    const [card] = byTitle("RULE-INV01-0001: Late fee");
    expect(card).toMatchObject({ kind: "card", anchor: "RULE-INV01-0001", ids: ["RULE-INV01-0001"], summarySource: "fields" });
    expect(card?.summary).toBe("priority: P0 · confidence: High");
    expect(card?.parentId).toBe("10-applications/billing/01-legacy/invoice/tax/spec.md#business-rules");
  });

  it("summarises a table, a diagram and ignores headings inside code", () => {
    const [rules] = byTitle("Business rules");
    expect(rules).toMatchObject({ summarySource: "table", children: 2, lineStart: 10, lineEnd: 16, subtreeEnd: 25 });
    expect(rules?.summary).toBe("Table of 2 rows: ID, Name. Rows: RULE-INV01-0001; RULE-INV01-0002.");
    const flows = byTitle("Flow");
    expect(flows.map((flow) => flow.anchor)).toEqual(["flow", "flow-1"]);
    expect(flows[0]).toMatchObject({ summarySource: "diagram", summary: "Mermaid diagram (flowchart)." });
    expect(nodes.some((node) => node.title === "not a heading")).toBe(false);
  });

  it("records relative links and id mentions of every node", () => {
    expect(links).toContainEqual({
      fromId: "10-applications/billing/01-legacy/invoice/tax/spec.md#RULE-INV01-0002",
      path: "10-applications/billing/01-legacy/invoice/tax/data-objects.md",
      anchor: "invoice-line",
    });
    expect(links).toContainEqual({ fromId: "10-applications/billing/01-legacy/invoice/tax/spec.md#business-rules", id: "RULE-INV01-0001" });
  });

  it("prefers the prose after a list of fields to the fields", () => {
    const readme = [
      "# `00-project/`",
      "",
      "- Written by: people",
      "- Serves: P0",
      "",
      "The project-wide documents agreed before the migration work.",
      "",
      "| File | Content |",
      "| --- | --- |",
      "| `charter.md` | the objective |",
    ].join("\n");
    const { nodes: only } = buildBrainDocument("00-project/README.md", readme);
    expect(only[0]).toMatchObject({ title: "00-project/", summary: "The project-wide documents agreed before the migration work. Rows: charter.md.", summarySource: "paragraph" });
  });

  it("falls back to front matter facts, without opaque values", () => {
    const { nodes: only } = buildBrainDocument("understanding.md", "---\nstatus: \"understood\"\nrules: 4\ndigest: \"abcdefabcdefabcdefabcdef\"\n---\n");
    expect(only[0]).toMatchObject({ title: "understanding", summary: "status: understood · rules: 4", summarySource: "facts" });
  });

  it("sums up a document that opens on its sections by its Summary or Decision section", () => {
    const rule = [
      "---",
      'id: "RULE-SPL03-0002"',
      'name: "Monetary amounts are signed"',
      'category: "Calculation"',
      "---",
      "",
      "# RULE-SPL03-0002: Monetary amounts are signed",
      "",
      "## Specification",
      "",
      "```text",
      "Given an account",
      "```",
      "",
      "## Summary",
      "",
      "Every money value is a signed number with two decimals.",
    ].join("\n");
    expect(buildBrainDocument("rules/RULE-SPL03-0002.md", rule).nodes[0]).toMatchObject({
      title: "RULE-SPL03-0002: Monetary amounts are signed",
      summary: "Every money value is a signed number with two decimals.",
      summarySource: "section",
    });
    const decision = "# ADR-001: Use Kafka\n\n## Context\n\nThe services exchange events.\n\n## Decision\n\nThe services use a managed Kafka service.";
    expect(buildBrainDocument("adr/ADR-001.md", decision).nodes[0]).toMatchObject({ summary: "The services use a managed Kafka service.", summarySource: "section" });
  });

  it("follows a sentence that ends on a colon with the list it introduces", () => {
    const decision = "# ADR-0001: Build a modular monolith\n\n## Decision\n\nBuild one repository with these modules:\n\n- `api`: the REST back end\n- `web`: the React client\n\n## Consequences\n\nOne build.";
    expect(buildBrainDocument("adr/0001.md", decision).nodes[0]?.summary).toBe("Build one repository with these modules: api: the REST back end; web: the React client");
  });

  it("takes the first section in prose before front matter facts, and a front matter name as the title", () => {
    const mapping = '---\nstatus: "draft"\nversion: 1\n---\n## Mapping\n\n| From | To |\n| --- | --- |\n| a | b |\n\n## Notes\n\nA VSAM browse becomes a paged query.';
    // The table is the Mapping section's own; the first section in prose says what the document is.
    expect(buildBrainDocument("mappings/browse.md", mapping).nodes[0]).toMatchObject({ summary: "A VSAM browse becomes a paged query.", summarySource: "section" });
    const named = '---\nname: "Browse paging"\nstatus: "draft"\n---\n## Notes\n\nA VSAM browse becomes a paged query.';
    expect(buildBrainDocument("mappings/browse.md", named).nodes[0]).toMatchObject({
      title: "Browse paging",
      summary: "A VSAM browse becomes a paged query.",
      summarySource: "section",
    });
  });

  it("prefers a document's own summary and id", () => {
    const { nodes: only } = buildBrainDocument("rules/RULE-INV01-0001.md", '---\nid: "RULE-INV01-0001"\ntitle: "Late fee"\nsummary: "A fee applies after 30 days."\n---\nBody.');
    expect(only[0]).toMatchObject({ title: "Late fee", summary: "A fee applies after 30 days.", summarySource: "front-matter", ids: ["RULE-INV01-0001"] });
  });
});

describe("buildBrainTree", () => {
  const tree = buildBrainTree(
    [
      { path: "01-standards/conventions/naming.md", text: "# Naming\n\nUse kebab-case for files." },
      { path: "01-standards/README.md", text: "# Standards\n\nHow this project writes code." },
      { path: "10-applications/billing/01-legacy/invoice/tax/spec.md", text: SPEC },
      { path: "10-applications/billing/01-legacy/invoice/tax/data-objects.md", text: "## Invoice line\n\nSource: `INVLINE.cpy`" },
      { path: "10-applications/billing/01-legacy/invoice/tax/identifiers/rules-ids.md", text: "| ID |\n| --- |\n| RULE-INV01-0001 |" },
      { path: "plugins/demo/skills/x/SKILL.md", text: "# Skill" },
      { path: "kintsugi.yaml", text: "name: x" },
    ],
    "shop @ main",
  );
  const node = (id: string) => tree.nodes.find((candidate) => candidate.id === id);

  it("builds folders from the paths, README first, with layout or README summaries", () => {
    expect(node(BRAIN_ROOT_ID)).toMatchObject({ kind: "root", title: "shop @ main", children: 2 });
    expect(node("01-standards/")).toMatchObject({ kind: "folder", summarySource: "readme", summary: "How this project writes code.", children: 2 });
    expect(node("01-standards/conventions/")?.ordinal).toBe(0);
    expect(node("01-standards/README.md")?.ordinal).toBe(1);
    expect(node("10-applications/billing/01-legacy/")).toMatchObject({ summarySource: "layout" });
    expect(node("10-applications/billing/01-legacy/invoice/tax/spec.md")?.depth).toBe(6);
  });

  it("leaves out plugins, ledgers and non-Markdown files", () => {
    expect(tree.documents).toBe(4);
    expect(tree.nodes.some((candidate) => candidate.path.startsWith("plugins"))).toBe(false);
    expect(tree.nodes.some((candidate) => candidate.path.includes("identifiers"))).toBe(false);
  });

  it("resolves links to nodes and ids to the cards that define them", () => {
    expect(tree.identifiers).toBe(2);
    expect(tree.links).toContainEqual({
      fromId: "10-applications/billing/01-legacy/invoice/tax/spec.md#RULE-INV01-0002",
      toId: "10-applications/billing/01-legacy/invoice/tax/data-objects.md#invoice-line",
      kind: "link",
    });
    expect(tree.links).toContainEqual({
      fromId: "10-applications/billing/01-legacy/invoice/tax/spec.md#business-rules",
      toId: "10-applications/billing/01-legacy/invoice/tax/spec.md#RULE-INV01-0001",
      kind: "id",
    });
  });

  it("stores at most BRAIN_MAX_LINKS_PER_NODE links of a node and keeps the total of one that has more (P-036)", () => {
    const linking = (count: number) =>
      buildBrainTree(
        [
          { path: "00-project/index.md", text: `# Index\n\n${Array.from({ length: count }, (_, n) => `- [Page ${n}](p${n}.md)`).join("\n")}` },
          ...Array.from({ length: count }, (_, n) => ({ path: `00-project/p${n}.md`, text: `# Page ${n}\n\nText.` })),
        ],
        "x",
      );
    const from = (built: ReturnType<typeof linking>) => built.links.filter((link) => link.fromId === "00-project/index.md").length;
    const atCap = linking(BRAIN_MAX_LINKS_PER_NODE);
    expect(from(atCap)).toBe(BRAIN_MAX_LINKS_PER_NODE);
    expect(atCap.linkTotals).toEqual({});
    const over = linking(BRAIN_MAX_LINKS_PER_NODE + 1);
    expect(from(over)).toBe(BRAIN_MAX_LINKS_PER_NODE);
    expect(over.linkTotals).toEqual({ "00-project/index.md": BRAIN_MAX_LINKS_PER_NODE + 1 });
  });

  it("says what a folder without a README holds, by the titles of its one-document folders", () => {
    const units = buildBrainTree(
      [
        { path: "10-applications/shop/01-legacy/returns/rtn01/spec.md", text: "# Unopened articles\n\nHow an unopened article is taken back." },
        { path: "10-applications/shop/01-legacy/returns/rtn02/spec.md", text: "# Articles that arrive broken\n\nHow a broken article is handled." },
      ],
      "x",
    );
    const at = (id: string) => units.nodes.find((candidate) => candidate.id === id);
    expect(at("10-applications/shop/01-legacy/returns/rtn02/")).toMatchObject({
      summary: "Articles that arrive broken: How a broken article is handled.",
      summarySource: "children",
    });
    expect(at("10-applications/shop/01-legacy/returns/")?.summary).toBe(
      "Module returns of the old system of shop. Holds: rtn01 (Unopened articles) · rtn02 (Articles that arrive broken).",
    );
  });

  it("starts the summary of a retired document with its status", () => {
    const { nodes: only } = buildBrainDocument("adr/ADR-002.md", '---\nstatus: "superseded"\nsupersededBy: "ADR-003"\n---\n# ADR-002: Keep sessions in Redis\n\nSessions live in a shared cache.');
    expect(only[0]?.summary).toBe("Superseded by ADR-003. Sessions live in a shared cache.");
  });

  it("names the rows of a table, with the text of a short code", () => {
    const { nodes: only } = buildBrainDocument("risks.md", "# Risks\n\n| ID | Risk |\n| --- | --- |\n| R-01 | Prices differ |\n| R-02 | Team leaves |");
    expect(only[0]?.summary).toBe("Table of 2 rows: ID, Risk. Rows: R-01 Prices differ; R-02 Team leaves.");
  });

  it("keeps the last change of each document and the latest one up the folders", () => {
    const early = { commit: "a".repeat(40), at: "2026-10-01T10:00:00.000Z", subject: "Add the standards" };
    const late = { commit: "b".repeat(40), at: "2026-10-20T10:00:00.000Z", subject: "Rename the tables" };
    const dated = buildBrainTree(
      [
        { path: "01-standards/README.md", text: "# Standards\n\nHow we write code.", changed: early },
        { path: "01-standards/naming.md", text: "# Naming\n\n## Tables\n\nPlural names.", changed: late },
        { path: "00-project/charter.md", text: "# Charter" },
      ],
      "x",
    );
    const at = (id: string) => dated.nodes.find((candidate) => candidate.id === id);
    expect(at("01-standards/naming.md")?.changed).toEqual(late);
    expect(at("01-standards/naming.md#tables")?.changed).toBeNull();
    expect(at("01-standards/")?.changed).toEqual(late);
    expect(at("00-project/")?.changed).toBeNull();
    expect(at("/")?.changed).toEqual(late);
  });

  it("sums tokens up the folders", () => {
    const standards = node("01-standards/");
    const naming = node("01-standards/conventions/naming.md");
    const readme = node("01-standards/README.md");
    expect(standards?.subtreeTokens).toBe((naming?.subtreeTokens ?? 0) + (readme?.subtreeTokens ?? 0));
  });
});

describe("helpers", () => {
  it("indexes Markdown outside excluded folders only", () => {
    expect(isBrainIndexedPath("00-project/charter.md")).toBe(true);
    expect(isBrainIndexedPath("restricted/secret.md")).toBe(false);
    expect(isBrainIndexedPath("10-applications/a/restricted/x.md")).toBe(false);
    expect(isBrainIndexedPath(".github/README.md")).toBe(false);
    expect(isBrainIndexedPath("scratch/a/x.md")).toBe(false);
  });

  it("parses node ids", () => {
    expect(parseBrainNodeId("/")).toEqual({ path: "", anchor: null });
    expect(parseBrainNodeId("01-standards/")).toEqual({ path: "01-standards", anchor: null });
    expect(parseBrainNodeId("a/b.md#x-y")).toEqual({ path: "a/b.md", anchor: "x-y" });
  });

  it("keeps letters of any script in anchors", () => {
    expect(headingSlug("Quy tắc làm tròn (v2)")).toBe("quy-tắc-làm-tròn-v2");
    expect(headingSlug("`code` **bold**")).toBe("code-bold");
  });

  it("describes the folders of the layout", () => {
    expect(describeDocumentFolder("01-standards")).toMatch(/^Standards/);
    expect(describeDocumentFolder("10-applications/billing/02-modern/invoice/tax")).toMatch(/^Unit invoice\/tax in the new system/);
    expect(describeDocumentFolder("10-applications/billing/01-legacy/invoice/tax/rules")).toMatch(/business rules/);
    expect(describeDocumentFolder("somewhere/else")).toBeUndefined();
  });
});

describe("ATX headings (T3-011)", () => {
  const OLD = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
  const old = (line: string): { level: number; text: string } | undefined => {
    const match = OLD.exec(line);
    return match === null ? undefined : { level: match[1]!.length, text: match[2]! };
  };

  it("reads every line as the regex it replaces did", () => {
    const lines = ["# Title", "## Title ##", "### a b c   ", "# C# notes", "# x #y", "#nospace", "# ", "#  ", "#### Deep ###   ", "# a #", "# #", "# C#", "# a ## ##", "####### seven", "#\ttab", "# a\rb"];
    let seed = 11;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const alphabet = ["#", " ", "\t", "a", "\r"];
    for (let index = 0; index < 5000; index++) {
      const marker = "#".repeat(Math.floor(next() * 8));
      lines.push(marker + Array.from({ length: Math.floor(next() * 9) }, () => alphabet[Math.floor(next() * alphabet.length)]).join(""));
    }
    for (const line of lines) expect(atxHeading(line), JSON.stringify(line)).toEqual(old(line));
  });

  it("reads a heading with a long run of spaces in linear time", () => {
    const started = performance.now();
    const document = buildBrainDocument("10-applications/a/01-legacy/x.md", `# a${" ".repeat(200_000)}x\n\nbody\n`);
    expect(performance.now() - started).toBeLessThan(500);
    expect(document).toBeDefined();
  });
});

describe("links (T3-016)", () => {
  it("reads a document of 2 MB of link starts in linear time", () => {
    for (const text of ["[".repeat(2_000_000), "[a](".repeat(500_000), `${"[a](".repeat(1_000)}\n`.repeat(500), "[a](<".repeat(400_000)]) {
      const started = performance.now();
      buildBrainDocument("10-applications/a/01-legacy/x.md", text);
      expect(performance.now() - started, text.slice(0, 10)).toBeLessThan(500);
    }
  });

  it("still finds real links: plain, in angle brackets with a title, in a table cell", () => {
    const text = "# A\n\nSee [design](../x/README.md) and [t](<sp ace.md> \"title\").\n\n| a | b |\n|---|---|\n| [cell](../y/README.md#part) | x |\n";
    const { links } = buildBrainDocument("10-applications/billing/02-modern/a/README.md", text);
    const paths = links.flatMap((link) => ("path" in link ? [`${link.path}${link.anchor === undefined ? "" : `#${link.anchor}`}`] : []));
    expect(paths).toEqual(["10-applications/billing/02-modern/x/README.md", "10-applications/billing/02-modern/a/sp ace.md", "10-applications/billing/02-modern/y/README.md#part"]);
  });
});

// The one heading slug (P2-006): the anchors the builder gives now are the ones it gave before it shared `headingSlug`.
// The reference below is that code as it was, frozen; every section and card of the repository's own documents, its
// templates and the eval fixtures must get the anchor it computes.
const legacyPlain = (text: string): string =>
  text
    .replace(/!\[[^[\]]*\]\([^)[]*\)/g, "")
    .replace(/\[([^[\]]*)\]\([^)[]*\)/g, "$1")
    .replace(/<[^<>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
const legacyAnchor = (heading: string): string => {
  const slug = legacyPlain(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
  return slug === "" ? "section" : slug;
};

describe("the anchors of sections and cards", () => {
  const corpora = ["docs", "templates", "packages/agents/evals/brain/fixture/shop-docs", "packages/agents/evals/brain/fixture/wiki-docs"];

  /** The Markdown files under a folder, by path from it. */
  const markdownUnder = (dir: URL, prefix = ""): string[] =>
    readdirSync(dir).flatMap((name: string): string[] => {
      const entry = new URL(name, dir);
      if (statSync(entry).isDirectory()) return name === "node_modules" ? [] : markdownUnder(new URL(`${name}/`, dir), `${prefix}${name}/`);
      return name.toLowerCase().endsWith(".md") ? [`${prefix}${name}`] : [];
    });

  it("are those the frozen reference computes, numbered the same way", () => {
    let checked = 0;
    for (const corpus of corpora) {
      const root = new URL(`../../../${corpus}/`, import.meta.url);
      for (const path of markdownUnder(root)) {
        const text = readFileSync(new URL(path, root), "utf8");
        const lines = text.split("\n");
        const used = new Set<string>();
        const unique = (anchor: string): string => {
          let candidate = anchor;
          for (let suffix = 1; used.has(candidate); suffix += 1) candidate = `${anchor}-${suffix}`;
          used.add(candidate);
          return candidate;
        };
        for (const node of buildBrainDocument(path, text).nodes.slice(1)) {
          const heading = atxHeading(lines[(node.lineStart ?? 1) - 1] ?? "");
          const expected = unique(node.kind === "card" ? (node.ids[0] ?? "") : legacyAnchor(heading?.text ?? ""));
          expect(node.anchor, `${corpus}/${path}:${node.lineStart}`).toBe(expected);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
