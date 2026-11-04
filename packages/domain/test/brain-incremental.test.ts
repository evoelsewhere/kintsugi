// The tree is built in two steps (ADR-0097 decision 6): one part per document, from its text alone, and the assembly of
// the parts, which does everything that depends on more than one document. A build that keeps the parts of the documents
// that did not change, as the rows a build stored, and makes new parts of the ones that did must give the tree of a whole
// build. The property test below runs 250 random repositories, each changed one to five times at random, and compares
// the two, so any state the assembly reads that the rows do not keep shows as a failing seed.

import { describe, expect, it } from "vitest";
import {
  type BrainChange,
  type BrainDocumentPart,
  type BrainNode,
  type BrainSourceDocument,
  type BrainTree,
  assembleBrainTree,
  brainDocumentPart,
  brainHomeOf,
  brainPartsFromRows,
  brainRefRows,
  buildBrainTree,
} from "../src/brain.js";

/** A small deterministic generator (mulberry32), so a failing round can be replayed from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const chance = (rng: Rng, probability: number): boolean => rng() < probability;
const between = (rng: Rng, low: number, high: number): number => low + Math.floor(rng() * (high - low + 1));

const FOLDERS = ["alpha", "beta", "gamma", "docs"];
const PAGES = ["intro", "setup", "api", "notes", "guide", "faq"];
const IDS = ["RULE-AAA-0001", "RULE-AAA-0002", "COM-BBB-0001", "SEC-CCC-0001"];
const HEADINGS = ["Setup", "Usage", "Notes", "Late fee", "Data", "Open questions"];
const KEYS = ["ENG", "OPS", "Eng", "hr", "E", "ENG-1", "TEAM2"];

interface Repo {
  [path: string]: string;
}

function folderPath(rng: Rng): string {
  const depth = between(rng, 0, 3);
  return Array.from({ length: depth }, () => pick(rng, FOLDERS)).join("/");
}

function linkTo(rng: Rng, paths: readonly string[], from: string): string {
  const target = chance(rng, 0.75) && paths.length > 0 ? pick(rng, paths) : `${pick(rng, FOLDERS)}/${pick(rng, PAGES)}.md`;
  const fromFolder = from.split("/").slice(0, -1);
  const toFolder = target.split("/").slice(0, -1);
  let shared = 0;
  while (shared < fromFolder.length && shared < toFolder.length && fromFolder[shared] === toFolder[shared]) shared += 1;
  const relative = [...fromFolder.slice(shared).map(() => ".."), ...target.split("/").slice(shared)].join("/");
  const anchor = chance(rng, 0.5) ? `#${pick(rng, [pick(rng, HEADINGS).toLowerCase().replace(/ /g, "-"), pick(rng, HEADINGS).replace(/ /g, "-"), `${pick(rng, IDS).toLowerCase()}-late-fee`])}` : "";
  const folderLink = chance(rng, 0.1) ? relative.replace(/[^/]*$/, "") : relative;
  return `[${pick(rng, HEADINGS)}](${folderLink}${anchor})`;
}

function pageText(rng: Rng, path: string, paths: readonly string[]): string {
  const lines: string[] = [];
  const home = /(^|\/)README\.md$/i.test(path);
  if (home || chance(rng, 0.3)) {
    lines.push("---");
    if (home && chance(rng, 0.7)) lines.push(`key: ${pick(rng, KEYS)}`);
    if (home && chance(rng, 0.4)) lines.push("order:", ...Array.from({ length: between(rng, 1, 3) }, () => `  - ${pick(rng, [...PAGES, ...FOLDERS])}`));
    if (chance(rng, 0.5)) lines.push(`labels: [${Array.from({ length: between(rng, 1, 3) }, () => pick(rng, ["runbook", "ops", "Sev-1", "draft"])).join(", ")}]`);
    if (chance(rng, 0.3)) lines.push(`status: ${pick(rng, ["current", "archived", "draft"])}`);
    if (chance(rng, 0.2)) lines.push("owner: lead");
    lines.push("---", "");
  }
  if (chance(rng, 0.8)) lines.push(`# ${pick(rng, HEADINGS)} of ${path.split("/").pop() ?? path}`, "");
  lines.push(`How ${path} works. ${chance(rng, 0.6) ? linkTo(rng, paths, path) : ""}`, "");
  for (let section = between(rng, 0, 4); section > 0; section -= 1) {
    const level = between(rng, 2, 4);
    const id = chance(rng, 0.3) ? pick(rng, IDS) : undefined;
    lines.push(`${"#".repeat(level)} ${id === undefined ? pick(rng, HEADINGS) : `${id}: Late fee`}`, "");
    for (let line = between(rng, 0, 3); line > 0; line -= 1) {
      lines.push(chance(rng, 0.5) ? `See ${linkTo(rng, paths, path)} and ${linkTo(rng, paths, path)}.` : chance(rng, 0.5) ? `Applies ${pick(rng, IDS)} here.` : "Plain text.", "");
    }
  }
  return lines.join("\n");
}

function randomRepo(rng: Rng): Repo {
  const repo: Repo = {};
  const paths: string[] = [];
  for (let page = between(rng, 6, 24); page > 0; page -= 1) {
    const path = `${folderPath(rng)}/${chance(rng, 0.2) ? "README" : pick(rng, PAGES)}.md`.replace(/^\//, "");
    if (!paths.includes(path)) paths.push(path);
  }
  for (const path of paths) repo[path] = pageText(rng, path, paths);
  return repo;
}

/** One to five random changes: add, rewrite, delete, rename, a home page's key or order, one more definition of an id. */
function change(rng: Rng, before: Repo): Repo {
  const repo = { ...before };
  for (let step = between(rng, 1, 5); step > 0; step -= 1) {
    const paths = Object.keys(repo);
    const target = paths.length === 0 ? undefined : pick(rng, paths);
    switch (between(rng, 0, 6)) {
      case 0: {
        const path = `${folderPath(rng)}/${pick(rng, PAGES)}.md`.replace(/^\//, "");
        repo[path] = pageText(rng, path, paths);
        break;
      }
      case 1:
        if (target !== undefined) repo[target] = pageText(rng, target, paths);
        break;
      case 2:
        if (target !== undefined) delete repo[target];
        break;
      case 3:
        if (target !== undefined) {
          const renamed = `${folderPath(rng)}/${pick(rng, PAGES)}.md`.replace(/^\//, "");
          repo[renamed] = repo[target] ?? "";
          if (renamed !== target) delete repo[target];
        }
        break;
      case 4: {
        const home = `${folderPath(rng)}/README.md`.replace(/^\//, "");
        repo[home] = pageText(rng, home, paths);
        break;
      }
      case 5:
        if (target !== undefined) repo[target] = `${repo[target] ?? ""}\n\n### ${pick(rng, IDS)}: Again\n\nA fourth place that defines the id.\n`;
        break;
      default:
        if (target !== undefined) repo[target] = (repo[target] ?? "").replace(/^(#{2,4}) .*$/m, "");
    }
  }
  return repo;
}

/** The last change of a path is an input of the build, fixed by the path: this test does not read Git. */
const changedOf = (path: string): BrainChange => ({ commit: `c${path.length.toString(16).padStart(39, "0")}`, at: `2026-0${(path.length % 9) + 1}-01T00:00:00Z`, subject: `Edit ${path}` });
const sourcesOf = (repo: Repo): BrainSourceDocument[] => Object.entries(repo).map(([path, text]) => ({ path, text, changed: changedOf(path) }));

/** The rows a build stores for a tree: the node rows of its documents with their home data, and the reference rows. */
function toRows(tree: BrainTree, parts: readonly BrainDocumentPart[]) {
  const partOf = new Map(parts.map((part) => [part.path, part]));
  const nodes = tree.nodes.flatMap((node) => {
    const part = partOf.get(node.path);
    return part === undefined ? [] : [{ node, home: brainHomeOf(part, node) }];
  });
  const refs = parts.flatMap((part) => brainRefRows(part));
  // Through JSON, as the database keeps them.
  return JSON.parse(JSON.stringify({ nodes, refs })) as { nodes: Array<{ node: BrainNode; home: ReturnType<typeof brainHomeOf> }>; refs: ReturnType<typeof brainRefRows> };
}

const ROUNDS = 250;

describe("assembling the parts of documents that did not change with the parts of those that did (P2-022)", () => {
  it(`gives the tree of a whole build, in ${ROUNDS} random repositories changed at random`, () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const seed = 1000 + round;
      const rng = random(seed);
      const before = randomRepo(rng);
      const after = change(rng, before);

      const partsBefore = sourcesOf(before).map(brainDocumentPart);
      const rows = toRows(assembleBrainTree(partsBefore, "docs", partsBefore.length), partsBefore);
      const changedPaths = new Set([...Object.keys(before), ...Object.keys(after)].filter((path) => before[path] !== after[path]));
      const kept = brainPartsFromRows(
        rows.nodes.filter((row) => !changedPaths.has(row.node.path)),
        rows.refs.filter((ref) => !changedPaths.has(ref.path)),
      );
      const fresh = sourcesOf(after).filter((source) => changedPaths.has(source.path)).map(brainDocumentPart);

      const whole = buildBrainTree(sourcesOf(after), "docs");
      const incremental = assembleBrainTree([...kept, ...fresh], "docs", Object.keys(after).length);
      expect(incremental, `seed ${seed}`).toEqual(whole);
    }
  });

  it("covers what the assembly decides: the generator makes spaces, orders, broken links and ids with more than three places", () => {
    let spaces = 0;
    let broken = 0;
    let ordered = 0;
    let crowded = 0;
    let warned = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const rng = random(1000 + round);
      const tree = buildBrainTree(sourcesOf(randomRepo(rng)), "docs");
      if (tree.nodes.some((node) => node.space !== null)) spaces += 1;
      if (tree.broken.length > 0) broken += 1;
      if (tree.links.some((link) => link.kind === "link")) ordered += 1;
      if (tree.warnings.length > 0) warned += 1;
      const defined = new Map<string, number>();
      for (const node of tree.nodes) for (const id of node.ids) defined.set(id, (defined.get(id) ?? 0) + 1);
      if ([...defined.values()].some((count) => count > 3)) crowded += 1;
    }
    for (const [name, count] of Object.entries({ spaces, broken, ordered, crowded, warned })) expect(count, name).toBeGreaterThan(ROUNDS / 20);
  });

  it("gives the same tree whatever the order of the parts, and does not change them", () => {
    for (let round = 0; round < 40; round += 1) {
      const rng = random(5000 + round);
      const parts = sourcesOf(randomRepo(rng)).map(brainDocumentPart);
      const frozen = JSON.stringify(parts);
      const shuffled = [...parts].sort(() => rng() - 0.5);
      const first = assembleBrainTree(parts, "docs");
      expect(assembleBrainTree(shuffled, "docs"), `seed ${5000 + round}`).toEqual(first);
      // A second assembly of the same parts: nothing was left behind in them by the first.
      expect(assembleBrainTree(parts, "docs")).toEqual(first);
      expect(JSON.stringify(parts)).toBe(frozen);
    }
  });

  it("keeps the count of documents the cap cut off", () => {
    const parts = sourcesOf({ "a.md": "# A\n", "b.md": "# B\n" }).map(brainDocumentPart);
    expect(assembleBrainTree(parts, "docs", 5)).toMatchObject({ documents: 2, skipped: 3 });
    expect(assembleBrainTree(parts, "docs")).toMatchObject({ documents: 2, skipped: 0 });
  });
});
