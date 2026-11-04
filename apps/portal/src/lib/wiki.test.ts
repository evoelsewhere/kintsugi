import type { BrainGrepMatch, BrainNode } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import { resolveDocumentLink } from "./document-links";
import { attachmentUrl, hitCount, isFrontMatterLine, readableExcerpt, imageSource, comparePair, compareSummary, readPageMode, togglePicked, wikiPageLink, foldersAbove, headingIdOfHash, isAttachmentPath, wikiLinkAction, homeOf, isHiddenPage, isPagePath, nameOf, pageEntries, parentPath, pathOfSplat, pathTrail, treeRows, type TreeLevel, WIKI_NO_ACCESS, wikiLink, wikiRead, hitPaths, withDocuments, highlightParts, normalizeLabel, normalizeSpace, readWikiSearch, searchFacets, searchHits, searchLineLink, wikiSearchLink, labelledPages, wikiLabelLink, wikiPhase, hiddenPaths, groupBacklinks } from "./wiki";

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
  const status = { available: true, wiki: true, enabled: true, state: "ready", commit: "abc" };

  it("opens the pages only when the wiki is on and its Brain has a tree", () => {
    expect(wikiPhase(status)).toBe("ready");
    // A rebuild of a wiki that has a tree keeps the pages open.
    expect(wikiPhase({ ...status, state: "indexing" })).toBe("ready");
  });

  it("is off whenever the switch is off, even with the Brain on and built", () => {
    expect(wikiPhase({ ...status, wiki: false })).toBe("off");
    expect(wikiPhase({ ...status, wiki: false, enabled: false, state: "off", commit: null })).toBe("off");
  });

  it("says that the wiki is being built, or that the build failed, while it has no tree", () => {
    expect(wikiPhase({ ...status, state: "queued", commit: null })).toBe("building");
    expect(wikiPhase({ ...status, state: "indexing", commit: null })).toBe("building");
    expect(wikiPhase({ ...status, state: "not-built", commit: null })).toBe("building");
    expect(wikiPhase({ ...status, state: "failed", commit: null })).toBe("failed");
  });

  it("has nothing to read without a document repository, whatever the switch says", () => {
    expect(wikiPhase({ ...status, available: false })).toBe("unavailable");
    expect(wikiPhase({ ...status, available: false, wiki: false })).toBe("unavailable");
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

describe("following a link inside a page", () => {
  // The target is what resolveDocumentLink makes of the href, written in the page at `from`.
  const from = "20-spaces/ENG/guide/start.md";

  it("opens a Markdown page in the reader, with its heading", () => {
    expect(wikiLinkAction({ path: "20-spaces/ENG/ops/page.md", anchor: "install" })).toEqual({ kind: "page", path: "20-spaces/ENG/ops/page.md", anchor: "install" });
    expect(wikiLinkAction({ path: from })).toEqual({ kind: "page", path: from });
    expect(wikiLinkAction({ path: from, anchor: "" })).toEqual({ kind: "page", path: from });
  });

  it("resolves a relative link against the page's folder and lands on the reader's address", () => {
    const target = resolveDocumentLink("../ops/page.md#install", from);
    expect(target.kind).toBe("document");
    if (target.kind !== "document") return;
    const action = wikiLinkAction(target);
    expect(action).toEqual({ kind: "page", path: "20-spaces/ENG/ops/page.md", anchor: "install" });
    if (action.kind !== "page") return;
    expect(wikiLink("p", action.path, action.anchor)).toBe("/wiki/20-spaces/ENG/ops/page.md?project=p#install");
  });

  it("keeps a heading link of the same page on that page", () => {
    const target = resolveDocumentLink("#set-up", from);
    expect(target.kind === "document" && wikiLinkAction(target)).toEqual({ kind: "page", path: from, anchor: "set-up" });
  });

  it("leaves a link to the web alone and never follows a link that leaves the repository", () => {
    expect(resolveDocumentLink("https://example.com/a.md", from).kind).toBe("external");
    expect(resolveDocumentLink("../../../../x.md", from).kind).toBe("blocked");
    expect(resolveDocumentLink("javascript:alert(1)", from).kind).toBe("blocked");
  });

  it("sends a file of an _attachments folder through the attachment route", () => {
    expect(isAttachmentPath("20-spaces/ENG/_attachments/diagram.png")).toBe(true);
    expect(isAttachmentPath("_attachments/spec.pdf")).toBe(true);
    expect(isAttachmentPath("20-spaces/ENG/diagram.png")).toBe(false);
    expect(isAttachmentPath("20-spaces/ENG/_attachments/notes.md")).toBe(false);
    const target = resolveDocumentLink("../_attachments/spec v2.pdf", "20-spaces/ENG/guide/start.md");
    expect(target.kind === "document" && wikiLinkAction(target)).toEqual({ kind: "attachment", path: "20-spaces/ENG/_attachments/spec v2.pdf" });
    expect(attachmentUrl("a b", "20-spaces/ENG/_attachments/spec v2.pdf", "abc123")).toBe("/api/projects/a%20b/documents/attachment?ref=abc123&path=20-spaces%2FENG%2F_attachments%2Fspec+v2.pdf");
  });

  it("treats any other file as something for the document drawer", () => {
    expect(wikiLinkAction({ path: "20-spaces/ENG/src/app.ts" })).toEqual({ kind: "other", path: "20-spaces/ENG/src/app.ts" });
  });

  it("reads the heading id out of the address fragment", () => {
    expect(headingIdOfHash("#install")).toBe("install");
    expect(headingIdOfHash("#d%C3%A9ploiement")).toBe("déploiement");
    expect(headingIdOfHash("")).toBe("");
    expect(headingIdOfHash("#100%")).toBe("100%");
  });
});

describe("the versions of a page", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const c = "c".repeat(40);

  it("reads what an address asks of a page, and takes anything that is not a commit id for the current page", () => {
    expect(readPageMode(new URLSearchParams("project=p"))).toEqual({ mode: "page" });
    expect(readPageMode(new URLSearchParams("view=history"))).toEqual({ mode: "history" });
    expect(readPageMode(new URLSearchParams(`version=${a.toUpperCase()}`))).toEqual({ mode: "version", sha: a });
    expect(readPageMode(new URLSearchParams(`view=compare&from=${a}&to=${b}`))).toEqual({ mode: "compare", from: a, to: b });
    expect(readPageMode(new URLSearchParams("version=main"))).toEqual({ mode: "page" });
    expect(readPageMode(new URLSearchParams(`view=compare&from=${a}`))).toEqual({ mode: "page" });
    expect(readPageMode(new URLSearchParams(`view=compare&from=x&to=${b}`))).toEqual({ mode: "page" });
  });

  it("writes the address of each mode so that it reads back the same", () => {
    for (const mode of [{ mode: "page" }, { mode: "history" }, { mode: "version", sha: a }, { mode: "compare", from: a, to: b }] as const) {
      const link = wikiPageLink("p q", "guide/my page.md", mode);
      expect(link.startsWith("/wiki/guide/my%20page.md?project=p+q")).toBe(true);
      expect(readPageMode(new URLSearchParams(link.split("?")[1]))).toEqual(mode);
    }
  });

  it("puts the older version first, whichever was picked first, in a list that is newest first", () => {
    const list = [a, b, c]; // a is the newest
    expect(comparePair(list, a, c)).toEqual({ from: c, to: a });
    expect(comparePair(list, c, a)).toEqual({ from: c, to: a });
    expect(comparePair(list, b, a)).toEqual({ from: b, to: a });
    // A version of an older page that is not loaded yet is older than all those that are.
    expect(comparePair([a, b], "d".repeat(40), a)).toEqual({ from: "d".repeat(40), to: a });
  });

  it("keeps at most two versions picked, dropping the one picked longest ago, and unpicks on a second click", () => {
    expect(togglePicked([], a)).toEqual([a]);
    expect(togglePicked([a], b)).toEqual([a, b]);
    expect(togglePicked([a, b], c)).toEqual([b, c]);
    expect(togglePicked([a, b], a)).toEqual([b]);
  });

  it("says what a comparison changed, and says plainly when nothing did", () => {
    expect(compareSummary({ status: "unchanged", added: 0, removed: 0 })).toMatch(/No difference/);
    expect(compareSummary({ status: "modified", added: 3, removed: 1 })).toBe("3 lines added, 1 removed");
    expect(compareSummary({ status: "modified", added: 1, removed: 2 })).toBe("1 line added, 2 removed");
    expect(compareSummary({ status: "added", added: 5, removed: 0 })).toBe("The page was added: 5 lines");
    expect(compareSummary({ status: "deleted", added: 0, removed: 1 })).toBe("The page was deleted: 1 line");
  });
});

describe("the images of a page", () => {
  const from = "20-spaces/eng/runbooks/db-failover.md";

  it("serves an image of an _attachments folder through the attachment route, resolved against the page", () => {
    expect(imageSource("../_attachments/diagram.png", from)).toEqual({ kind: "attachment", path: "20-spaces/eng/_attachments/diagram.png" });
    expect(imageSource("_attachments/a%20b.JPG", "readme.md")).toEqual({ kind: "attachment", path: "_attachments/a b.JPG" });
    for (const type of ["jpeg", "jpg", "gif", "webp"]) expect(imageSource(`../_attachments/x.${type}`, from).kind).toBe("attachment");
  });

  it("shows no image for a file outside an _attachments folder or of another type, not even a broken one", () => {
    expect(imageSource("../diagram.png", from)).toEqual({ kind: "none" });
    expect(imageSource("../_attachments/diagram.svg", from)).toEqual({ kind: "none" });
    expect(imageSource("../_attachments/spec.pdf", from)).toEqual({ kind: "none" });
    expect(imageSource("../_attachments/notes.md", from)).toEqual({ kind: "none" });
    expect(imageSource("../../../../../x.png", from)).toEqual({ kind: "none" });
    expect(imageSource("../../restricted/_attachments/x.png", "a/b/c.md")).toEqual({ kind: "none" });
  });

  it("never loads an image of the web: it is only a link", () => {
    expect(imageSource("https://example.com/pixel.png", from)).toEqual({ kind: "external", href: "https://example.com/pixel.png" });
    expect(imageSource("http://example.com/a.png", from).kind).toBe("external");
  });

  it("renders nothing for a data URL, any other scheme or an empty source", () => {
    expect(imageSource("data:image/png;base64,AAAA", from)).toEqual({ kind: "none" });
    expect(imageSource("javascript:alert(1)", from)).toEqual({ kind: "none" });
    expect(imageSource("file:///etc/passwd", from)).toEqual({ kind: "none" });
    expect(imageSource("//example.com/a.png", from)).toEqual({ kind: "none" });
    expect(imageSource("", from)).toEqual({ kind: "none" });
    expect(imageSource(undefined, from)).toEqual({ kind: "none" });
  });
});

describe("the search of the wiki", () => {
  it("is read back from the address: the text, one space in capitals and one label as the Brain writes it", () => {
    expect(readWikiSearch(new URLSearchParams("project=p&q=%20rollback%20&space=eng&label=Run-Book"))).toEqual({ q: "rollback", space: "ENG", label: "run-book" });
    expect(readWikiSearch(new URLSearchParams("project=p"))).toEqual({ q: "", space: "", label: "" });
    // Nothing that the API would refuse is sent: a space that is not a key, a label with nothing left.
    expect(readWikiSearch(new URLSearchParams("q=x&space=1&label=%21%21"))).toEqual({ q: "x", space: "", label: "" });
    expect(normalizeSpace(" ops ")).toBe("OPS");
    expect(normalizeLabel("On Call")).toBe("oncall");
  });

  it("builds the address of a search and reads the same search back", () => {
    const search = { q: "cache purge", space: "OPS", label: "runbook" };
    const link = wikiSearchLink("my project", search);
    expect(link).toBe("/wiki?project=my+project&q=cache+purge&space=OPS&label=runbook");
    expect(readWikiSearch(new URLSearchParams(link.split("?")[1]))).toEqual(search);
    expect(wikiSearchLink("p", { q: "x", space: "", label: "" })).toBe("/wiki?project=p&q=x");
  });

  const crumbs = [
    { id: "/", kind: "root", title: "Root" },
    { id: "20-spaces/", kind: "folder", title: "Spaces" },
    { id: "20-spaces/ops/", kind: "folder", title: "Operations" },
    { id: "20-spaces/ops/cache-purge.md", kind: "document", title: "Purging the cache" },
  ] as const;
  const match = (over: Partial<BrainGrepMatch> & { node: BrainNode }): BrainGrepMatch => ({ breadcrumb: [...crumbs], line: 1, excerpt: "x", ...over });
  const purge = page("20-spaces/ops/cache-purge.md", { title: "Purging the cache", space: "OPS", labels: ["runbook", "cache"] });
  const section = (anchor: string, title: string): BrainNode => node({ id: `${purge.path}#${anchor}`, kind: "section", path: purge.path, anchor, title, space: "OPS", labels: purge.labels });

  it("groups the matches by page, with the heading each line is under", () => {
    const hits = searchHits([
      match({ node: section("rollback", "Rollback"), line: 12, excerpt: "run the rollback now" }),
      match({ node: purge, line: 3, excerpt: "a rollback is" }),
      match({ node: section("rollback", "Rollback"), line: 14, excerpt: "rollback again" }),
      match({ node: page("20-spaces/hr/leave.md", { title: "Leave", space: "HR" }), breadcrumb: [], line: 2, excerpt: "rollback of leave" }),
    ]);
    expect(hits.map((hit) => [hit.path, hit.title, hit.lines.length])).toEqual([
      [purge.path, "Purging the cache", 3],
      ["20-spaces/hr/leave.md", "Leave", 1],
    ]);
    expect(hits[0]?.breadcrumb).toEqual(["Spaces", "Operations"]);
    expect(hits[0]?.lines.map((line) => [line.line, line.anchor, line.section])).toEqual([
      [12, "rollback", "Rollback"],
      [3, null, null],
      [14, "rollback", "Rollback"],
    ]);
  });

  it("opens a line at its heading and leaves out archived pages and templates", () => {
    const [hit] = searchHits([match({ node: section("rollback", "Rollback") })]);
    expect(hit && searchLineLink("p", hit, hit.lines[0] ?? { anchor: null })).toBe("/wiki/20-spaces/ops/cache-purge.md?project=p#rollback");
    expect(hit && searchLineLink("p", hit, { anchor: null })).toBe("/wiki/20-spaces/ops/cache-purge.md?project=p");
    expect(searchHits([match({ node: page("old.md", { status: "archived" }) }), match({ node: page("t.md", { template: true }) })])).toEqual([]);
  });

  it("takes a page's space and labels from its document, as a match is the section whose node holds none", () => {
    // What the Brain builds: only the document node has the attributes, its sections have none (labels [], space null).
    const bare = node({ id: `${purge.path}#rollback`, kind: "section", path: purge.path, anchor: "rollback", title: "Rollback" });
    const hits = searchHits([match({ node: bare, line: 12 })]);
    expect(hits[0]?.space).toBeNull();
    expect(hits[0]?.labels).toEqual([]);
    expect(searchFacets(hits)).toEqual({ spaces: [], labels: [] });
    const resolved = withDocuments(hits, new Map([[purge.path, purge]]));
    expect(resolved[0]).toMatchObject({ title: "Purging the cache", space: "OPS", labels: ["runbook", "cache"] });
    expect(searchFacets(resolved)).toEqual({ spaces: ["OPS"], labels: ["cache", "runbook"] });
    // A page that is archived or a template once its document is known is not a result; one not looked up stays.
    expect(withDocuments(hits, new Map([[purge.path, { ...purge, status: "archived" }]]))).toEqual([]);
    expect(withDocuments(hits, new Map([[purge.path, { ...purge, template: true }]]))).toEqual([]);
    expect(withDocuments(hits, new Map())).toEqual(hits);
  });

  it("looks up at most thirty pages, each once, in the order of the results", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({ path: `p${index}.md` }));
    expect(hitPaths(many)).toHaveLength(30);
    expect(hitPaths(many)[0]).toBe("p0.md");
    expect(hitPaths([{ path: "a.md" }, { path: "b.md" }, { path: "a.md" }])).toEqual(["a.md", "b.md"]);
  });

  it("offers the spaces and labels of the hits as filters, each once", () => {
    const hits = searchHits([match({ node: purge }), match({ node: page("20-spaces/hr/leave.md", { space: "hr", labels: ["policy", "cache"] }), breadcrumb: [] })]);
    expect(searchFacets(hits)).toEqual({ spaces: ["HR", "OPS"], labels: ["cache", "policy", "runbook"] });
  });

  it("cuts an excerpt into the parts to mark, whatever the case, and never loses a character", () => {
    expect(highlightParts("Run the Rollback, then rollback", "rollback")).toEqual([
      { text: "Run the ", match: false },
      { text: "Rollback", match: true },
      { text: ", then ", match: false },
      { text: "rollback", match: true },
    ]);
    expect(highlightParts("nothing here", "zzz")).toEqual([{ text: "nothing here", match: false }]);
    expect(highlightParts("abc", "")).toEqual([{ text: "abc", match: false }]);
    expect(highlightParts("<b>x</b>", "x").map((part) => part.text).join("")).toBe("<b>x</b>");
  });
});

describe("the excerpts of a search", () => {
  const doc = page("20-spaces/eng/runbooks/db-failover.md", { title: "Database failover" });
  const failoverCrumbs = [
    { id: "/", kind: "root", title: "Root" },
    { id: "20-spaces/eng/runbooks/db-failover.md", kind: "document", title: "Database failover" },
  ] as const;
  const found = (over: Partial<BrainGrepMatch>): BrainGrepMatch => ({ node: doc, breadcrumb: [...failoverCrumbs], line: 2, excerpt: "title: Database failover", ...over });

  it("recognises the lines of a page's front matter, only when they belong to the page itself", () => {
    for (const line of ["---", "title: Database failover", "labels: [runbook, sev1]", "- runbook", "  - nested", "id: PAGE-ENG-0013"]) expect(isFrontMatterLine("document", line)).toBe(true);
    // Text under a heading is a section's: never taken for front matter, whatever its shape.
    expect(isFrontMatterLine("section", "title: Database failover")).toBe(false);
    expect(isFrontMatterLine("card", "- a list item")).toBe(false);
    for (const line of ["# Database failover", "Writes fail with the primary down.", "Writes: fail"]) expect(isFrontMatterLine("document", line)).toBe(line === "Writes: fail");
    // A line before the first heading that looks like `key: value` is taken for front matter: the shape is all the search knows.
  });

  it("drops the front matter lines of a hit but keeps the page, and keeps what the text says elsewhere", () => {
    const [onlyMeta] = searchHits([found({})]);
    expect(onlyMeta?.title).toBe("Database failover");
    expect(onlyMeta?.lines).toEqual([]);
    const [both] = searchHits([found({}), found({ node: { ...doc, kind: "section", anchor: "symptoms", title: "Symptoms" }, line: 8, excerpt: "Failover is triggered by hand" })]);
    expect(both?.lines.map((line) => line.line)).toEqual([8]);
  });

  it("shows a link or an image of an excerpt as its text only", () => {
    expect(readableExcerpt("See [database failover](../eng/runbooks/db-failover.md) first")).toBe("See database failover first");
    expect(readableExcerpt("![Failover diagram](../_attachments/f.png) and [a](b) [c](d)")).toBe("Failover diagram and a c");
    expect(readableExcerpt("no link here, a [bracket] and (paren)")).toBe("no link here, a [bracket] and (paren)");
    const [hit] = searchHits([found({ node: { ...doc, kind: "section", anchor: "x", title: "X" }, line: 9, excerpt: "[database failover](../db-failover.md)" })]);
    expect(hit?.lines[0]?.excerpt).toBe("database failover");
  });

  it("counts one page in the singular", () => {
    expect(hitCount(1, "failover")).toBe("1 page contains “failover”");
    expect(hitCount(2, "failover")).toBe("2 pages contain “failover”");
    expect(hitCount(0, "x")).toBe("0 pages contain “x”");
  });
});

describe("the page of a label", () => {
  it("has an address of its own that cannot be the path of a page, and encodes the label", () => {
    expect(wikiLabelLink("billing", "run-book")).toBe("/wiki/-/label/run-book?project=billing");
    expect(wikiLabelLink("a b", "x/y")).toBe("/wiki/-/label/x%2Fy?project=a%20b");
  });

  it("lists the pages that carry the label by title, with their folders, space and status", () => {
    const crumbs = [
      { id: "/", kind: "root", title: "Root" },
      { id: "20-spaces/", kind: "folder", title: "Spaces" },
      { id: "20-spaces/ops/", kind: "folder", title: "Operations" },
    ] as const;
    const withCrumbs = (n: BrainNode): BrainNode & { breadcrumb: typeof crumbs } => ({ ...n, breadcrumb: crumbs });
    const found = [
      withCrumbs(page("20-spaces/ops/on-call.md", { title: "On call", space: "OPS", status: "approved", labels: ["runbook"] })),
      withCrumbs(page("20-spaces/ops/cache.md", { title: "Cache purge", space: "OPS", labels: ["runbook", "cache"] })),
      withCrumbs(page("20-spaces/ops/old.md", { title: "Old", status: "archived", labels: ["runbook"] })),
      withCrumbs(page("20-spaces/ops/new-page.md", { title: "Template", template: true, labels: ["runbook"] })),
      withCrumbs(node({ id: "20-spaces/ops/cache.md#steps", kind: "section", path: "20-spaces/ops/cache.md", title: "Steps" })),
    ];
    expect(labelledPages(found)).toEqual([
      { path: "20-spaces/ops/cache.md", title: "Cache purge", breadcrumb: ["Spaces", "Operations"], space: "OPS", status: null, labels: ["runbook", "cache"] },
      { path: "20-spaces/ops/on-call.md", title: "On call", breadcrumb: ["Spaces", "Operations"], space: "OPS", status: "approved", labels: ["runbook"] },
    ]);
    expect(labelledPages([])).toEqual([]);
  });
});

describe("the backlinks of a page", () => {
  const link = (path: string, over: Partial<BrainNode>, targetKind: "document" | "section" = "document", targetTitle = "Target"): { node: BrainNode; target: BrainNode } => ({
    node: node({ id: `${path}#x`, kind: "section", path, anchor: "x", title: "Steps", ...over }),
    target: node({ id: "t.md", kind: targetKind, path: "t.md", title: targetTitle }),
  });

  it("lists each linking page once with all its links, in the order of the API", () => {
    const pages = groupBacklinks([link("a/one.md", { anchor: "steps", title: "Steps" }), link("a/one.md", { anchor: "recovery", title: "Recovery" }, "section", "Install"), link("b/two.md", { kind: "document", anchor: null, title: "Two" })], new Map([["a/one.md", "Page One"]]));
    expect(pages).toEqual([
      {
        path: "a/one.md",
        title: "Page One",
        links: [
          { anchor: "steps", section: "Steps", target: null },
          { anchor: "recovery", section: "Recovery", target: "Install" },
        ],
      },
      { path: "b/two.md", title: "two", links: [{ anchor: null, section: null, target: null }] },
    ]);
  });

  it("leaves out the pages that are archived or templates, the other links of a page staying", () => {
    const items = [link("a/old.md", { title: "Old" }), link("b/live.md", { title: "Live" })];
    const documents = new Map([
      ["a/old.md", page("a/old.md", { status: "archived" })],
      ["b/live.md", page("b/live.md")],
      ["c/draft.md", page("c/draft.md", { template: true })],
    ]);
    expect(hiddenPaths(documents)).toEqual(new Set(["a/old.md", "c/draft.md"]));
    expect(groupBacklinks(items, new Map(), hiddenPaths(documents)).map((entry) => entry.path)).toEqual(["b/live.md"]);
  });

  it("is empty for no backlinks", () => {
    expect(groupBacklinks([], new Map())).toEqual([]);
  });
});
