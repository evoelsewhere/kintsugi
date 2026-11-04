import type { BrainNode } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import { foldersAbove, homeOf, isHiddenPage, isPagePath, nameOf, pageEntries, parentPath, pathOfSplat, pathTrail, treeRows, type TreeLevel, WIKI_NO_ACCESS, wikiIsOff, wikiLink, wikiRead } from "./wiki";

const node = (over: Partial<BrainNode> & Pick<BrainNode, "id" | "kind" | "path">): BrainNode => ({
  parentId: null,
  anchor: null,
  title: over.path.split("/").pop() ?? "",
  summary: "",
  summarySource: "none",
  ordinal: 0,
  depth: 1,
  lineStart: null,
  lineEnd: null,
  subtreeEnd: null,
  tokens: 0,
  subtreeTokens: 0,
  children: 0,
  ids: [],
  labels: [],
  status: null,
  owner: null,
  template: false,
  space: null,
  changed: null,
  ...over,
});

const page = (path: string, over: Partial<BrainNode> = {}): BrainNode => node({ id: path, kind: "document", path, ...over });
const folder = (path: string, over: Partial<BrainNode> = {}): BrainNode => node({ id: `${path}/`, kind: "folder", path, children: 2, ...over });

describe("the address of a page", () => {
  it("holds the repository path after /wiki and the project in the query", () => {
    expect(wikiLink("billing", "20-spaces/ENG/guide/install.md")).toBe("/wiki/20-spaces/ENG/guide/install.md?project=billing");
    expect(wikiLink("billing", "")).toBe("/wiki?project=billing");
  });

  it("encodes names and puts the heading after the query", () => {
    expect(wikiLink("a b", "notes/my page #1.md", "set up")).toBe("/wiki/notes/my%20page%20%231.md?project=a%20b#set%20up");
  });

  it("reads the path back from the router's splat, whatever the encoding", () => {
    expect(pathOfSplat("notes/my page #1.md")).toBe("notes/my page #1.md");
    expect(pathOfSplat("notes/my%20page.md")).toBe("notes/my page.md");
    expect(pathOfSplat("/a//b/./c.md/")).toBe("a/b/c.md");
    expect(pathOfSplat(undefined)).toBe("");
    expect(pathOfSplat("100%/x.md")).toBe("100%/x.md");
  });

  it("round-trips: the link of a path opens the same path", () => {
    for (const path of ["a.md", "a/b/c d.md", "20-spaces/ENG/é/x.md", "x#y/z.md"]) {
      const splat = wikiLink("p", path).slice("/wiki/".length).split("?")[0];
      expect(pathOfSplat(splat)).toBe(path);
    }
  });

  it("tells a page from a folder and names both", () => {
    expect(isPagePath("a/b.MD")).toBe(true);
    expect(isPagePath("a/b")).toBe(false);
    expect(nameOf("a/b/install.md")).toBe("install");
    expect(nameOf("a/b")).toBe("b");
    expect(parentPath("a/b/c.md")).toBe("a/b");
    expect(parentPath("c.md")).toBe("");
    expect(pathTrail("a/b/c.md")).toEqual([
      { label: "a", path: "a" },
      { label: "b", path: "a/b" },
      { label: "c.md", path: "a/b/c.md" },
    ]);
  });

  it("lists the folders to open above a page, or the folder itself", () => {
    expect(foldersAbove("a/b/c.md")).toEqual(["/", "a/", "a/b/"]);
    expect(foldersAbove("a/b")).toEqual(["/", "a/", "a/b/"]);
    expect(foldersAbove("")).toEqual(["/"]);
  });
});

describe("the wiki switch", () => {
  it("is off only when the project says so", () => {
    expect(wikiIsOff({ wiki: false })).toBe(true);
    expect(wikiIsOff({ wiki: true })).toBe(false);
    expect(wikiIsOff({})).toBe(false);
    expect(wikiIsOff(undefined)).toBe(false);
  });
});

describe("the page tree", () => {
  it("hides archived pages, templates, sections and cards, and keeps the Brain's order", () => {
    const children = [
      page("a/zebra.md", { ordinal: 2, title: "Zebra" }),
      page("a/old.md", { ordinal: 3, status: "archived" }),
      folder("a/sub", { ordinal: 1 }),
      page("a/new-page.md", { ordinal: 4, template: true }),
      node({ id: "a/zebra.md#intro", kind: "section", path: "a/zebra.md", ordinal: 0 }),
      page("a/README.md", { ordinal: 0, title: "Home" }),
    ];
    expect(pageEntries(children).map((entry) => entry.id)).toEqual(["a/README.md", "a/sub/", "a/zebra.md"]);
    expect(homeOf(pageEntries(children))?.title).toBe("Home");
  });

  it("hides a folder whose home page is archived", () => {
    expect(pageEntries([folder("old", { status: "archived" }), folder("live")]).map((entry) => entry.path)).toEqual(["live"]);
    expect(isHiddenPage(page("x.md", { template: true }))).toBe(true);
    expect(isHiddenPage(page("x.md", { status: "draft" }))).toBe(false);
  });

  it("lays the loaded levels out as rows, going deeper only through open folders", () => {
    const levels = new Map<string, TreeLevel>([
      ["/", { items: [folder("guide", { ordinal: 0 }), page("start.md", { ordinal: 1, title: "Start" })], total: 2, loading: false }],
      ["guide/", { items: [page("guide/install.md", { title: "Install" }), page("guide/draft.md", { status: "archived" })], total: 2, loading: false }],
    ]);
    expect(treeRows("/", levels, new Set()).map((row) => [row.node.id, row.depth, row.expandable, row.open])).toEqual([
      ["guide/", 0, true, false],
      ["start.md", 0, false, false],
    ]);
    expect(treeRows("/", levels, new Set(["guide/"])).map((row) => [row.node.id, row.depth, row.open])).toEqual([
      ["guide/", 0, true],
      ["guide/install.md", 1, false],
      ["start.md", 0, false],
    ]);
  });

  it("shows nothing for a level that is not loaded, and a page is never expandable", () => {
    const levels = new Map<string, TreeLevel>([["/", { items: [page("start.md", { children: 4 })], total: 1, loading: false }]]);
    expect(treeRows("/", levels, new Set(["start.md"]))[0]?.expandable).toBe(false);
    expect(treeRows("/", new Map(), new Set())).toEqual([]);
  });
});

describe("a refused read", () => {
  it("says the person has no access to the project, whatever the API words it", async () => {
    const refused = Object.assign(new Error("No grant"), { status: 403 });
    await expect(wikiRead(() => Promise.reject(refused))).rejects.toThrow(WIKI_NO_ACCESS);
    const missing = Object.assign(new Error("No such page"), { status: 404 });
    await expect(wikiRead(() => Promise.reject(missing))).rejects.toThrow("No such page");
    await expect(wikiRead(() => Promise.resolve(3))).resolves.toBe(3);
  });
});
