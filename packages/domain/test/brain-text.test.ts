// How the Brain reads a document's text (ADR-0091): which paths it indexes, how it numbers lines, how it cuts and
// cleans summaries, which block of a node says what it is about, which headings make nodes, how front matter and
// links are read, and what a folder says it holds. Each case pins one rule the summaries an agent reasons over
// depend on.

import { describe, expect, it } from "vitest";
import { isWikiEditablePath } from "../src/document-layout.js";
import {
  BRAIN_ROOT_ID,
  type BrainNode,
  brainFolderId,
  brainLabels,
  brainLines,
  brainSectionId,
  brainTokens,
  buildBrainDocument,
  buildBrainTree,
  isBrainIndexedPath,
  parseBrainNodeId,
} from "../src/brain.js";

const nodesOf = (text: string, path = "notes/a.md"): BrainNode[] => buildBrainDocument(path, text).nodes;
const documentOf = (text: string, path?: string): BrainNode => nodesOf(text, path)[0]!;
/** The document's summary with where it came from: `paragraph: How the batch…`. */
const summaryOf = (text: string): string => {
  const node = documentOf(text);
  return `${node.summarySource}: ${node.summary}`;
};
const treeOf = (files: Record<string, string>) => buildBrainTree(Object.entries(files).map(([path, text]) => ({ path, text })), "docs");

describe("paths, ids and lines", () => {
  it("indexes Markdown of any case outside reserved, restricted and hidden folders", () => {
    expect(isBrainIndexedPath("Docs/UP.MD")).toBe(true);
    expect(isBrainIndexedPath("a/plugins/x.md")).toBe(true);
    expect(isBrainIndexedPath("a/scratch/x.md")).toBe(true);
    expect(isBrainIndexedPath("a/restricted.md")).toBe(true);
    for (const path of ["notes/a.txt", "a//b.md", "./a.md", "a/../b.md", ".github/a.md", "a/.hidden.md", "plugins/x/README.md", "scratch/x.md", "restricted/x.md", "a/restricted/x.md", "a/Restricted/x.md", "RESTRICTED/x.md", "a/identifiers/x.md"]) {
      expect(isBrainIndexedPath(path), path).toBe(false);
    }
  });

  it("leaves out the reserved roots and the excluded folders in any case, as the wiki editor does", () => {
    for (const path of ["Plugins/x.md", "PLUGINS/x/README.md", "SCRATCH/a/x.md", "Scratch/x.md", "Restricted/a.md", "x/Identifiers/a.md", "a/Restricted/b.md", "a/b/IDENTIFIERS/c.md"]) {
      expect(isBrainIndexedPath(path), path).toBe(false);
      expect(isWikiEditablePath(path), path).toBe(false);
    }
    for (const path of ["20-spaces/onb/a.md", "20-spaces/onb/README.md", "a/Plugins/x.md", "a/SCRATCH/x.md"]) {
      expect(isBrainIndexedPath(path), path).toBe(true);
    }
  });

  it("counts about four characters a token, rounding up", () => {
    expect(brainTokens("")).toBe(0);
    expect(brainTokens("abcd")).toBe(1);
    expect(brainTokens("abcde")).toBe(2);
  });

  it("names folders and sections, and reads a node id back, a # in a file name included", () => {
    expect(brainFolderId("")).toBe(BRAIN_ROOT_ID);
    expect(brainFolderId("a/b")).toBe("a/b/");
    expect(brainSectionId("a.md", "x")).toBe("a.md#x");
    expect(parseBrainNodeId("/")).toEqual({ path: "", anchor: null });
    expect(parseBrainNodeId("a/b/")).toEqual({ path: "a/b", anchor: null });
    expect(parseBrainNodeId("a/b.md")).toEqual({ path: "a/b.md", anchor: null });
    expect(parseBrainNodeId("a/b.md#notes-1")).toEqual({ path: "a/b.md", anchor: "notes-1" });
    expect(parseBrainNodeId("a/b.md#RULE-A1-0001")).toEqual({ path: "a/b.md", anchor: "RULE-A1-0001" });
    expect(parseBrainNodeId("a/b.md#quy-tắc")).toEqual({ path: "a/b.md", anchor: "quy-tắc" });
    expect(parseBrainNodeId("dotnet/C#-style.md")).toEqual({ path: "dotnet/C#-style.md", anchor: null });
    expect(parseBrainNodeId("dotnet/C#-style.md#naming")).toEqual({ path: "dotnet/C#-style.md", anchor: "naming" });
    expect(parseBrainNodeId("#x")).toEqual({ path: "#x", anchor: null });
    expect(parseBrainNodeId("notes/a.md#b.md")).toEqual({ path: "notes/a.md#b.md", anchor: null });
    expect(parseBrainNodeId("notes/a.md#ab.c")).toEqual({ path: "notes/a.md#ab.c", anchor: null });
    expect(parseBrainNodeId("Docs/UP.MD#intro")).toEqual({ path: "Docs/UP.MD", anchor: "intro" });
  });

  it("numbers lines as Git does, so a citation opens on the same lines anywhere", () => {
    expect(brainLines("a\r\nb\r\r\nc\rd\n")).toEqual(["a", "b\r", "c\rd", ""]);
    // Line 3 is the heading in Git's count, whatever the stray carriage returns before it.
    const [, section] = nodesOf("intro\r\r\nmore\r\n## Part\r\ntext\r\n");
    expect(section).toMatchObject({ title: "Part", lineStart: 3, lineEnd: 4 });
  });
});

describe("summaries", () => {
  it("keep a text of 240 characters whole", () => {
    expect(summaryOf("y".repeat(240))).toBe(`text: ${"y".repeat(240)}`);
  });

  it("cut a longer text at a word, without the punctuation before the cut", () => {
    expect(summaryOf("alpha, ".repeat(40))).toBe(`paragraph: ${"alpha, ".repeat(33)}alpha…`);
    expect(summaryOf("x".repeat(300))).toBe(`paragraph: ${"x".repeat(239)}…`);
    expect(summaryOf("abcd;: ".repeat(40))).toBe(`paragraph: ${"abcd;: ".repeat(33)}abcd…`);
  });

  it("drop images, link targets, tags, emphasis, code marks and escapes", () => {
    expect(summaryOf("See ![](logo.png) the [spec](spec.md)[](empty.md), <span>styled</span> **strong** __under__ `code` and \\*stars\\* \\+1 \\#2 here.")).toBe(
      "text: See the spec, styled strong under code and *stars* +1 #2 here.",
    );
    expect(summaryOf("Tabs\tand\n  breaks.")).toBe("text: Tabs and breaks.");
  });

  it("skip HTML comments, even over several blocks", () => {
    expect(summaryOf("<!-- note -->\n\nVisible paragraph.")).toBe("text: Visible paragraph.");
    expect(summaryOf("<!--\nhidden text\n\nmore hidden\n-->\n\nVisible.")).toBe("text: Visible.");
    expect(summaryOf("<div align=\"center\">\n<img src=\"logo.png\">\n</div>\n\nReal intro.")).toBe("paragraph: Real intro.");
    expect(summaryOf("> Quoted text\n> more")).toBe("text: Quoted text more");
  });

  it("name a code block by its language and a diagram by its kind", () => {
    expect(summaryOf("```ts title=x\nconst a = 1;\n```")).toBe("code: Code block (ts).");
    expect(summaryOf("~~~\nx\n~~~")).toBe("code: Code block.");
    expect(summaryOf("```mermaid\ngraph TD;\n  a-->b\n```")).toBe("diagram: Mermaid diagram (graph).");
    expect(summaryOf("```mermaid\n\n```")).toBe("diagram: Mermaid diagram.");
  });

  it("close a fence only on a run as long as the one that opened it, as CommonMark does", () => {
    // A four-backtick fence that shows a fenced example: its inner ``` neither closes it nor hides the heading after.
    expect(nodesOf("````md\n```\n## Inside the example\n````\n\n## Real").slice(1).map((node) => node.title)).toEqual(["Real"]);
    expect(nodesOf("~~~\n```\n~~~ not a close\n## In code\n~~~\n## After").slice(1).map((node) => node.title)).toEqual(["After"]);
    expect(summaryOf("````md\n```\nexample\n````\n\nAfter the example.")).toBe("paragraph: After the example.");
    expect(summaryOf("```\nx\n```\n\nFirst para.\n\nSecond para.")).toBe("paragraph: First para.");
  });

  it("keep a fenced block whole, its blank lines and headings included", () => {
    const nodes = nodesOf("```bash\n# not a heading\n\necho hi\n```\n\nAfter.");
    expect(nodes).toHaveLength(1);
    expect(summaryOf("```bash\n# not a heading\n\necho hi\n```\n\nAfter.")).toBe("paragraph: After.");
  });

  it("sum up a table by its columns, rows and row keys", () => {
    const table = ["| Code | Rule |", "| --- | --- |", "| R-01 | Prices differ |", "| ABCDEFGH | Eight |", "| NINECHARS | Nine |", "| LONGKEY123 | x |", "| a \\| b | c |"].join("\n");
    expect(summaryOf(table)).toBe("table: Table of 5 rows: Code, Rule. Rows: R-01 Prices differ; ABCDEFGH Eight; NINECHARS; LONGKEY123; a | b c.");
    expect(summaryOf("Pick one: a or b |")).toBe("text: Pick one: a or b |");
    expect(summaryOf("| A |\n| - |\n| x |")).toBe("table: Table of 1 row: A. Rows: x.");
    expect(summaryOf("| A | B |\n| - | - |")).toBe("table: Table of 0 rows: A, B.");
  });

  it("sum up fields and lists by their items", () => {
    const fields = ["- **priority:** P0", "- **owner**: Ops", "* **a:** 1", "+ **b:** 2", "- **c:** 3", "- **d:** 4", "- **e:** 5", "- plain"].join("\n");
    expect(summaryOf(fields)).toBe("fields: priority: P0 · owner: Ops · a: 1 · b: 2 · c: 3 · d: 4");
    expect(summaryOf("1. first\n2) second\n+ third\n* fourth")).toBe("list: first; second; third; fourth");
  });

  it("prefer a paragraph among the first four blocks to what comes before it", () => {
    const fourth = "- a\n\n| T |\n| - |\n| r |\n\n```\nx\n```\n\nFourth block prose.";
    expect(summaryOf(fourth)).toBe("paragraph: Fourth block prose. Rows: r.");
    expect(summaryOf("- a\n\n- b\n\n- c\n\n- d\n\nFifth.")).toBe("list: a");
  });

  it("follow a sentence ending on a colon with its fields, and an introduction with its table's rows", () => {
    expect(summaryOf("Fields:\n\n- **a:** 1")).toBe("paragraph: Fields: a: 1");
    expect(summaryOf("The rules:\n\n| Code | Rule |\n| --- | --- |\n| R-01 | Prices differ |")).toBe("paragraph: The rules. Rows: R-01 Prices differ.");
    expect(summaryOf("Intro.\n\nMore prose.")).toBe("paragraph: Intro.");
  });

  it("name what a node holds by the titles of its children, at most eight", () => {
    const many = Array.from({ length: 10 }, (_, at) => `## S${at}`).join("\n");
    expect(summaryOf(many)).toBe("children: S0 · S1 · S2 · S3 · S4 · S5 · S6 · S7 · and 2 more");
    expect(summaryOf(many.split("\n").slice(0, 8).join("\n"))).toBe("children: S0 · S1 · S2 · S3 · S4 · S5 · S6 · S7");
    expect(summaryOf("")).toBe("none: ");
  });
});

describe("headings", () => {
  it("make sections of real headings only, with GitHub anchors made unique", () => {
    const nodes = nodesOf("## Title ##\n\n#NoSpace\n\n## Notes\n## Notes\n## Notes\n## !!!\n<!--\n## Commented out\n-->\n<!-- ## inline -->\n## Last");
    expect(nodes.slice(1).map((node) => [node.title, node.anchor])).toEqual([
      ["Title", "title"],
      ["Notes", "notes"],
      ["Notes", "notes-1"],
      ["Notes", "notes-2"],
      ["!!!", "section"],
      ["Last", "last"],
    ]);
    expect(nodes[1]?.summary).toBe("#NoSpace");
    // A heading mark or a fence inside a line is text, and a slug has no trailing dash.
    expect(nodesOf("Note ## not a heading.\nUse ``` inline.\n\n## Done !").slice(1).map((node) => [node.title, node.anchor])).toEqual([["Done !", "done-"]]);
  });

  it("nest headings by level and give each its own lines and everything under it", () => {
    const [, a, b, c] = nodesOf("## A\n### B\nb text\n## C");
    expect([a?.id, a?.parentId, a?.lineStart, a?.lineEnd, a?.subtreeEnd, a?.children]).toEqual(["notes/a.md#a", "notes/a.md", 1, 1, 3, 1]);
    expect([b?.parentId, b?.depth, b?.lineStart, b?.lineEnd, b?.subtreeEnd, b?.ordinal]).toEqual(["notes/a.md#a", 2, 2, 3, 3, 0]);
    expect([c?.parentId, c?.depth, c?.lineStart, c?.lineEnd, c?.subtreeEnd, c?.ordinal]).toEqual(["notes/a.md", 1, 4, 4, 4, 1]);
    expect(b?.tokens).toBe(brainTokens("### B\nb text"));
    expect(a?.subtreeTokens).toBe(brainTokens("## A\n### B\nb text"));
  });

  it("make a card of an id in code marks, summed up by the rest of its heading when it has no text", () => {
    const [, card] = nodesOf("### `RULE-A1-0001`: Late fee");
    expect(card).toMatchObject({ kind: "card", anchor: "RULE-A1-0001", ids: ["RULE-A1-0001"], title: "RULE-A1-0001: Late fee", summary: "Late fee", summarySource: "text" });
    const [, bare] = nodesOf("### RULE-A1-0002");
    expect(bare).toMatchObject({ kind: "card", summary: "", summarySource: "none" });
  });

  it("stop at 2,000 headings a document", () => {
    const nodes = nodesOf(Array.from({ length: 2001 }, (_, at) => `## H${at}`).join("\n"));
    expect(nodes).toHaveLength(2001);
    expect(nodes.at(-1)).toMatchObject({ title: "H1999", lineEnd: 2001 });
  });

  it("take the title from front matter, a single first top heading, a name or the file", () => {
    expect(documentOf("# A\n\n# B").title).toBe("a");
    expect(documentOf("## Intro\n\n# Big").title).toBe("a");
    expect(documentOf("---\nname: Rule file\n---\n\ntext").title).toBe("Rule file");
    expect(documentOf("---\ntitle: Front\nname: Named\n---\n\n# Heading").title).toBe("Front");
    expect(documentOf("text", "notes/UP.MD").title).toBe("UP");
    const long = documentOf(`# ${"word ".repeat(60)}`).title;
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("word…")).toBe(true);
  });
});

describe("front matter", () => {
  it("reads quoted scalars", () => {
    expect(documentOf("---\ntitle: 'Order: create it''s'\n---\n").title).toBe("Order: create it's");
    expect(documentOf('---\ntitle: "Say \\"hi\\""\n---\n').title).toBe('Say "hi"');
    expect(documentOf('---\ntitle: "broken\n---\n').title).toBe('"broken');
    expect(documentOf("---\ntitle: '\n---\n").title).toBe("'");
    expect(documentOf("---\ntitle: 'Quoted'   \n---\n").title).toBe("Quoted");
    expect(documentOf("---\ntitle: x'\n---\n").title).toBe("x'");
    expect(documentOf("---\ntitle: 'x\n---\n").title).toBe("'x");
  });

  it("skips an empty value, quoted or not", () => {
    expect(documentOf("---\ntitle: ''\n---\n\n# Heading").title).toBe("Heading");
    expect(documentOf('---\ntitle: ""\nname: Named\n---\n').title).toBe("Named");
  });

  it("opens on a first line of three dashes, spaces after them allowed", () => {
    expect(documentOf("--- \ntitle: T\n---").title).toBe("T");
    expect(summaryOf("Intro text.\n\n---\n\nMore.")).toBe("paragraph: Intro text.");
  });

  it("sums up by facts a reader can use, six at most", () => {
    const facts = ["---", "id: COM-ORD-01", "title: Order", "status: understood", "rules: 12", "digest: x", "sources: a.cbl", "build: 0123456789abcdef", `long: ${"z".repeat(61)}`, `edge: ${"y".repeat(60)}`, "tags:", "  - a", "---"].join("\n");
    expect(summaryOf(facts)).toBe(`facts: id: COM-ORD-01 · status: understood · rules: 12 · edge: ${"y".repeat(60)}`);
    expect(documentOf(facts).ids).toEqual(["COM-ORD-01"]);
    expect(summaryOf(["---", ...Array.from({ length: 8 }, (_, at) => `f${at}: v`), "---"].join("\n"))).toBe("facts: f0: v · f1: v · f2: v · f3: v · f4: v · f5: v");
  });

  it("uses the description when the summary is empty", () => {
    expect(summaryOf("---\nsummary:   \ndescription: Real one.\n---\n\nBody text.")).toBe("front-matter: Real one.");
  });

  it("is only a block closed within 400 lines at the very top", () => {
    expect(documentOf("---\ntitle: Open\nbody").title).toBe("a");
    const closedAt = (line: number) => ["---", "title: Big", ...Array.from({ length: line - 2 }, (_, at) => `f${at}: v`), "---"].join("\n");
    expect(documentOf(closedAt(400)).title).toBe("Big");
    expect(documentOf(closedAt(401)).title).toBe("a");
    expect(documentOf("\n---\ntitle: Late\n---").title).toBe("a");
  });

  it("starts the summary of a retired document with its status, unless its facts say it", () => {
    expect(summaryOf("---\nstatus: Deprecated\nreplacedBy: ADR-0002\n---\n\nOld text.")).toBe("text: Deprecated by ADR-0002. Old text.");
    expect(summaryOf("---\nstatus: retired\n---\n")).toBe("facts: status: retired");
    expect(summaryOf("---\nstatus: superseded\nsummary: Old way.\n---\n")).toBe("front-matter: Superseded. Old way.");
    expect(summaryOf("---\nstatus: draft\n---\n\nText.")).toBe("text: Text.");
  });
});

describe("links", () => {
  const files = {
    "notes/a.md": [
      "# A",
      "",
      "[b](b.md) [up](../top.md) [abs](/notes/b.md#part-two) [web](https://x.y/a.md) [cdn](//cdn/x.md) [mail](mailto:a@b.md)",
      "[far](../../x.md) [query](./b.md?raw=1#Part-Two) [local](#intro) [folder](sub/) [spaced](<my notes.md>) [bad](#50%) [enc](sub/c%2Emd) ![img](top.md) [](empty.md)",
      "[card](rules.md#rule-a1-0001-late-fee) [self](a.md)",
      "",
      "## Intro",
      "",
      "Text.",
    ].join("\n"),
    "notes/b.md": "# B\n\n## Part two\n\nx",
    "notes/my notes.md": "# M",
    "notes/empty.md": "# E",
    "notes/rules.md": "# Rules\n\n### RULE-A1-0001: Late fee\n\n- **priority:** P0",
    "notes/sub/c.md": "# C",
    "top.md": "# Top",
  };

  it("resolve to the nodes they point at, and never stop the build", () => {
    const tree = treeOf(files);
    expect(tree.links.filter((link) => link.fromId === "notes/a.md").map((link) => [link.toId, link.kind])).toEqual([
      ["notes/b.md", "link"],
      ["top.md", "link"],
      ["notes/b.md#part-two", "link"],
      ["notes/a.md#intro", "link"],
      ["notes/sub/", "link"],
      ["notes/my notes.md", "link"],
      ["notes/sub/c.md", "link"],
      ["notes/empty.md", "link"],
      ["notes/rules.md#RULE-A1-0001", "link"],
    ]);
  });

  it("follow an id to at most three nodes that define it, and keep fifty links a node", () => {
    const definers = (folder: string, count: number, id: string) => Object.fromEntries(Array.from({ length: count }, (_, at) => [`${folder}/${at}.md`, `---\nid: ${id}\n---\n`]));
    const ids = treeOf({ ...definers("d", 4, "COM-X-01"), ...definers("e", 3, "COM-Y-01"), "a.md": "Uses COM-X-01 and COM-Y-01, COM-Y-01 again." });
    expect(ids.links.filter((link) => link.fromId === "a.md").map((link) => [link.toId, link.kind])).toEqual([
      ["e/0.md", "id"],
      ["e/1.md", "id"],
      ["e/2.md", "id"],
    ]);
    expect(ids.identifiers).toBe(2);
    const hub = Object.fromEntries(Array.from({ length: 60 }, (_, at) => [`n/${at}.md`, `# ${at}`]));
    const many = treeOf({ ...hub, "hub.md": Array.from({ length: 60 }, (_, at) => `[x](n/${at}.md)`).join(" ") });
    expect(many.links.filter((link) => link.fromId === "hub.md")).toHaveLength(50);
  });
});

describe("folders", () => {
  it("take a README or index summary, put a README first, and say what a folder of one document is", () => {
    const tree = treeOf({
      "guide/b.md": "# B\n\nBee.",
      "guide/index.md": "# Guide\n\nHow to use it.",
      "guide/README.md": "# Read me\n\n## A\n\n## B",
      "units/u1/spec.md": "# Spec One\n\nDoes one thing.",
      "many/0.md": "# D0",
      ...Object.fromEntries(Array.from({ length: 9 }, (_, at) => [`many/${at + 1}.md`, `# D${at + 1}`])),
    });
    const node = (id: string) => tree.nodes.find((each) => each.id === id)!;
    expect(tree.nodes.filter((each) => each.parentId === "guide/").map((each) => [each.id, each.ordinal])).toEqual([
      ["guide/b.md", 2],
      ["guide/index.md", 1],
      ["guide/README.md", 0],
    ]);
    // A README that only lists its sections says less than the folder's own contents.
    expect(node("guide/")).toMatchObject({ summarySource: "children", summary: "Read me · Guide · B" });
    expect(node("units/u1/")).toMatchObject({ summarySource: "children", summary: "Spec One: Does one thing." });
    expect(node("units/")).toMatchObject({ summarySource: "children", summary: "u1 (Spec One)" });
    expect(node("many/").summary).toBe("D0 · D1 · D2 · D3 · D4 · D5 · D6 · D7 · and 2 more");
    expect(node(BRAIN_ROOT_ID)).toMatchObject({ children: 3, summary: "guide/ · many/ · units/" });
  });

  it("take an index summary when there is no README", () => {
    const tree = treeOf({ "guide/b.md": "# B\n\nBee.", "guide/index.md": "# Guide\n\nHow to use it." });
    expect(tree.nodes.find((node) => node.id === "guide/")).toMatchObject({ summarySource: "readme", summary: "How to use it." });
  });

  it("carry the latest change of what they hold", () => {
    const at = (day: number) => ({ commit: `${day}`.repeat(40), at: `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`, subject: `day ${day}` });
    const tree = buildBrainTree(
      [
        { path: "a/x.md", text: "x", changed: at(12) },
        { path: "a/y.md", text: "y", changed: at(20) },
        { path: "a/z.md", text: "z" },
        { path: "b/x.md", text: "x" },
      ],
      "docs",
    );
    const node = (id: string) => tree.nodes.find((each) => each.id === id)!;
    expect(node("a/").changed?.subject).toBe("day 20");
    expect(node("b/").changed).toBeNull();
    expect(node("a/z.md").changed).toBeNull();
    expect(node(BRAIN_ROOT_ID).changed?.subject).toBe("day 20");
  });
});

// ---------------------------------------------------------------------------
// Wiki pages (ADR-0096, ADR-0097): attributes, spaces, manual order, broken links, card aliases
// ---------------------------------------------------------------------------

const page = (front: string[], body = "Text of the page."): string => ["---", ...front, "---", "", "# Page", "", body, ""].join("\n");
const byPath = (tree: ReturnType<typeof treeOf>, path: string): BrainNode => {
  const node = tree.nodes.find((candidate) => candidate.id === path);
  if (node === undefined) throw new Error(`no node ${path}`);
  return node;
};

describe("page attributes", () => {
  it("reads labels from the flow and the block form, lowercased, cleaned, once each, at most twenty", () => {
    const flow = documentOf(page(["labels: [Runbook, sev-1, 'On Call', runbook, \"\"]"]));
    expect(flow.labels).toEqual(["runbook", "sev-1", "oncall"]);
    const block = documentOf(page(["labels:", '  - "Runbook"', "  - sev1", "  - Données", "id: PAGE-ENG-0001"]));
    expect(block.labels).toEqual(["runbook", "sev1", "donnes"]);
    expect(block.ids).toEqual(["PAGE-ENG-0001"]);
    const many = documentOf(page([`labels: [${Array.from({ length: 30 }, (_, index) => `l${index}`).join(", ")}]`]));
    expect(many.labels).toHaveLength(20);
    expect(documentOf(page(["title: x"])).labels).toEqual([]);
    expect(brainLabels(["A b", "c_d", "e-f"])).toEqual(["ab", "cd", "e-f"]);
  });

  it("reads status and owner, and flags a template only by `type: template`", () => {
    const archived = documentOf(page(["status: Archived", "owner: eng-manager", "supersededBy: PAGE-ENG-0002"]));
    expect(archived.status).toBe("archived");
    expect(archived.owner).toBe("eng-manager");
    expect(archived.template).toBe(false);
    expect(archived.summary).toBe("Archived by PAGE-ENG-0002. Text of the page.");
    const template = documentOf(page(["type: template"]));
    expect(template.template).toBe(true);
    expect(template.summary).toBe("Template. Text of the page.");
    // `template: <name>` names the template a page was made from; it is not the flag.
    expect(documentOf(page(["template: incident-report"])).template).toBe(false);
    expect(documentOf(page(["title: x"])).status).toBeNull();
  });

  it("gives sections and cards no page attributes", () => {
    const nodes = nodesOf(["---", "labels: [a]", "status: archived", "---", "# Title", "", "## Part", "", "text", ""].join("\n"));
    const section = nodes.find((node) => node.kind === "section");
    expect(section?.labels).toEqual([]);
    expect(section?.status).toBeNull();
  });

  it("gives a folder the labels, status and owner of its home page", () => {
    const tree = treeOf({
      "space/README.md": page(["key: ENG", "labels: [team]", "status: archived", "owner: lead"]),
      "space/a.md": page(["labels: [x]"]),
    });
    const folder = byPath(tree, "space/");
    expect(folder.labels).toEqual(["team"]);
    expect(folder.status).toBe("archived");
    expect(folder.owner).toBe("lead");
    expect(byPath(tree, "space/a.md").labels).toEqual(["x"]);
  });
});

describe("spaces", () => {
  it("makes a home page's key the space of its folder and everything below, until another home page says otherwise", () => {
    const tree = treeOf({
      "00-project/README.md": page(["title: Project"]),
      "20-spaces/eng/README.md": page(["key: ENG"]),
      "20-spaces/eng/runbooks/a.md": page(["title: a"]),
      "20-spaces/eng/sub/README.md": page(["key: SUB"]),
      "20-spaces/eng/sub/b.md": page(["title: b"]),
      "20-spaces/hr/README.md": page(["space: HR"]),
    });
    expect(byPath(tree, "00-project/").space).toBeNull();
    expect(byPath(tree, "20-spaces/").space).toBeNull();
    expect(byPath(tree, "20-spaces/eng/").space).toBe("ENG");
    expect(byPath(tree, "20-spaces/eng/README.md").space).toBe("ENG");
    expect(byPath(tree, "20-spaces/eng/runbooks/a.md").space).toBe("ENG");
    expect(byPath(tree, "20-spaces/eng/sub/b.md").space).toBe("SUB");
    expect(byPath(tree, "20-spaces/hr/README.md").space).toBe("HR");
  });
});

describe("the manual order of a folder", () => {
  const entries = (tree: ReturnType<typeof treeOf>, folder: string): string[] =>
    tree.nodes.filter((node) => node.parentId === folder).sort((a, b) => a.ordinal - b.ordinal).map((node) => node.path.split("/").pop() ?? "");

  it("puts the listed entries first, folders and documents mixed, in list order, and keeps the rest as they were", () => {
    const tree = treeOf({
      "s/README.md": page(["order: [zeta, deploy.md, runbooks, ghost, zeta]"]),
      "s/alpha.md": page(["title: a"]),
      "s/deploy.md": page(["title: d"]),
      "s/runbooks/a.md": page(["title: r"]),
      "s/zeta.md": page(["title: z"]),
      "s/other/a.md": page(["title: o"]),
    });
    // Listed: zeta, deploy, runbooks. Left: today's order, folders first, then the home page, then documents by name.
    expect(entries(tree, "s/")).toEqual(["zeta.md", "deploy.md", "runbooks", "other", "README.md", "alpha.md"]);
  });

  it("reads the block form and prefers a folder when a folder and a document share the name", () => {
    const tree = treeOf({
      "s/README.md": page(["order:", "  - guide", "  - intro"]),
      "s/guide.md": page(["title: g"]),
      "s/guide/a.md": page(["title: ga"]),
      "s/intro.md": page(["title: i"]),
    });
    expect(entries(tree, "s/")).toEqual(["guide", "intro.md", "README.md", "guide.md"]);
  });

  it("changes nothing for a folder without a list", () => {
    const tree = treeOf({ "s/README.md": page(["title: s"]), "s/b.md": page(["title: b"]), "s/a.md": page(["title: a"]), "s/z/x.md": page(["title: x"]) });
    expect(entries(tree, "s/")).toEqual(["z", "README.md", "a.md", "b.md"]);
  });
});

describe("links that lead nowhere", () => {
  it("lists a link to a Markdown page that is not in the index, once per page and target", () => {
    const tree = treeOf({
      "a/one.md": page([], "See [gone](missing.md), [again](missing.md#x), [there](two.md), [pic](pic.png), [web](https://example.com/x.md), [up](../b/none.md)."),
      "a/two.md": page([], "Back to [one](one.md#nope)."),
      "restricted/secret.md": page(["title: s"]),
      "a/three.md": page([], "A [secret](../restricted/secret.md)."),
    });
    expect(tree.broken).toEqual([
      { from: "a/one.md", target: "a/missing.md" },
      { from: "a/one.md", target: "b/none.md" },
      { from: "a/three.md", target: "restricted/secret.md" },
    ]);
  });
});

describe("the GitHub alias of a card", () => {
  it("is made from the heading as written, so a long heading is reached by its whole slug", () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
    const heading = `RULE-ABC01-0001: ${words}`;
    const full = `rule-abc01-0001-${words.replace(/ /g, "-")}`;
    const tree = treeOf({
      "r.md": ["# Rules", "", `## ${heading}`, "", "A rule.", ""].join("\n"),
      "l.md": page([], `[the rule](r.md#${full})`),
    });
    const card = tree.nodes.find((node) => node.kind === "card");
    expect(card?.title.length).toBeLessThan(heading.length);
    expect(tree.links).toContainEqual({ fromId: "l.md", toId: card?.id, kind: "link" });
  });
});
