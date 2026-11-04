// The Brain's use cases (ADR-0091) over an index kept in memory: the state it reports, the branch rules of turning it
// on, the reads an agent reasons with (a level of the tree, a node's numbered lines and citation, a lookup, a word
// search) and what changed since an earlier commit. The stored index and Git have tests of their own.

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { BRAIN_MAX_BROKEN_LINKS, type BrainLink, type BrainNode, type BrainSource, buildBrainTree, isBrainIndexedPath } from "@kintsugi/domain";
import { describe, expect, it, vi } from "vitest";
import type { AuditTrail } from "../../src/common/audit/audit-trail.js";
import { BrainService, termsOf } from "../../src/modules/delivery/brain/application/brain.service.js";
import { BrainBuildQueue, BrainIndex } from "../../src/modules/delivery/brain/domain/brain.ports.js";
import { type DiffFile, type DocumentDiff, type DocumentsService, type GrepLine, diffFileWithin } from "../../src/modules/delivery/documents/index.js";

const COMMIT = "c".repeat(40);
const SPEC_PATH = "10-applications/billing/01-legacy/invoice/spec.md";
const SPEC = [
  "# Calculate tax", // 1
  "", // 2
  "How the batch computes the tax.", // 3
  "", // 4
  "## Business rules", // 5
  "", // 6
  "### RULE-INV01-0001: Late fee", // 7
  "", // 8
  "- **priority:** P0", // 9
  "", // 10
  "## Notes", // 11
  "", // 12
  "Plain notes.", // 13
].join("\n");
const FILES: Record<string, string> = {
  "01-standards/README.md": "# Standards\n\nHow this project writes code.\n",
  [SPEC_PATH]: SPEC,
  "10-applications/billing/01-legacy/invoice/data-objects.md": "## Invoice line\n\nSee RULE-INV01-0001.\n",
};

/** Postgres' `order by path collate "C"`. */
const byPath = (a: BrainNode, b: BrainNode): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

class MemoryIndex extends BrainIndex {
  nodes: BrainNode[];
  links_: BrainLink[];
  row: BrainSource | undefined;
  constructor(row: Partial<BrainSource> | undefined) {
    super();
    const tree = buildBrainTree(
      Object.entries(FILES).map(([path, text]) => ({ path, text })),
      "shop-docs",
    );
    this.nodes = tree.nodes;
    this.links_ = tree.links;
    this.row = row === undefined ? undefined : source(row);
  }
  async source() {
    return this.row;
  }
  async configure(projectId: string, input: { branch: string; enabled: boolean; wiki?: boolean | undefined }, actor: string) {
    const { wiki, ...rest } = input;
    this.row = source({ ...this.row, projectId, ...rest, ...(wiki === undefined ? {} : { wiki }), updatedBy: actor });
    return this.row;
  }
  async setWiki(_projectId: string, wiki: boolean, actor: string) {
    if (this.row === undefined) return undefined;
    this.row = { ...this.row, wiki, updatedBy: actor };
    return this.row;
  }
  broken_: Array<{ from: string; target: string }> = [];
  async broken() {
    return this.broken_;
  }
  async backlinks(_projectId: string, target: { id: string; path: string; kind: string }, offset: number, limit: number) {
    const rows = this.links_
      .filter((link) => link.toId === target.id || (target.kind === "document" && link.toId.startsWith(`${target.path}#`)))
      .filter((link) => this.nodes.find((node) => node.id === link.fromId)?.path !== target.path)
      .sort((a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId));
    return { rows: rows.slice(offset, offset + limit).map((link) => ({ fromId: link.fromId, toId: link.toId, kind: link.kind })), total: rows.length };
  }
  async nodesByIds(_projectId: string, ids: readonly string[]) {
    return this.nodes.filter((node) => ids.includes(node.id));
  }
  async request(_projectId: string, actor: string) {
    if (this.row?.enabled !== true) return undefined;
    this.row = { ...this.row, updatedBy: actor };
    return this.row;
  }
  async node(_projectId: string, id: string) {
    return this.nodes.find((node) => node.id === id);
  }
  async children(_projectId: string, parentId: string, offset: number, limit: number) {
    const items = this.nodes.filter((node) => node.parentId === parentId).sort((a, b) => a.ordinal - b.ordinal);
    return { items: items.slice(offset, offset + limit), total: items.length };
  }
  async childrenOf(projectId: string, parentIds: readonly string[], limit: number) {
    return new Map(await Promise.all(parentIds.map(async (id) => [id, (await this.children(projectId, id, 0, limit)).items] as const)));
  }
  async ancestors(_projectId: string, id: string) {
    const chain: BrainNode[] = [];
    for (let node = this.nodes.find((each) => each.id === id); node?.parentId != null; ) {
      const parent = this.nodes.find((each) => each.id === node?.parentId);
      if (parent === undefined) break;
      chain.unshift(parent);
      node = parent;
    }
    return chain;
  }
  async lookup(_projectId: string, id: string, limit: number) {
    return this.nodes.filter((node) => node.ids.includes(id)).slice(0, limit);
  }
  async byLabel(_projectId: string, label: string, limit: number) {
    return this.nodes.filter((node) => node.kind === "document" && node.labels.includes(label)).sort(byPath).slice(0, limit);
  }
  async wikiProjectsOf() {
    return this.row?.wiki === true ? [{ projectId: this.row.projectId, branch: this.row.branch }] : [];
  }
  async bySpace(_projectId: string, space: string, limit: number) {
    return this.nodes.filter((node) => node.kind === "document" && node.space === space).sort(byPath).slice(0, limit);
  }
  async byPath(_projectId: string, path: string, limit: number) {
    return this.nodes.filter((node) => (node.kind === "folder" || node.kind === "document") && (node.path === path || node.id === path)).slice(0, limit);
  }
  async links(_projectId: string, id: string, limit: number) {
    const outgoing = this.links_.filter((link) => link.fromId === id);
    const incoming = this.links_.filter((link) => link.toId === id);
    const linked = (ids: string[]) => ids.slice(0, limit).map((each) => ({ ...this.nodes.find((node) => node.id === each)!, linkKind: "id" as const }));
    return { outgoing: linked(outgoing.map((link) => link.toId)), incoming: linked(incoming.map((link) => link.fromId)), outgoingTotal: outgoing.length, incomingTotal: incoming.length };
  }
  async nodesAtLines(_projectId: string, hits: ReadonlyArray<{ path: string; line: number }>) {
    return hits.map((hit) =>
      this.nodes
        .filter((node) => node.kind !== "folder" && node.path === hit.path && node.lineStart !== null && node.lineEnd !== null && node.lineStart <= hit.line && node.lineEnd >= hit.line)
        .sort((a, b) => b.depth - a.depth)[0],
    );
  }
  async nodesInRanges(_projectId: string, path: string, ranges: ReadonlyArray<{ start: number; end: number }>, limit: number) {
    return this.nodes
      .filter((node) => node.kind !== "folder" && node.path === path && ranges.some((range) => node.lineStart !== null && node.lineEnd !== null && node.lineStart <= range.end && node.lineEnd >= range.start))
      .sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0))
      .slice(0, limit);
  }
}

function source(overrides: Partial<BrainSource>): BrainSource {
  return {
    projectId: "shop",
    branch: "main",
    enabled: true,
    wiki: false,
    state: "ready",
    indexedCommit: COMMIT,
    attemptedCommit: COMMIT,
    indexedAt: "2026-10-31T00:00:00.000Z",
    builderVersion: 4,
    documents: 3,
    nodes: 12,
    identifiers: 1,
    links: 2,
    tokens: 90,
    skipped: 5,
    durationMs: 7,
    error: null,
    requestedAt: "2026-10-31T00:00:00.000Z",
    startedAt: "2026-10-31T00:00:00.000Z",
    updatedBy: "alice",
    updatedAt: "2026-10-31T00:00:01.000Z",
    ...overrides,
  };
}

interface Setup {
  row?: Partial<BrainSource> | undefined;
  noRow?: boolean;
  tips?: string[];
  context?: () => Promise<unknown>;
  text?: (path: string) => string | undefined;
  grep?: { matches: GrepLine[]; truncated: boolean };
  diff?: DocumentDiff | undefined;
}

function setup(options: Setup = {}) {
  const index = new MemoryIndex(options.noRow === true ? undefined : (options.row ?? {}));
  const queue = { enqueue: vi.fn(async () => undefined) } satisfies BrainBuildQueue;
  const tips = new Map((options.tips ?? ["main"]).map((name, at) => [name, { name, commit: `${at}`.repeat(40), date: "2026-10-31T00:00:00.000Z" }]));
  const documents = {
    context: vi.fn(options.context ?? (async () => ({ defaultBranch: "main" }))),
    branchTips: vi.fn(async () => ({ tips, defaultTip: tips.get("main") })),
    readText: vi.fn(async (_context: unknown, _commit: string, path: string) => (options.text === undefined ? FILES[path] : options.text(path))),
    grep: vi.fn(async () => options.grep ?? { matches: [], truncated: false }),
    diff: vi.fn(async () => ("diff" in options ? options.diff : { from: "f".repeat(40), files: [], linesKnown: true })),
  };
  const audit = { recordChange: vi.fn(async () => undefined) };
  const brain = new BrainService(index, queue, documents as unknown as DocumentsService, audit as unknown as AuditTrail);
  return { brain, index, queue, documents, audit };
}

const actor = { id: "u1", username: "alice", permissions: [] };

describe("termsOf", () => {
  it("takes a quoted phrase whole, and otherwise each distinct word, at most eight", () => {
    expect(termsOf('  "late fee"  ')).toEqual(["late fee"]);
    expect(termsOf("late  fee late")).toEqual(["late", "fee"]);
    expect(termsOf("a b c d e f g h i j")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(termsOf('"late fee')).toEqual(['"late', "fee"]);
    expect(termsOf('x "late fee"')).toEqual(["x", '"late', 'fee"']);
    expect(termsOf('"a" b')).toEqual(['"a"', "b"]);
  });
});

describe("diffFileWithin", () => {
  const file = (overrides: Partial<DiffFile>): DiffFile => ({ path: "a.md", previousPath: null, status: "modified", added: 1, removed: 1, hunks: [{ start: 2, end: 2 }], ...overrides });
  const indexed = (changed: DiffFile) => diffFileWithin(changed, isBrainIndexedPath);

  it("keeps changes of the paths a reader sees and drops the others", () => {
    expect(indexed(file({}))).toEqual(file({}));
    expect(indexed(file({ path: "plugins/demo/README.md" }))).toBeUndefined();
    expect(indexed(file({ path: "plugins/demo/README.md", status: "deleted" }))).toBeUndefined();
    expect(indexed(file({ path: "a.md", previousPath: "b.md", status: "renamed" }))).toMatchObject({ path: "a.md", previousPath: "b.md", status: "renamed" });
    expect(indexed(file({ path: "plugins/a.md", previousPath: "scratch/a.md", status: "renamed" }))).toBeUndefined();
  });

  it("calls a file moved out of sight gone, and one moved into sight new, without naming the other side", () => {
    expect(indexed(file({ path: "plugins/demo/a.md", previousPath: "notes/a.md", status: "renamed" }))).toEqual(file({ path: "notes/a.md", status: "deleted", hunks: [] }));
    expect(indexed(file({ path: "notes/a.md", previousPath: "restricted/a.md", status: "renamed" }))).toEqual(file({ path: "notes/a.md", status: "added", hunks: [] }));
  });
});

describe("BrainService.status", () => {
  it("says why a project without a document repository has nothing to index", async () => {
    const { brain } = setup({ noRow: true, context: async () => Promise.reject(new ConflictException("Project shop has no document repository")) });
    expect(await brain.status("shop")).toEqual({
      projectId: "shop",
      available: false,
      reason: "Project shop has no document repository",
      configured: false,
      enabled: false,
      wiki: false,
      state: "not-built",
      branch: "main",
      defaultBranch: null,
      branches: [],
      commit: null,
      tip: null,
      indexedAt: null,
      documents: 0,
      nodes: 0,
      identifiers: 0,
      links: 0,
      tokens: 0,
      skipped: 0,
      durationMs: null,
      error: null,
      updatedBy: null,
      updatedAt: null,
    });
  });

  it("does not hide other failures", async () => {
    const { brain } = setup({ context: async () => Promise.reject(new Error("database down")) });
    await expect(brain.status("shop")).rejects.toThrow("database down");
  });

  it("reports the index, its branch's tip and the branches it could follow, the default first and no output branch", async () => {
    const { brain } = setup({ row: { branch: "release" }, tips: ["zeta", "kintsugi/run-1", "main", "alpha", "release"] });
    const status = await brain.status("shop");
    expect(status).toStrictEqual({
      projectId: "shop",
      available: true,
      configured: true,
      enabled: true,
      wiki: false,
      state: "ready",
      branch: "release",
      defaultBranch: "main",
      branches: ["main", "alpha", "release", "zeta"],
      commit: COMMIT,
      tip: "4".repeat(40),
      indexedAt: "2026-10-31T00:00:00.000Z",
      documents: 3,
      nodes: 12,
      identifiers: 1,
      links: 2,
      tokens: 90,
      skipped: 5,
      durationMs: 7,
      error: null,
      updatedBy: "alice",
      updatedAt: "2026-10-31T00:00:01.000Z",
    });
  });

  it("shows an index that is off as off, whatever its last build did", async () => {
    const { brain } = setup({ row: { enabled: false, state: "failed", error: "boom" } });
    expect(await brain.status("shop")).toMatchObject({ state: "off", enabled: false, error: "boom" });
  });

  it("follows the default branch until one is chosen, and lists it first", async () => {
    const { brain } = setup({ noRow: true, context: async () => ({ defaultBranch: "trunk" }), tips: ["zeta", "beta", "trunk", "alpha", "omega", "delta"] });
    expect(await brain.status("shop")).toMatchObject({ branch: "trunk", defaultBranch: "trunk", available: true, configured: false, branches: ["trunk", "alpha", "beta", "delta", "omega", "zeta"] });
  });
});

describe("BrainService.configure and rebuild", () => {
  it("refuses an output branch and a branch the mirror lacks", async () => {
    const { brain, queue } = setup({ tips: ["main", "kintsugi/run-1"] });
    await expect(brain.configure("shop", { branch: "kintsugi/run-1", enabled: true }, actor)).rejects.toThrow(BadRequestException);
    await expect(brain.configure("shop", { branch: "gone", enabled: true }, actor)).rejects.toThrow(/Branch gone is not in the mirror/);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("turns the index on, queues a build and records who did it", async () => {
    const { brain, queue, audit, index } = setup({ noRow: true, tips: ["main", "release"] });
    const status = await brain.configure("shop", { branch: "release", enabled: true }, actor);
    expect(status).toMatchObject({ branch: "release", enabled: true });
    expect(index.row).toMatchObject({ branch: "release", enabled: true });
    expect(queue.enqueue).toHaveBeenCalledWith("shop");
    expect(audit.recordChange).toHaveBeenCalledWith({ actor: "u1", action: "brain.configure", projectId: "shop", detail: { branch: "release", enabled: true, username: "alice" } });
  });

  it("keeps the chosen branch, else the default one, and turns off without checking or building", async () => {
    const kept = setup({ row: { branch: "release" }, tips: ["main"] });
    await kept.brain.configure("shop", { enabled: false }, actor);
    expect(kept.index.row).toMatchObject({ branch: "release", enabled: false });
    expect(kept.queue.enqueue).not.toHaveBeenCalled();
    const fresh = setup({ noRow: true, context: async () => ({ defaultBranch: "trunk" }), tips: ["trunk"] });
    await fresh.brain.configure("shop", { enabled: true }, { id: "u2", permissions: [] });
    expect(fresh.index.row).toMatchObject({ branch: "trunk", updatedBy: "u2" });
    expect(fresh.audit.recordChange).toHaveBeenCalledWith(expect.objectContaining({ actor: "u2", detail: { branch: "trunk", enabled: true } }));
  });

  it("rebuilds an index that is on, and refuses one that is off", async () => {
    const on = setup();
    expect(await on.brain.rebuild("shop", actor)).toMatchObject({ state: "ready" });
    expect(on.queue.enqueue).toHaveBeenCalledWith("shop");
    expect(on.audit.recordChange).toHaveBeenCalledWith({ actor: "u1", action: "brain.rebuild", projectId: "shop", detail: { username: "alice" } });
    expect(on.index.row?.updatedBy).toBe("alice");
    const anonymous = setup({ row: { updatedBy: "someone" } });
    await anonymous.brain.rebuild("shop", { id: "u3", permissions: [] });
    expect(anonymous.index.row?.updatedBy).toBe("u3");
    const off = setup({ row: { enabled: false } });
    await expect(off.brain.rebuild("shop", actor)).rejects.toThrow(/off: turn it on first/);
    expect(off.queue.enqueue).not.toHaveBeenCalled();
  });
});

describe("BrainService.followDefaultBranch", () => {
  it("moves the Brain of a wiki project to the new branch, builds it and audits the change", async () => {
    const { brain, queue, audit, index } = setup({ row: { wiki: true, branch: "main" }, tips: ["main", "release"] });
    await brain.followDefaultBranch("docs", "release", actor);
    expect(index.row).toMatchObject({ wiki: true, enabled: true, branch: "release" });
    expect(queue.enqueue).toHaveBeenCalledWith("shop");
    expect(audit.recordChange).toHaveBeenCalledWith({ actor: "u1", action: "brain.configure", projectId: "shop", detail: { branch: "release", enabled: true, wiki: true, reason: "default-branch", username: "alice" } });
  });

  it("waits for the sync when the mirror lacks the branch, and leaves projects that are not wikis or already there", async () => {
    const early = setup({ row: { wiki: true, branch: "main" }, tips: ["main"] });
    await early.brain.followDefaultBranch("docs", "release", actor);
    expect(early.index.row).toMatchObject({ branch: "release" });
    expect(early.queue.enqueue).not.toHaveBeenCalled();
    const plain = setup({ row: { wiki: false, branch: "main" }, tips: ["main", "release"] });
    await plain.brain.followDefaultBranch("docs", "release", actor);
    expect(plain.index.row).toMatchObject({ branch: "main" });
    const there = setup({ row: { wiki: true, branch: "release" }, tips: ["main", "release"] });
    await there.brain.followDefaultBranch("docs", "release", actor);
    expect(there.queue.enqueue).not.toHaveBeenCalled();
    expect(there.audit.recordChange).not.toHaveBeenCalled();
  });
});

describe("BrainService wiki switch", () => {
  it("turns the Brain on for the default branch, builds it and records the change", async () => {
    const { brain, queue, audit, index } = setup({ row: { branch: "release", enabled: false }, tips: ["main", "release"] });
    const status = await brain.setWiki("shop", true, actor);
    expect(status).toMatchObject({ wiki: true, enabled: true, branch: "main" });
    expect(index.row).toMatchObject({ wiki: true, enabled: true, branch: "main" });
    expect(queue.enqueue).toHaveBeenCalledWith("shop");
    expect(audit.recordChange).toHaveBeenCalledWith({ actor: "u1", action: "wiki.switch", projectId: "shop", detail: { enabled: true, branch: "main", username: "alice" } });
    const fresh = setup({ noRow: true, tips: ["main"] });
    await fresh.brain.setWiki("shop", true, actor);
    expect(fresh.index.row).toMatchObject({ wiki: true, enabled: true, branch: "main" });
  });

  it("changes and queues nothing when the wiki is already on, and says why the default branch is missing", async () => {
    const on = setup({ row: { wiki: true, branch: "main" }, tips: ["main"] });
    await on.brain.setWiki("shop", true, actor);
    expect(on.queue.enqueue).not.toHaveBeenCalled();
    expect(on.audit.recordChange).not.toHaveBeenCalled();
    const off = setup({ row: { wiki: false }, tips: ["main"] });
    await off.brain.setWiki("shop", false, actor);
    expect(off.audit.recordChange).not.toHaveBeenCalled();
    const unsynced = setup({ noRow: true, tips: ["other"] });
    await expect(unsynced.brain.setWiki("shop", true, actor)).rejects.toThrow(ConflictException);
    expect(unsynced.index.row).toBeUndefined();
  });

  it("switches off without touching the Brain, then frees its branch", async () => {
    const { brain, queue, audit, index } = setup({ row: { wiki: true, branch: "main" }, tips: ["main", "release"] });
    const status = await brain.setWiki("shop", false, actor);
    expect(status).toMatchObject({ wiki: false, enabled: true, branch: "main" });
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(audit.recordChange).toHaveBeenCalledWith({ actor: "u1", action: "wiki.switch", projectId: "shop", detail: { enabled: false, branch: "main", username: "alice" } });
    await brain.configure("shop", { branch: "release", enabled: true }, actor);
    expect(index.row).toMatchObject({ wiki: false, branch: "release" });
  });

  it("keeps a wiki project's Brain on the default branch and on", async () => {
    const { brain, queue, index } = setup({ row: { wiki: true, branch: "main" }, tips: ["main", "release"] });
    await expect(brain.configure("shop", { branch: "release", enabled: true }, actor)).rejects.toThrow("A wiki project's Brain follows the default branch");
    await expect(brain.configure("shop", { branch: "release", enabled: true }, actor)).rejects.toThrow(ConflictException);
    await expect(brain.configure("shop", { enabled: false }, actor)).rejects.toThrow("Turn the wiki off before turning the Brain off");
    expect(index.row).toMatchObject({ wiki: true, branch: "main", enabled: true });
    expect(queue.enqueue).not.toHaveBeenCalled();
    await brain.configure("shop", { branch: "main", enabled: true }, actor);
    await brain.configure("shop", { enabled: true }, actor);
    expect(index.row).toMatchObject({ wiki: true, branch: "main" });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });
});

describe("BrainService reads", () => {
  it("refuse until an index is on and built, and say why", async () => {
    await expect(setup({ noRow: true }).brain.tree("shop", { depth: 1, offset: 0, limit: 10 })).rejects.toThrow(/not set up/);
    await expect(setup({ row: { enabled: false } }).brain.tree("shop", { depth: 1, offset: 0, limit: 10 })).rejects.toThrow(/is off\.$/);
    await expect(setup({ row: { indexedCommit: null, state: "failed", error: "no branch" } }).brain.tree("shop", { depth: 1, offset: 0, limit: 10 })).rejects.toThrow(
      "The Brain of this project could not be built: no branch",
    );
    await expect(setup({ row: { indexedCommit: null, state: "failed" } }).brain.tree("shop", { depth: 1, offset: 0, limit: 10 })).rejects.toThrow(/built: unknown error/);
    await expect(setup({ row: { indexedCommit: null, state: "indexing" } }).brain.tree("shop", { depth: 1, offset: 0, limit: 10 })).rejects.toThrow(/being built/);
  });

  it("list one level from the root, a page at a time and at most 200, with grandchildren at depth 2", async () => {
    const { brain, index } = setup();
    const children = vi.spyOn(index, "children");
    const top = await brain.tree("shop", { node: "", depth: 1, offset: 1, limit: 500 });
    expect(children).toHaveBeenCalledWith("shop", "/", 1, 200);
    expect(top).toMatchObject({ projectId: "shop", branch: "main", commit: COMMIT, breadcrumb: [], total: 2, offset: 1 });
    expect(top.node.id).toBe("/");
    expect(top.children.map((child) => child.id)).toEqual(["10-applications/"]);
    expect(top.children[0]).not.toHaveProperty("nodes");

    const grandchildren = vi.spyOn(index, "childrenOf");
    const deep = await brain.tree("shop", { depth: 2, offset: 0, limit: 10 });
    expect(grandchildren).toHaveBeenCalledWith("shop", ["01-standards/", "10-applications/"], 20);
    expect(deep.children.map((child) => [child.id, "nodes" in child ? child.nodes?.map((node) => node.id) : null])).toEqual([
      ["01-standards/", ["01-standards/README.md"]],
      ["10-applications/", ["10-applications/billing/"]],
    ]);
    // At depth 1 nothing is read below the children, and a child without children gets no grandchildren list.
    grandchildren.mockClear();
    await brain.tree("shop", { depth: 1, offset: 0, limit: 10 });
    expect(grandchildren).not.toHaveBeenCalled();
    const standards = await brain.tree("shop", { node: "01-standards/", depth: 2, offset: 0, limit: 10 });
    expect(grandchildren).toHaveBeenCalledWith("shop", [], 20);
    expect(standards.children[0]).not.toHaveProperty("nodes");
    const leaf = await brain.tree("shop", { node: "01-standards/README.md", depth: 2, offset: 0, limit: 10 });
    expect(leaf.breadcrumb.map((crumb) => crumb.id)).toEqual(["/", "01-standards/"]);
    expect(leaf.breadcrumb[1]).toEqual({ id: "01-standards/", kind: "folder", title: "01-standards" });
    await expect(brain.tree("shop", { node: "nowhere.md", depth: 1, offset: 0, limit: 10 })).rejects.toThrow(new NotFoundException("No node nowhere.md in the Brain; start from the root or look the id up."));
    await expect(brain.tree("shop", { node: "x".repeat(300), depth: 1, offset: 0, limit: 10 })).rejects.toThrow(`No node ${"x".repeat(200)} in the Brain;`);
  });

  it("read a node whole when small, numbered for citing, with its children, links and citation", async () => {
    const { brain, index } = setup();
    const children = vi.spyOn(index, "children");
    const links = vi.spyOn(index, "links");
    const read = await brain.read("shop", { node: SPEC_PATH, scope: "auto", maxChars: 10_000, lineNumbers: true });
    expect(children).toHaveBeenCalledWith("shop", SPEC_PATH, 0, 50);
    expect(links).toHaveBeenCalledWith("shop", SPEC_PATH, 20);
    expect(read.scope).toBe("subtree");
    expect(read.lineNumbers).toBe(true);
    expect(read.text.split("\n")).toEqual(SPEC.split("\n").map((line, at) => `${at + 1}\t${line}`));
    expect(read.citation).toEqual({ nodeId: SPEC_PATH, path: SPEC_PATH, lineStart: 1, lineEnd: 13, commit: COMMIT });
    expect(read).toMatchObject({ truncated: false, nextLine: null, branch: "main", commit: COMMIT, projectId: "shop" });
    expect(read.children.map((child) => child.id)).toEqual([`${SPEC_PATH}#business-rules`, `${SPEC_PATH}#notes`]);

    const card = await brain.read("shop", { node: `${SPEC_PATH}#RULE-INV01-0001`, scope: "node", maxChars: 10_000 });
    expect(card).toMatchObject({ scope: "node", lineNumbers: false, text: "### RULE-INV01-0001: Late fee\n\n- **priority:** P0\n", incomingTotal: 1 });
    expect(card.incoming.map((node) => node.id)).toEqual(["10-applications/billing/01-legacy/invoice/data-objects.md#invoice-line"]);
    expect(card.breadcrumb.map((crumb) => crumb.id).at(-1)).toBe(`${SPEC_PATH}#business-rules`);
  });

  it("read a section's own text, or with what is under it", async () => {
    const { brain } = setup();
    const own = await brain.read("shop", { node: `${SPEC_PATH}#business-rules`, scope: "node", maxChars: 10_000 });
    expect(own.text).toBe("## Business rules\n");
    expect(own.citation).toMatchObject({ lineStart: 5, lineEnd: 6 });
    const whole = await brain.read("shop", { node: `${SPEC_PATH}#business-rules`, scope: "subtree", maxChars: 10_000 });
    expect(whole.citation).toMatchObject({ lineStart: 5, lineEnd: 10 });
  });

  it("read a large node with children as its own text, and a large leaf whole", async () => {
    const { brain, index } = setup();
    const spec = index.nodes.find((node) => node.id === SPEC_PATH)!;
    spec.subtreeTokens = 6000;
    expect((await brain.read("shop", { node: SPEC_PATH, scope: "auto", maxChars: 10_000 })).scope).toBe("subtree");
    spec.subtreeTokens = 6001;
    expect((await brain.read("shop", { node: SPEC_PATH, scope: "auto", maxChars: 10_000 })).scope).toBe("node");
    const card = index.nodes.find((node) => node.kind === "card")!;
    card.subtreeTokens = 9000;
    expect((await brain.read("shop", { node: card.id, scope: "auto", maxChars: 10_000 })).scope).toBe("subtree");
  });

  it("read a folder as no text and no citation", async () => {
    const { brain, documents } = setup();
    expect(await brain.read("shop", { node: "01-standards/", scope: "auto", maxChars: 10_000 })).toMatchObject({ scope: "node", text: "", lineNumbers: false, citation: null, truncated: false, nextLine: null });
    expect(documents.readText).not.toHaveBeenCalled();
  });

  it("cut a read at the character budget, say where to go on, and go on from there", async () => {
    const { brain } = setup({ text: () => "ab\ncd\r\nef\n" });
    const doc = "01-standards/README.md";
    // Each line counts with its newline: "ab" and "cd" fill six characters exactly.
    const first = await brain.read("shop", { node: doc, scope: "subtree", maxChars: 6 });
    expect(first).toMatchObject({ text: "ab\ncd", truncated: true, nextLine: 3, citation: { lineStart: 1, lineEnd: 2 } });
    const next = await brain.read("shop", { node: doc, scope: "subtree", maxChars: 6, fromLine: 3 });
    expect(next).toMatchObject({ text: "ef", truncated: false, nextLine: null, citation: { lineStart: 3, lineEnd: 3 } });
    const before = await brain.read("shop", { node: doc, scope: "subtree", maxChars: 100, fromLine: 0 });
    expect(before.citation).toMatchObject({ lineStart: 1, lineEnd: 3 });
    const after = await brain.read("shop", { node: doc, scope: "subtree", maxChars: 100, fromLine: 99 });
    expect(after.citation).toMatchObject({ lineStart: 3, lineEnd: 3 });
    // A single line longer than the budget is cut, never skipped.
    const long = await brain.read("shop", { node: doc, scope: "subtree", maxChars: 1 });
    expect(long).toMatchObject({ text: "a", truncated: true, nextLine: 2 });
  });

  it("number lines the way Git does, so a citation opens on the same lines elsewhere", async () => {
    // A stray carriage return is not a line break for Git: line 2 stays "cd".
    const { brain } = setup({ text: () => "ab\r\r\ncd\ref\n" });
    const read = await brain.read("shop", { node: "01-standards/README.md", scope: "subtree", maxChars: 100, lineNumbers: true });
    expect(read.text).toBe("1\tab\r\n2\tcd\ref\n3\t");
  });

  it("refuse a read whose document is gone from the indexed commit", async () => {
    const { brain } = setup({ text: () => undefined });
    await expect(brain.read("shop", { node: "01-standards/README.md", scope: "auto", maxChars: 100 })).rejects.toThrow(/can no longer be read at the indexed commit/);
  });

  it("look up a reference id, a node id or a path", async () => {
    const { brain, index } = setup();
    const lookup = vi.spyOn(index, "lookup");
    const byPath = vi.spyOn(index, "byPath");
    const card = await brain.lookup("shop", " `RULE-INV01-0001` ");
    expect(lookup).toHaveBeenCalledWith("shop", "RULE-INV01-0001", 20);
    await brain.lookup("shop", "01-standards");
    expect(byPath).toHaveBeenCalledWith("shop", "01-standards", 20);
    expect(card).toMatchObject({ query: "RULE-INV01-0001", commit: COMMIT, branch: "main" });
    expect(card.matches.map((node) => [node.id, node.breadcrumb.length])).toEqual([[`${SPEC_PATH}#RULE-INV01-0001`, 7]]);
    expect((await brain.lookup("shop", `${SPEC_PATH}#notes`)).matches.map((node) => node.id)).toEqual([`${SPEC_PATH}#notes`]);
    expect((await brain.lookup("shop", "/01-standards/")).matches.map((node) => node.id)).toEqual(["01-standards/"]);
    expect((await brain.lookup("shop", "RULE-NONE-0001")).matches).toEqual([]);
  });
});

describe("BrainService.lookup by label and space", () => {
  it("finds the pages with a label or in a space, and refuses a malformed one", async () => {
    const { brain, index } = setup();
    index.nodes = buildBrainTree(
      [
        { path: "20-spaces/team/README.md", text: "---\nkey: TEAM\n---\n\n# Team\n\nThe team's space.\n" },
        { path: "20-spaces/team/db.md", text: "---\nlabels: [runbook, sev1]\n---\n\n# Database\n\nFail over.\n" },
      ],
      "shop-docs",
    ).nodes;
    const byLabel = vi.spyOn(index, "byLabel");
    const bySpace = vi.spyOn(index, "bySpace");
    const labelled = await brain.lookup("shop", "label:SEV1");
    expect(byLabel).toHaveBeenCalledWith("shop", "sev1", 20);
    expect(labelled).toMatchObject({ query: "label:SEV1", commit: COMMIT });
    expect(labelled.matches.map((node) => node.id)).toEqual(["20-spaces/team/db.md"]);
    expect((await brain.lookup("shop", " `space:team` ")).matches.map((node) => node.id)).toEqual(["20-spaces/team/README.md", "20-spaces/team/db.md"]);
    expect(bySpace).toHaveBeenCalledWith("shop", "TEAM", 20);
    expect((await brain.lookup("shop", "label:unknown")).matches).toEqual([]);
    for (const query of ["label:", "label:   ", `label:${"x".repeat(65)}`, "label:!!", "space:", `space:${"X".repeat(65)}`]) {
      await expect(brain.lookup("shop", query), query).rejects.toThrow(/label|space|characters/i);
    }
  });
});

describe("BrainService.broken", () => {
  it("serves what the build stored with the indexed commit, and says when the build hit its limit", async () => {
    const { brain, index } = setup();
    index.broken_ = [{ from: "a.md", target: "gone.md" }, { from: "b.md", target: "x/missing.md" }];
    expect(await brain.broken("shop")).toEqual({ projectId: "shop", branch: "main", commit: COMMIT, links: index.broken_, truncated: false });
    index.broken_ = Array.from({ length: BRAIN_MAX_BROKEN_LINKS }, (_, at) => ({ from: `p${at}.md`, target: "gone.md" }));
    expect((await brain.broken("shop")).truncated).toBe(true);
  });

  it("is refused like the other reads while the index is off or not built", async () => {
    await expect(setup({ noRow: true }).brain.broken("shop")).rejects.toThrow(ConflictException);
    await expect(setup({ row: { enabled: false } }).brain.broken("shop")).rejects.toThrow(ConflictException);
    await expect(setup({ row: { indexedCommit: null, state: "queued" } }).brain.broken("shop")).rejects.toThrow(ConflictException);
  });
});

describe("BrainService.backlinks", () => {
  const pages = (count: number) =>
    [
      { path: "target.md", text: "# Target\n\n## Setup\n\nSteps.\n" },
      ...Array.from({ length: count }, (_, at) => ({ path: `from/p${String(at).padStart(2, "0")}.md`, text: `# P${at}\n\nSee [setup](../target.md#setup)${at % 2 === 0 ? " and [the page](../target.md)" : ""}.\n` })),
      { path: "inner.md", text: "# Inner\n\n## A\n\nSee [b](#b).\n\n## B\n\nText.\n" },
    ];

  it("counts the links to the page and to its headings, each page once per link, and none from inside the page", async () => {
    const { brain, index } = setup();
    index.nodes = buildBrainTree(pages(3), "shop-docs").nodes;
    index.links_ = buildBrainTree(pages(3), "shop-docs").links;
    const found = await brain.backlinks("shop", { node: "target.md", offset: 0, limit: 20 });
    expect(found).toMatchObject({ total: 5, offset: 0, nextOffset: null, commit: COMMIT, node: { id: "target.md" } });
    expect(found.items.map((item) => [item.node.path, item.target.id])).toEqual([
      ["from/p00.md", "target.md"],
      ["from/p00.md", "target.md#setup"],
      ["from/p01.md", "target.md#setup"],
      ["from/p02.md", "target.md"],
      ["from/p02.md", "target.md#setup"],
    ]);
    expect((await brain.backlinks("shop", { node: "target.md#setup", offset: 0, limit: 20 })).items.map((item) => item.node.path)).toEqual(["from/p00.md", "from/p01.md", "from/p02.md"]);
    expect((await brain.backlinks("shop", { node: "inner.md", offset: 0, limit: 20 })).total).toBe(0);
  });

  it("pages through them and refuses a folder or an unknown node", async () => {
    const { brain, index } = setup();
    const tree = buildBrainTree(pages(25), "shop-docs");
    index.nodes = tree.nodes;
    index.links_ = tree.links;
    const first = await brain.backlinks("shop", { node: "target.md#setup", offset: 0, limit: 20 });
    expect(first).toMatchObject({ total: 25, nextOffset: 20 });
    expect(first.items).toHaveLength(20);
    const second = await brain.backlinks("shop", { node: "target.md#setup", offset: 20, limit: 20 });
    expect(second).toMatchObject({ total: 25, nextOffset: null });
    expect(second.items).toHaveLength(5);
    await expect(brain.backlinks("shop", { node: "from/", offset: 0, limit: 20 })).rejects.toThrow(BadRequestException);
    await expect(brain.backlinks("shop", { node: "nothing.md", offset: 0, limit: 20 })).rejects.toThrow(NotFoundException);
  });
});

describe("BrainService.grep", () => {
  const hit = (path: string, line: number, text = "late fee"): GrepLine => ({ path, line, text });

  it("needs two characters", async () => {
    const { brain } = setup();
    await expect(brain.grep("shop", { text: " a ", ignoreCase: true })).rejects.toThrow(BadRequestException);
    await expect(brain.grep("shop", { text: "ab", ignoreCase: true })).resolves.toMatchObject({ text: "ab", matches: [] });
  });

  it("searches every word at the indexed commit and maps each line to the deepest node that holds it", async () => {
    const { brain, documents, index } = setup({ grep: { matches: [hit(SPEC_PATH, 9), hit(SPEC_PATH, 7), hit("plugins/demo/README.md", 1), hit(SPEC_PATH, 99)], truncated: false } });
    const ancestors = vi.spyOn(index, "ancestors");
    const found = await brain.grep("shop", { text: " late  fee ", ignoreCase: false });
    expect(documents.grep).toHaveBeenCalledWith(expect.anything(), COMMIT, ["late", "fee"], { ignoreCase: false, limit: 200 });
    expect(found).toMatchObject({ text: "late  fee", under: null, truncated: false, commit: COMMIT });
    expect(found.matches.map((match) => [match.node.id, match.line, match.excerpt])).toEqual([
      [`${SPEC_PATH}#RULE-INV01-0001`, 9, "late fee"],
      [`${SPEC_PATH}#RULE-INV01-0001`, 7, "late fee"],
    ]);
    expect(found.matches[0]?.breadcrumb).toHaveLength(7);
    // The breadcrumb of a node is built once.
    expect(ancestors).toHaveBeenCalledTimes(1);
  });

  it("searches under a folder by path, and under a section by its lines", async () => {
    const folder = setup();
    await folder.brain.grep("shop", { text: "fee", under: "10-applications/", ignoreCase: true });
    expect(folder.documents.grep).toHaveBeenCalledWith(expect.anything(), COMMIT, ["fee"], { ignoreCase: true, under: "10-applications", limit: 200 });
    const root = setup();
    await root.brain.grep("shop", { text: "fee", under: "/", ignoreCase: true });
    expect(root.documents.grep).toHaveBeenCalledWith(expect.anything(), COMMIT, ["fee"], { ignoreCase: true, limit: 200 });

    const section = setup({ grep: { matches: [4, 5, 9, 10, 11].map((line) => hit(SPEC_PATH, line)), truncated: false } });
    const found = await section.brain.grep("shop", { text: "fee", under: `${SPEC_PATH}#business-rules`, ignoreCase: true });
    expect(section.documents.grep).toHaveBeenCalledWith(expect.anything(), COMMIT, ["fee"], { ignoreCase: true, under: SPEC_PATH, limit: 200 });
    expect(found.under).toBe(`${SPEC_PATH}#business-rules`);
    expect(found.matches.map((match) => match.line)).toEqual([5, 9, 10]);
  });

  it("limits the search to the pages of a space and a label, before the limit applies", async () => {
    const team = "20-spaces/team/db.md";
    const { brain, documents, index } = setup({ grep: { matches: [hit(team, 6)], truncated: false } });
    index.nodes = buildBrainTree(
      [
        { path: "20-spaces/team/README.md", text: "---\nkey: TEAM\n---\n\n# Team\n\nThe team's space.\n" },
        { path: team, text: "---\nlabels: [runbook, sev1]\n---\n\n# Database\n\nlate fee.\n" },
        { path: "20-spaces/team/cache.md", text: "---\nlabels: [runbook]\n---\n\n# Cache\n\nlate fee.\n" },
      ],
      "shop-docs",
    ).nodes;
    const onlyOf = (call: number) => ([...(documents.grep.mock.calls[call] as unknown as [unknown, string, string[], { only: ReadonlySet<string> }])[3].only]).sort();
    const found = await brain.grep("shop", { text: "late", ignoreCase: true, space: "team", label: "sev1" });
    expect(found).toMatchObject({ space: "TEAM", label: "sev1", truncated: false });
    expect(onlyOf(0)).toEqual([team]);
    expect((documents.grep.mock.calls[0] as unknown as unknown[])[3]).toMatchObject({ limit: 2000 });
    expect(found.matches.map((match) => match.node.path)).toEqual([team]);
    // A label alone limits to its pages; an unknown one has none, so git is not asked.
    await brain.grep("shop", { text: "late", ignoreCase: true, label: "runbook" });
    expect(onlyOf(1)).toEqual(["20-spaces/team/cache.md", team]);
    const none = await brain.grep("shop", { text: "late", ignoreCase: true, label: "unknown" });
    expect(none).toMatchObject({ matches: [], truncated: false, space: null, label: "unknown" });
    expect(documents.grep).toHaveBeenCalledTimes(2);
  });

  it("keeps fifty lines and says when there were more", async () => {
    const many = Array.from({ length: 51 }, (_, at) => hit(SPEC_PATH, 1 + (at % 13)));
    expect((await setup({ grep: { matches: many.slice(0, 50), truncated: false } }).brain.grep("shop", { text: "fee", ignoreCase: true })).truncated).toBe(false);
    const over = await setup({ grep: { matches: many, truncated: false } }).brain.grep("shop", { text: "fee", ignoreCase: true });
    expect(over.matches).toHaveLength(50);
    expect(over.truncated).toBe(true);
    expect((await setup({ grep: { matches: many.slice(0, 2), truncated: true } }).brain.grep("shop", { text: "fee", ignoreCase: true })).truncated).toBe(true);
  });

  it("shows a long line around the first word, on one line", async () => {
    const long = `${"x".repeat(100)}\tlate fee${"y".repeat(300)}`;
    const exact = "z ".repeat(120).trim();
    const lines = [long, `  ${exact.replace("z z", "z \t z")}  `, `${"q".repeat(300)} LATE`, `late ${"y".repeat(300)}`];
    const { brain } = setup({ grep: { matches: lines.map((text) => hit(SPEC_PATH, 3, text)), truncated: false } });
    const [around, whole, end, start] = (await brain.grep("shop", { text: "late", ignoreCase: true })).matches;
    // Sixty characters before the word (where it starts at 101), 240 in all.
    expect(around?.excerpt).toBe(`…${"x".repeat(59)} late fee${"y".repeat(172)}…`);
    expect(whole?.excerpt).toBe(exact);
    expect(end?.excerpt).toBe(`…${"q".repeat(235)} LATE`);
    expect(start?.excerpt).toBe(`late ${"y".repeat(235)}…`);
  });
});

describe("BrainService.changes", () => {
  const changed = (overrides: Partial<DiffFile>): DiffFile => ({ path: SPEC_PATH, previousPath: null, status: "modified", added: 1, removed: 0, hunks: [{ start: 9, end: 9 }], ...overrides });
  const diffOf = (files: DiffFile[], linesKnown = true): DocumentDiff => ({ from: "f".repeat(40), files, linesKnown });

  it("names the sections and cards whose lines changed, from the commit Git resolved", async () => {
    const { brain, documents } = setup({ diff: diffOf([changed({ hunks: [{ start: 3, end: 3 }, { start: 9, end: 9 }] })]) });
    const view = await brain.changes("shop", { since: " abc1234 " });
    expect(documents.diff).toHaveBeenCalledWith(expect.anything(), "abc1234", COMMIT, undefined);
    expect(view).toMatchObject({ projectId: "shop", branch: "main", commit: COMMIT, since: "f".repeat(40), linesKnown: true, truncated: false });
    expect(view.files).toEqual([
      expect.objectContaining({ path: SPEC_PATH, status: "modified", previousPath: null, added: 1, removed: 0 }),
    ]);
    expect(view.files[0]?.nodes.map((node) => node.id)).toEqual([SPEC_PATH, `${SPEC_PATH}#RULE-INV01-0001`]);
  });

  it("names the document when the lines are unknown or fall outside its nodes, and nothing for a deleted one", async () => {
    const { brain } = setup({
      diff: diffOf([changed({ hunks: [{ start: 50, end: 60 }] }), changed({ path: "gone.md", status: "deleted", hunks: [] }), changed({ path: "missing.md", hunks: [] })]),
    });
    const view = await brain.changes("shop", { since: "abc1234" });
    expect(view.files.map((file) => [file.path, file.nodes.map((node) => node.id)])).toEqual([
      [SPEC_PATH, [SPEC_PATH]],
      ["gone.md", []],
      ["missing.md", []],
    ]);
    const unknown = await setup({ diff: diffOf([changed({ hunks: [] })], false) }).brain.changes("shop", { since: "abc1234" });
    expect(unknown).toMatchObject({ linesKnown: false });
    expect(unknown.files[0]?.nodes.map((node) => node.id)).toEqual([SPEC_PATH]);
  });

  it("keeps a section's own changes only, unless the lines are unknown", async () => {
    const files = [changed({ hunks: [{ start: 1, end: 4 }] }), changed({ path: "a.md", hunks: [{ start: 11, end: 12 }] }), changed({ path: "b.md", hunks: [{ start: 2, end: 5 }] }), changed({ path: "c.md", hunks: [{ start: 10, end: 10 }] })];
    const { brain, documents } = setup({ diff: diffOf(files) });
    const view = await brain.changes("shop", { since: "abc1234", under: `${SPEC_PATH}#business-rules` });
    expect(documents.diff).toHaveBeenCalledWith(expect.anything(), "abc1234", COMMIT, SPEC_PATH);
    expect(view.files.map((file) => file.path)).toEqual(["b.md", "c.md"]);
    const unknown = await setup({ diff: diffOf(files.map((file) => ({ ...file, hunks: [] })), false) }).brain.changes("shop", { since: "abc1234", under: `${SPEC_PATH}#business-rules` });
    expect(unknown.files).toHaveLength(4);
    const folder = setup({ diff: diffOf(files) });
    expect((await folder.brain.changes("shop", { since: "abc1234", under: "01-standards/" })).files).toHaveLength(4);
    expect(folder.documents.diff).toHaveBeenCalledWith(expect.anything(), "abc1234", COMMIT, "01-standards");
    const root = setup({ diff: diffOf(files) });
    await root.brain.changes("shop", { since: "abc1234", under: "/" });
    expect(root.documents.diff).toHaveBeenCalledWith(expect.anything(), "abc1234", COMMIT, undefined);
  });

  it("calls a document moved out of the Brain deleted, and one moved in added with its document", async () => {
    const view = await setup({
      diff: diffOf([changed({ path: "plugins/demo/old.md", previousPath: "notes/old.md", status: "renamed" }), changed({ previousPath: "scratch/spec.md", status: "renamed" })]),
    }).brain.changes("shop", { since: "abc1234" });
    expect(view.files.map((file) => [file.path, file.status, file.previousPath, file.nodes.map((node) => node.id)])).toEqual([
      ["notes/old.md", "deleted", null, []],
      [SPEC_PATH, "added", null, [SPEC_PATH]],
    ]);
  });

  it("leaves out what the Brain does not index, and lists a hundred documents at most", async () => {
    const many = Array.from({ length: 101 }, (_, at) => changed({ path: `notes/${at}.md`, hunks: [] }));
    const view = await setup({ diff: diffOf([changed({ path: "plugins/demo/README.md" }), ...many]) }).brain.changes("shop", { since: "abc1234" });
    expect(view.files).toHaveLength(100);
    expect(view.files[0]?.path).toBe("notes/0.md");
    expect(view.truncated).toBe(true);
    const exact = await setup({ diff: diffOf(many.slice(0, 100)) }).brain.changes("shop", { since: "abc1234" });
    expect(exact.truncated).toBe(false);
  });

  it("names thirty nodes per document at most, and says when the commit is unknown", async () => {
    const { brain, index } = setup({ diff: diffOf([changed({ hunks: [{ start: 1, end: 13 }] })]) });
    const ranges = vi.spyOn(index, "nodesInRanges");
    await brain.changes("shop", { since: "abc1234" });
    expect(ranges).toHaveBeenCalledWith("shop", SPEC_PATH, [{ start: 1, end: 13 }], 30);
    await expect(setup({ diff: undefined }).brain.changes("shop", { since: "abc1234" })).rejects.toThrow(new NotFoundException("Commit abc1234 is not in the document repo mirror."));
  });
});
