// The Brain eval's fixture tests what its key says it tests (ADR-0091): built with the domain's own tree builder,
// every answer sits in a node, a card question's answer in a card, a grep question's term in no title or summary,
// and every folder and document on the way down to a descend question's answer has a summary to follow.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_ROOT_ID, type BrainNode, buildBrainTree, isBrainReferenceId } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";

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

function documentsUnder(dir: string): Array<{ path: string; text: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? documentsUnder(join(dir, entry.name))
      : [{ path: relative(root, join(dir, entry.name)).replace(/\\/g, "/"), text: readFileSync(join(dir, entry.name), "utf8") }],
  );
}

const sources = documentsUnder(root);
const tree = buildBrainTree(sources, "shop-docs · main");
const nodes = new Map(tree.nodes.map((node) => [node.id, node]));

/** The deepest node whose own text holds the anchor's line, as `brain_grep` maps a hit. */
function nodeOf(anchor: Anchor): BrainNode {
  const lines = (sources.find((source) => source.path === anchor.file)?.text ?? "").split("\n");
  const line = lines.findIndex((text) => text.includes(anchor.match)) + 1;
  expect(line, `${anchor.file}: ${anchor.match}`).toBeGreaterThan(0);
  const holding = tree.nodes
    .filter((node) => node.path === anchor.file && node.lineStart !== null && node.lineEnd !== null && node.lineStart <= line && node.lineEnd >= line)
    .sort((a, b) => b.depth - a.depth);
  const found = holding[0];
  if (found === undefined) throw new Error(`no node holds ${anchor.file}:${line}`);
  return found;
}

function ancestors(node: BrainNode): BrainNode[] {
  const chain: BrainNode[] = [];
  for (let parent = node.parentId === null ? undefined : nodes.get(node.parentId); parent !== undefined; parent = parent.parentId === null ? undefined : nodes.get(parent.parentId)) {
    chain.push(parent);
  }
  return chain;
}

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
