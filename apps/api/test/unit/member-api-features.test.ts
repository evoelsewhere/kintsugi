// The features header of the member API (P2-020): a client that does not name page-attributes gets the version 1 shape
// an installed CLI parses with its strict schema (kept in fixtures/member-brain-v1-schemas.ts), and one that does gets
// the page attributes on every node of the five Brain responses.

import {
  brainBacklinksSchema,
  brainChangesSchema,
  brainGrepSchema,
  brainLookupSchema,
  brainReadSchema,
  brainTreeSchema,
  parseMemberFeatures,
} from "@kintsugi/harness-sdk";
import { describe, expect, it, vi } from "vitest";
import type { PluginAccessService } from "../../src/modules/admin/plugin-access/index.js";
import type { PluginsService } from "../../src/modules/admin/plugins/index.js";
import type { ProjectAccessService } from "../../src/modules/admin/project-access/index.js";
import type { BrainService } from "../../src/modules/delivery/brain/index.js";
import type { DocumentsService } from "../../src/modules/delivery/documents/index.js";
import { MemberApiService } from "../../src/modules/delivery/member-api/application/member-api.service.js";
import type { MemberActivityService } from "../../src/modules/monitoring/member-activity/index.js";
import * as v1 from "./fixtures/member-brain-v1-schemas.js";

const COMMIT = "c".repeat(40);
const ATTRIBUTES = ["labels", "status", "owner", "template", "space"];
const INTERNAL = ["parentId", "ordinal", "depth"];

const pageNode = (id: string, extra: Record<string, unknown> = {}) => ({
  id, parentId: "/", kind: "document", path: id, anchor: null, title: id, summary: "", summarySource: "none", ordinal: 0, depth: 1,
  lineStart: 1, lineEnd: 9, subtreeEnd: 9, tokens: 1, subtreeTokens: 1, children: 0, ids: [], changed: null,
  labels: ["runbook", "ops"], status: "current", owner: "lead", template: false, space: "ENG", ...extra,
});

/** A Brain whose every read returns nodes that carry attributes, so a field that is left out is left out on purpose. */
function memberWithBrain() {
  const page = pageNode("20-spaces/eng/a.md");
  const other = pageNode("20-spaces/eng/b.md", { labels: [], status: null, owner: null, space: null });
  const index = { projectId: "shop", branch: "main", commit: COMMIT };
  const crumbs = [{ id: "/", kind: "root", title: "Shop" }];
  const brain = {
    tree: vi.fn(async () => ({ ...index, node: pageNode("/", { kind: "root", path: "", parentId: null }), breadcrumb: [], children: [{ ...page, nodes: [other] }, other], total: 2, offset: 0 })),
    read: vi.fn(async () => ({
      ...index, node: page, breadcrumb: crumbs, scope: "node", text: "1\ta", lineNumbers: true, truncated: false, nextLine: null,
      citation: { nodeId: page.id, path: page.path, lineStart: 1, lineEnd: 9, commit: COMMIT },
      children: [other], outgoing: [{ ...other, linkKind: "link" }], incoming: [{ ...page, linkKind: "id" }], outgoingTotal: 1, incomingTotal: 1,
    })),
    lookup: vi.fn(async () => ({ ...index, query: "label:runbook", matches: [{ ...page, breadcrumb: crumbs }, { ...other, breadcrumb: crumbs }] })),
    grep: vi.fn(async () => ({ ...index, text: "tax", under: null, matches: [{ node: page, breadcrumb: crumbs, line: 3, excerpt: "tax" }], truncated: false })),
    // Twenty-five pages link to b.md, one of them to its heading: a window of them as the Brain's own read gives it.
    backlinks: vi.fn(async (_projectId: string, query: { node: string; offset: number; limit: number }) => {
      const target = pageNode(query.node, { path: query.node.split("#")[0] });
      const all = Array.from({ length: 25 }, (_, n) => ({ node: pageNode(`links/p${String(n).padStart(2, "0")}.md`, { lineStart: 4, lineEnd: 6 }), target, linkKind: n === 24 ? "id" : "link" }));
      const items = all.slice(query.offset, query.offset + query.limit);
      const end = query.offset + items.length;
      return { ...index, node: target, items, total: all.length, offset: query.offset, nextOffset: end < all.length ? end : null };
    }),
    changes: vi.fn(async () => ({
      ...index, since: "b".repeat(40), linesKnown: true, truncated: false,
      files: [{ path: page.path, status: "modified", previousPath: null, added: 1, removed: 0, nodes: [page] }],
    })),
  } as unknown as BrainService;
  const access = { listReadableProjects: vi.fn(async () => []) } as unknown as ProjectAccessService;
  const activity = { observe: vi.fn(async () => undefined) } as unknown as MemberActivityService;
  return new MemberApiService(access, {} as DocumentsService, {} as PluginsService, {} as PluginAccessService, activity, brain);
}

/** Every Brain node in a response, wherever it is: an object with an `id`, a `kind` and a `path`. */
function nodesIn(value: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) value.forEach((item) => nodesIn(item, found));
  else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.kind === "string" && "path" in record) found.push(record);
    Object.values(record).forEach((item) => nodesIn(item, found));
  }
  return found;
}

describe("the member API features header (P2-020)", () => {
  const none = parseMemberFeatures(undefined);
  const asked = parseMemberFeatures("page-attributes");
  const responses = (features: typeof none) => {
    const member = memberWithBrain();
    const query = { projectId: "shop" };
    return {
      tree: () => member.brainTree({ ...query, depth: 2 }, features),
      read: () => member.brainRead("u1", { ...query, node: "20-spaces/eng/a.md" }, features),
      lookup: () => member.brainLookup({ ...query, query: "label:runbook" }, features),
      grep: () => member.brainGrep({ ...query, text: "tax" }, features),
      changes: () => member.brainChanges({ ...query, since: "b".repeat(40) }, features),
    };
  };
  const OLD = { tree: v1.brainTreeSchema, read: v1.brainReadSchema, lookup: v1.brainLookupSchema, grep: v1.brainGrepSchema, changes: v1.brainChangesSchema } as const;
  const NEW = { tree: brainTreeSchema, read: brainReadSchema, lookup: brainLookupSchema, grep: brainGrepSchema, changes: brainChangesSchema } as const;
  const ENDPOINTS = ["tree", "read", "lookup", "grep", "changes"] as const;

  it.each(ENDPOINTS)("answers a client that did not ask exactly as before for brain_%s", async (name) => {
    const body = await responses(none)[name]();
    const nodes = nodesIn(body);
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) for (const field of [...ATTRIBUTES, ...INTERNAL]) expect(node, `${name}: ${String(node.id)}.${field}`).not.toHaveProperty(field);
    // The strict schema of an installed CLI, kept as it was, still accepts it; so does the current one.
    expect(OLD[name].safeParse(body).success, `${name} with the version 1 schema`).toBe(true);
    expect(NEW[name].safeParse(body).success, `${name} with the current schema`).toBe(true);
  });

  it.each(ENDPOINTS)("adds the page attributes to every node of brain_%s for a client that asked", async (name) => {
    const body = await responses(asked)[name]();
    const nodes = nodesIn(body);
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      for (const field of ATTRIBUTES) expect(node, `${name}: ${String(node.id)}.${field}`).toHaveProperty(field);
      for (const field of INTERNAL) expect(node, field).not.toHaveProperty(field);
    }
    expect(nodes.find((node) => node.id === "20-spaces/eng/a.md")).toMatchObject({ labels: ["runbook", "ops"], space: "ENG", status: "current", owner: "lead", template: false });
    expect(NEW[name].safeParse(body).success, `${name} with the current schema`).toBe(true);
    // A CLI of version 1 would refuse it: that is why the fields wait for the header.
    expect(OLD[name].safeParse(body).success).toBe(false);
  });

  it("reads the header in any case, ignores a name it does not know and never fails on it", () => {
    expect(parseMemberFeatures("Page-Attributes")).toEqual({ pageAttributes: true });
    expect(parseMemberFeatures(" future-thing , PAGE-ATTRIBUTES ")).toEqual({ pageAttributes: true });
    expect(parseMemberFeatures(["x", "page-attributes"])).toEqual({ pageAttributes: true });
    expect(parseMemberFeatures("future-thing")).toEqual({ pageAttributes: false });
    expect(parseMemberFeatures("page-attributes-2")).toEqual({ pageAttributes: false });
    expect(parseMemberFeatures("")).toEqual({ pageAttributes: false });
    // Longer than 200 characters, or the name after the tenth entry: not read.
    expect(parseMemberFeatures(`page-attributes,${"a".repeat(200)}`)).toEqual({ pageAttributes: false });
    expect(parseMemberFeatures(`${"a,".repeat(10)}page-attributes`)).toEqual({ pageAttributes: false });
    expect(parseMemberFeatures(`${"a,".repeat(9)}page-attributes`)).toEqual({ pageAttributes: true });
  });

  it("lets an agent find a page by label and cite it as path:lines@commit", async () => {
    const member = memberWithBrain();
    const found = await member.brainLookup({ projectId: "shop", query: "label:runbook" }, asked);
    const match = found.matches.find((node) => node.labels?.includes("runbook"));
    expect(match).toBeDefined();
    const read = await member.brainRead("u1", { projectId: "shop", node: match?.id ?? "" }, asked);
    expect(read.citation).toEqual({ nodeId: "20-spaces/eng/a.md", path: "20-spaces/eng/a.md", lineStart: 1, lineEnd: 9, commit: COMMIT });
    expect(read.commit).toBe(COMMIT);
  });
});

describe("backlinks on the member wire (P2-025)", () => {
  const none = parseMemberFeatures(undefined);
  const asked = parseMemberFeatures("page-attributes");

  it("returns the linking nodes, what they point at, the total and where the next window starts", async () => {
    const member = memberWithBrain();
    const first = await member.brainBacklinks({ projectId: "shop", node: "20-spaces/eng/b.md#setup", limit: 20 }, none);
    expect(first).toMatchObject({ total: 25, offset: 0, nextOffset: 20, commit: COMMIT });
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toMatchObject({ node: { path: "links/p00.md", lineStart: 4, lineEnd: 6 }, target: { id: "20-spaces/eng/b.md#setup" }, linkKind: "link" });
    const second = await member.brainBacklinks({ projectId: "shop", node: "20-spaces/eng/b.md#setup", limit: 20, offset: first.nextOffset ?? 0 }, none);
    expect(second).toMatchObject({ total: 25, offset: 20, nextOffset: null });
    expect(second.items).toHaveLength(5);
    expect(second.items.at(-1)?.linkKind).toBe("id");
    const paths = [...first.items, ...second.items].map((item) => item.node.path);
    expect(new Set(paths).size).toBe(25);
  });

  it("gives a client that did not ask the version 1 shape of every node, and one that asked the page attributes", async () => {
    const member = memberWithBrain();
    const query = { projectId: "shop", node: "20-spaces/eng/b.md" };
    const plain = await member.brainBacklinks(query, none);
    const nodes = nodesIn(plain);
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) for (const field of [...ATTRIBUTES, ...INTERNAL]) expect(node, `${String(node.id)}.${field}`).not.toHaveProperty(field);
    expect(brainBacklinksSchema.safeParse(plain).success).toBe(true);

    const withAttributes = await member.brainBacklinks(query, asked);
    for (const node of nodesIn(withAttributes)) {
      for (const field of ATTRIBUTES) expect(node, `${String(node.id)}.${field}`).toHaveProperty(field);
      for (const field of INTERNAL) expect(node, field).not.toHaveProperty(field);
    }
    expect(brainBacklinksSchema.safeParse(withAttributes).success).toBe(true);
  });

  it("is a new read: the five that older CLIs call are unchanged by it", async () => {
    const member = memberWithBrain();
    for (const body of [await member.brainTree({ projectId: "shop", depth: 2 }, none), await member.brainLookup({ projectId: "shop", query: "label:runbook" }, none)]) {
      for (const node of nodesIn(body)) expect(node).not.toHaveProperty("labels");
    }
  });
});
