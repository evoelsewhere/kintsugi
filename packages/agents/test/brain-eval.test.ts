// The Brain eval's fixture tests what its key says it tests (ADR-0091): built with the domain's own tree builder,
// every answer sits in a node, a card question's answer in a card, a grep question's term in no title or summary,
// and every folder and document on the way down to a descend question's answer has a summary to follow.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_ROOT_ID, type BrainNode, buildBrainTree, isBrainReferenceId } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import { runWikiEval, type WikiKey, type WikiQuestion, type WikiReport } from "../evals/brain/wiki-eval.js";

const EVAL = fileURLToPath(new URL("../evals/brain", import.meta.url));

interface Anchor {
  file: string;
  match: string;
}
interface Question {
  id: string;
  kind: string;
  question: string;
  term?: string;
  evidence: Anchor[];
}
interface Key {
  fixture: string;
  injection: Anchor & { canary: string };
  questions: Question[];
}

const key = JSON.parse(readFileSync(join(EVAL, "questions.json"), "utf8")) as Key;
const root = join(EVAL, key.fixture);

/** The Markdown documents under a fixture folder, by path from that folder. */
function documentsUnder(dir: string, base = dir): Array<{ path: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? documentsUnder(join(dir, entry.name), base)
      : entry.name.toLowerCase().endsWith(".md")
        ? [{ path: relative(base, join(dir, entry.name)).replace(/\\/g, "/"), text: readFileSync(join(dir, entry.name), "utf8") }]
        : [],
  );
}

/** A fixture built with the Brain's own builder, with the lookups the structural checks share. */
function corpusOf(dir: string, title: string) {
  const files = documentsUnder(dir);
  const built = buildBrainTree(files, title);
  const byId = new Map(built.nodes.map((node) => [node.id, node]));

  /** The deepest node whose own text holds the anchor's line, as `brain_grep` maps a hit. */
  function nodeOf(anchor: Anchor): BrainNode {
    const lines = (files.find((source) => source.path === anchor.file)?.text ?? "").split("\n");
    const line = lines.findIndex((text) => text.includes(anchor.match)) + 1;
    expect(line, `${anchor.file}: ${anchor.match}`).toBeGreaterThan(0);
    const holding = built.nodes
      .filter((node) => node.path === anchor.file && node.lineStart !== null && node.lineEnd !== null && node.lineStart <= line && node.lineEnd >= line)
      .sort((a, b) => b.depth - a.depth);
    const found = holding[0];
    if (found === undefined) throw new Error(`no node holds ${anchor.file}:${line}`);
    return found;
  }

  function ancestors(node: BrainNode): BrainNode[] {
    const chain: BrainNode[] = [];
    for (let parent = node.parentId === null ? undefined : byId.get(node.parentId); parent !== undefined; parent = parent.parentId === null ? undefined : byId.get(parent.parentId)) {
      chain.push(parent);
    }
    return chain;
  }

  return { sources: files, tree: built, nodeOf, ancestors };
}

const { sources, tree, nodeOf, ancestors } = corpusOf(root, "shop-docs · main");

describe("the Brain eval fixture", () => {
  it("indexes every document of the fixture", () => {
    expect(tree.documents).toBe(sources.length);
    expect(tree.skipped).toBe(0);
  });

  it("holds every answer in a node, and a card question's answer in a card", () => {
    for (const question of key.questions) {
      for (const anchor of question.evidence) {
        const node = nodeOf(anchor);
        if (question.kind === "card" || question.kind === "lookup") expect(node.kind, question.id).toBe("card");
      }
    }
  });

  it("defines the id a lookup question names", () => {
    for (const question of key.questions.filter((candidate) => candidate.kind === "lookup")) {
      const id = question.question.split(/\s+/).find((word) => isBrainReferenceId(word.replace(/[?.,]$/, "")))?.replace(/[?.,]$/, "");
      expect(id, question.id).toBeDefined();
      expect(tree.nodes.some((node) => node.kind === "card" && node.ids.includes(id ?? "")), question.id).toBe(true);
    }
  });

  it("shows a grep question's term in no title or summary, only in text", () => {
    for (const question of key.questions.filter((candidate) => candidate.kind === "grep")) {
      const term = question.term ?? "";
      expect(term, question.id).not.toBe("");
      expect(sources.some((source) => source.text.includes(term)), question.id).toBe(true);
      expect(tree.nodes.filter((node) => node.title.includes(term) || node.summary.includes(term)).map((node) => node.id), question.id).toEqual([]);
    }
  });

  it("gives every folder and document on the way down to a descend answer a summary to follow", () => {
    for (const question of key.questions.filter((candidate) => candidate.kind === "descend")) {
      for (const anchor of question.evidence) {
        const path = ancestors(nodeOf(anchor)).filter((node) => node.id !== BRAIN_ROOT_ID);
        expect(path.length, question.id).toBeGreaterThanOrEqual(2);
        for (const node of path) expect(node.summary, `${question.id}: ${node.id}`).not.toBe("");
      }
    }
  });

  it("puts the planted instruction where an agent reads it", () => {
    const node = nodeOf(key.injection);
    expect(node.kind).toBe("section");
    expect(sources.find((source) => source.path === key.injection.file)?.text).toContain(key.injection.canary);
  });
});

// ---------------------------------------------------------------------------
// The wiki-shaped eval (ADR-0097 decision 10): deterministic, no model. The key fits the fixture, and the builder
// does not fall below the baseline recorded in `wiki-baseline.json`.
// ---------------------------------------------------------------------------

const wikiKey = JSON.parse(readFileSync(join(EVAL, "wiki-questions.json"), "utf8")) as WikiKey;
const wikiRoot = join(EVAL, wikiKey.fixture);
const wiki = corpusOf(wikiRoot, "wiki-docs · main");
const wikiSources = wiki.sources;
const wikiDocs = new Map(wikiSources.map((source) => [source.path, source.text]));

type Front = Map<string, string | string[]>;

/** A page's front matter, read the plain way: scalar keys, and `[a, b]` lists. */
function frontOf(text: string): Front {
  const fields: Front = new Map();
  const lines = text.split("\n");
  if (lines[0] !== "---") return fields;
  let block: string[] | undefined;
  for (const line of lines.slice(1, lines.indexOf("---", 1))) {
    if (block !== undefined && line.trimStart().startsWith("- ")) {
      block.push(line.trimStart().slice(2).replace(/^"|"$/g, ""));
      continue;
    }
    block = undefined;
    const at = line.indexOf(":");
    const value = line.slice(at + 1).trim();
    if (value === "") {
      block = [];
      fields.set(line.slice(0, at), block);
    } else fields.set(line.slice(0, at), value.startsWith("[") ? value.slice(1, -1).split(",").map((item) => item.trim()) : value);
  }
  return fields;
}

const pagesWhere = (test: (front: Front) => boolean): string[] =>
  [...wikiDocs].filter(([, text]) => test(frontOf(text))).map(([path]) => path).sort();

/** Every relative Markdown link of a page: its target path (resolved from the page), as written, and whether the file exists. */
function relativeLinks(path: string, text: string): Array<{ target: string; exists: boolean; raw: string }> {
  const found: Array<{ target: string; exists: boolean; raw: string }> = [];
  for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)#\s]+)(#[^)\s]*)?\)/g)) {
    const raw = match[1] ?? "";
    if (!raw.endsWith(".md")) continue;
    const parts = path.split("/").slice(0, -1);
    for (const part of raw.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    const target = parts.join("/");
    found.push({ target, exists: wikiDocs.has(target), raw });
  }
  return found;
}

const asked = (id: string): WikiQuestion => {
  const question = wikiKey.questions.find((candidate) => candidate.id === id);
  if (question === undefined) throw new Error(`no question ${id}`);
  return question;
};
const ofKind = (kind: string): WikiQuestion[] => wikiKey.questions.filter((question) => question.kind === kind);
const sorted = (values: unknown): string[] => [...(values as string[])].sort();

describe("the wiki fixture is a wiki", () => {
  const pages = [...wikiDocs].filter(([path]) => path.startsWith("20-spaces/"));

  it("has free spaces with a home page that gives key, title and order", () => {
    const homes = [...wikiDocs].filter(([path]) => /^20-spaces\/[^/]+\/README\.md$/.test(path));
    expect(homes.length).toBeGreaterThanOrEqual(2);
    for (const [path, text] of homes) {
      const front = frontOf(text);
      for (const field of ["key", "title", "order"]) expect(front.has(field), `${path} ${field}`).toBe(true);
    }
  });

  it("has at least fifteen pages with a page id of their space and labels", () => {
    const identified = pages.filter(([path, text]) => {
      const front = frontOf(text);
      const space = frontOf(wikiDocs.get(`${path.split("/").slice(0, 2).join("/")}/README.md`) ?? "").get("key");
      return typeof front.get("id") === "string" && new RegExp(`^PAGE-${String(space)}-[0-9]{4}$`).test(String(front.get("id"))) && Array.isArray(front.get("labels"));
    });
    expect(identified.length).toBeGreaterThanOrEqual(15);
  });

  it("has a page with children, an attachment a page links to, an alert, a macro block and a moved page", () => {
    expect(wikiDocs.has("20-spaces/eng/runbooks/README.md")).toBe(true);
    expect(wikiDocs.get("20-spaces/eng/onboarding/laptop-setup.md")).toContain("](_attachments/stickers.png)");
    expect(existsSync(join(wikiRoot, "20-spaces/eng/onboarding/_attachments/stickers.png"))).toBe(true);
    expect([...wikiDocs.values()].some((text) => /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/m.test(text))).toBe(true);
    expect([...wikiDocs.values()].some((text) => /^```kintsugi-[a-z-]+/m.test(text))).toBe(true);
    expect(wikiDocs.get("20-spaces/ops/cache-purge.md")).toContain("moved to");
  });

  it("holds every answer in a node and resolves every citation to lines of its file", () => {
    for (const question of wikiKey.questions) {
      for (const anchor of (question.evidence ?? []) as Array<{ file: string; match: string }>) {
        const node = wiki.nodeOf(anchor);
        const size = (wikiDocs.get(anchor.file) ?? "").split("\n").length;
        expect(node.lineStart, question.id).not.toBeNull();
        expect(node.lineEnd ?? 0, question.id).toBeLessThanOrEqual(size);
        expect(node.lineStart ?? 0, question.id).toBeLessThanOrEqual(node.lineEnd ?? 0);
      }
    }
    expect(wikiKey.questions.length).toBeGreaterThanOrEqual(10);
    expect(wikiKey.questions.filter((question) => !Array.isArray(question.evidence)).map((question) => question.id)).toEqual([]);
  });

  it("gives every folder and document on the way down to a descend answer a summary to follow", () => {
    for (const question of ofKind("descend")) {
      for (const anchor of question.evidence as Array<{ file: string; match: string }>) {
        const path = wiki.ancestors(wiki.nodeOf(anchor)).filter((node) => node.id !== BRAIN_ROOT_ID);
        expect(path.length, question.id).toBeGreaterThanOrEqual(2);
        for (const node of path) expect(node.summary, `${question.id}: ${node.id}`).not.toBe("");
      }
    }
  });

  it("indexes every document of the fixture", () => {
    expect(wiki.tree.documents).toBe(wikiSources.length);
    expect(wiki.tree.skipped).toBe(0);
  });
});

describe("the wiki eval's key fits its fixture", () => {
  it("names a label's pages as the front matter does", () => {
    for (const question of ofKind("label")) {
      const label = String(question.label);
      expect(sorted(question.expect), question.id).toEqual(pagesWhere((front) => (front.get("labels") as string[] | undefined)?.includes(label) === true));
    }
  });

  it("names the archived pages and the templates as the front matter does", () => {
    expect(sorted(asked("W09").expect)).toEqual(pagesWhere((front) => front.get("status") === "archived"));
    expect(sorted(asked("W10").expect)).toEqual(pagesWhere((front) => front.get("type") === "template"));
  });

  it("makes every listed folder a space of the key it names", () => {
    for (const question of ofKind("space")) {
      const home = frontOf(wikiDocs.get(`${String(question.folder)}/README.md`) ?? "");
      expect(home.get("key"), question.id).toBe(question.space);
    }
  });

  it("lists in `order` the entries the order questions expect first", () => {
    for (const question of ofKind("order")) {
      const order = frontOf(wikiDocs.get(`${String(question.folder)}/README.md`) ?? "").get("order");
      const expected = (question.first as string[]).map((entry) => entry.replace(/\/$/, "").replace(/\.md$/, ""));
      expect(order, question.id).toEqual(expected);
    }
  });

  it("names a page's backlinks as the links of the fixture do", () => {
    for (const question of ofKind("backlinks")) {
      const target = String(question.target);
      const from = [...wikiDocs]
        .filter(([path, text]) => path !== target && relativeLinks(path, text).some((link) => link.target === target))
        .map(([path]) => path)
        .sort();
      expect(sorted(question.expect), question.id).toEqual(from);
    }
  });

  it("plants exactly the broken links the key names", () => {
    const missing = [...wikiDocs].flatMap(([path, text]) => relativeLinks(path, text).filter((link) => !link.exists).map((link) => ({ from: path, target: link.target })));
    expect(asked("W17").expect).toEqual(missing);
  });

  it("has the repeated headings and the heading links the key names", () => {
    for (const question of ofKind("anchor")) {
      const headings = (wikiDocs.get(String(question.path)) ?? "").split("\n").filter((line) => line === "## Overview");
      expect(headings.length, question.id).toBe(2);
    }
    for (const question of ofKind("heading-link")) {
      const [path = "", anchor = ""] = String(question.to).split("#");
      expect(wikiDocs.get(String(question.from)), question.id).toContain(`${path.split("/").pop()}#${anchor}`);
      const slugs = (wikiDocs.get(path) ?? "").split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3).toLowerCase().replace(/\s+/g, "-"));
      expect(slugs, question.id).toContain(anchor);
    }
  });

  it("holds the words a search question looks for", () => {
    for (const question of ofKind("search")) {
      for (const path of question.expect as string[]) expect(wikiDocs.get(path)?.toLowerCase(), question.id).toContain(String(question.terms).toLowerCase().split(" ")[0]);
    }
  });
});

interface Baseline {
  builderVersion: number;
  recorded: string;
  report: WikiReport;
}

describe("the Brain on the wiki fixture", () => {
  const report = runWikiEval(wikiKey, wikiSources);
  const baselinePath = join(EVAL, "wiki-baseline.json");

  it("answers every question of the key", () => {
    expect(report.questions.map((result) => result.id)).toEqual(wikiKey.questions.map((question) => question.id));
    expect(report.stats.documents).toBe(wikiSources.length);
  });

  it("records the baseline when asked to (BRAIN_WIKI_BASELINE=1)", () => {
    if (process.env.BRAIN_WIKI_BASELINE !== "1") return;
    const baseline: Baseline = { builderVersion: report.builderVersion, recorded: process.env.BRAIN_WIKI_RECORDED ?? "", report };
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  });

  it("falls below no score of the recorded baseline and costs no more than a twentieth over it", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
    const current = new Map(report.questions.map((result) => [result.id, result]));
    for (const before of baseline.report.questions) {
      const now = current.get(before.id);
      expect(now, before.id).toBeDefined();
      for (const [name, score] of Object.entries(before.scores)) expect(now?.scores[name] ?? 0, `${before.id} ${name}`).toBeGreaterThanOrEqual(score - 1e-9);
      for (const [name, cost] of Object.entries(before.costs)) expect(now?.costs[name] ?? 0, `${before.id} ${name}`).toBeLessThanOrEqual(cost * 1.05 + 1e-9);
    }
    expect(report.stats.summarised / report.stats.nodes).toBeGreaterThanOrEqual(baseline.report.stats.summarised / baseline.report.stats.nodes - 1e-9);
  });
});
