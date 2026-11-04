import type { BrainGrepView, BrainNode } from "@kintsugi/domain";
import { describe, expect, it } from "vitest";
import { type BrainSearchView, highlightWords, leftOutNote, outcomeHits, queryWords, type RankedHit, rankedHits, runSearch } from "./brain-search";
import { readWikiSearch, rankedCount, withDocuments, wikiSearchLink } from "./wiki";

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

const FAILOVER = "20-spaces/eng/runbooks/db-failover.md";
const LEAVE = "20-spaces/hr/leave-policy.md";
const crumbs = (path: string, title: string) => [
  { id: "/", kind: "root", title: "Root" },
  { id: "20-spaces/", kind: "folder", title: "Spaces" },
  { id: path.split("/").slice(0, -1).join("/") + "/", kind: "folder", title: path.split("/").at(-2) ?? "" },
  { id: path, kind: "document", title },
];
const doc = (path: string, title: string, over: Partial<BrainNode> = {}): BrainNode => node({ id: path, kind: "document", path, title, space: "ENG", ...over });
const hit = (over: Partial<RankedHit> & { node: BrainNode }): RankedHit => ({
  breadcrumb: crumbs(over.node.path, over.node.kind === "document" ? over.node.title : "Page"),
  summary: over.node.summary,
  line: null,
  citation: `${over.node.path}:1-5@abc`,
  rank: 0.5,
  ...over,
});
const view = (hits: RankedHit[], leftOut = { archived: 0, templates: 0 }): BrainSearchView => ({ commit: "abc", hits, leftOut });

describe("the ranked hits as the reader's results", () => {
  const failover = doc(FAILOVER, "Database failover", { summary: "Steps to fail the database over.", labels: ["runbook"] });
  const steps = node({ id: `${FAILOVER}#steps`, kind: "section", path: FAILOVER, anchor: "steps", title: "Steps", summary: "The steps." });

  it("keeps the order of the ranking, one entry a page, with its summary and the line that matched", () => {
    const hits = rankedHits([
      hit({ node: doc(LEAVE, "Leave policy", { space: "HR", summary: "How leave works." }), line: { number: 9, text: "You may carry over unused leave." } }),
      hit({ node: steps, breadcrumb: crumbs(FAILOVER, "Database failover"), line: { number: 14, text: "Promote the replica." } }),
      hit({ node: failover, line: { number: 3, text: "Fail the database over." } }),
    ]);
    expect(hits.map((entry) => entry.path)).toEqual([LEAVE, FAILOVER]);
    expect(hits[0]).toMatchObject({ title: "Leave policy", summary: "How leave works.", space: "HR", breadcrumb: ["Spaces", "hr"] });
    expect(hits[0]?.lines).toEqual([{ line: 9, excerpt: "You may carry over unused leave.", anchor: null, section: null }]);
    // The page that came second by its section is listed with both lines, the heading one linking to its heading; the page's own summary wins.
    expect(hits[1]?.summary).toBe("Steps to fail the database over.");
    expect(hits[1]?.lines.map((line) => [line.line, line.anchor, line.section])).toEqual([
      [14, "steps", "Steps"],
      [3, null, null],
    ]);
  });

  it("shows a hit without a line by its summary, and a section hit without a line by its heading", () => {
    const [only] = rankedHits([hit({ node: failover })]);
    expect(only?.lines).toEqual([]);
    expect(only?.summary).toBe("Steps to fail the database over.");
    const [section] = rankedHits([hit({ node: { ...steps, lineStart: 12 } })]);
    expect(section?.lines).toEqual([{ line: 12, excerpt: "Steps", anchor: "steps", section: null }]);
  });

  it("takes plain titles for the breadcrumb as well as crumbs, and shows a link's text, not its address", () => {
    const [entry] = rankedHits([hit({ node: failover, breadcrumb: ["Spaces", "eng"], line: { number: 2, text: "See [the guide](guide.md) first." } })]);
    expect(entry?.breadcrumb).toEqual(["Spaces", "eng"]);
    expect(entry?.lines[0]?.excerpt).toBe("See the guide first.");
  });

  it("leaves out archived pages and templates, unless the person asked for them; then each says what it is", () => {
    const old = doc("20-spaces/eng/old.md", "Old page", { status: "archived" });
    const form = doc("20-spaces/eng/form.md", "Form", { template: true });
    const all = [hit({ node: failover }), hit({ node: old }), hit({ node: form })];
    expect(rankedHits(all).map((entry) => entry.path)).toEqual([FAILOVER]);
    const included = rankedHits(all, { includeHidden: true });
    expect(included.map((entry) => entry.path)).toEqual([FAILOVER, old.path, form.path]);
    const known = new Map([old, form, failover].map((entry) => [entry.path, entry] as const));
    expect(withDocuments(included, known, { includeHidden: true }).map((entry) => entry.hidden)).toEqual([undefined, "archived", "template"]);
    expect(withDocuments(included, known).map((entry) => entry.path)).toEqual([FAILOVER]);
  });
});

describe("what was left out", () => {
  it("is said in words, and nothing when nothing was", () => {
    expect(leftOutNote({ archived: 0, templates: 0 })).toBe("");
    expect(leftOutNote({ archived: 1, templates: 0 })).toBe("1 archived page not shown");
    expect(leftOutNote({ archived: 3, templates: 1 })).toBe("3 archived pages and 1 template not shown");
    expect(leftOutNote({ archived: 0, templates: 2 })).toBe("2 templates not shown");
  });
});

describe("the search with its fallback", () => {
  const grepView = { matches: [], truncated: false } as unknown as BrainGrepView;
  const failing = (status: number) => Object.assign(new Error(`status ${status}`), { status });
  const grep = (): Promise<BrainGrepView> => Promise.resolve(grepView);

  it("gives the ranked answer when the route answers", async () => {
    const answer = view([hit({ node: doc(FAILOVER, "Database failover") })]);
    const outcome = await runSearch({ search: () => Promise.resolve(answer), grep: () => Promise.reject(new Error("must not be asked")) });
    expect(outcome).toEqual({ kind: "ranked", view: answer });
    expect(outcomeHits(outcome).map((entry) => entry.path)).toEqual([FAILOVER]);
  });

  it("asks the exact text search when the route is not there (404) or the Brain is not built (409), without an error", async () => {
    for (const status of [404, 409]) {
      const outcome = await runSearch({ search: () => Promise.reject(failing(status)), grep });
      expect(outcome).toEqual({ kind: "exact", view: grepView });
    }
  });

  it("does not hide any other failure: the API's message reaches the person", async () => {
    for (const status of [400, 403, 500]) await expect(runSearch({ search: () => Promise.reject(failing(status)), grep })).rejects.toThrow(`status ${status}`);
    await expect(runSearch({ search: () => Promise.reject(new TypeError("offline")), grep })).rejects.toThrow("offline");
    // A failing fallback is its own failure.
    await expect(runSearch({ search: () => Promise.reject(failing(404)), grep: () => Promise.reject(failing(500)) })).rejects.toThrow("status 500");
  });

  it("lists nothing for no outcome yet", () => {
    expect(outcomeHits(undefined)).toEqual([]);
    expect(outcomeHits(null)).toEqual([]);
  });
});

describe("the address of a ranked search", () => {
  it("is the same `?q&space&label` as the exact search and reads back", () => {
    const search = { q: "carry over unused leave", space: "HR", label: "policy" };
    const link = wikiSearchLink("shop", search);
    expect(link).toBe("/wiki?project=shop&q=carry+over+unused+leave&space=HR&label=policy");
    expect(readWikiSearch(new URLSearchParams(link.split("?")[1]))).toEqual(search);
  });

  it("counts its pages best first", () => {
    expect(rankedCount(1, "leave")).toBe("1 page matches “leave”, best match first");
    expect(rankedCount(4, "sick leave")).toBe("4 pages match “sick leave”, best match first");
  });
});

describe("the words of a query", () => {
  it("are each word once, case ignored, the longer ones first", () => {
    expect(queryWords("Database failover  steps, Database")).toEqual(["database", "failover", "steps"]);
    expect(queryWords("  ")).toEqual([]);
  });

  it("mark every word in a line, and nothing else, whatever characters the query holds", () => {
    expect(highlightWords("Fail the database over, then verify.", "database failover steps")).toEqual([
      { text: "Fail the ", match: false },
      { text: "database", match: true },
      { text: " over, then verify.", match: false },
    ]);
    expect(highlightWords("Nothing here.", "zebra")).toEqual([{ text: "Nothing here.", match: false }]);
    expect(highlightWords("a (b) c", "(b) .*")).toEqual([
      { text: "a (", match: false },
      { text: "b", match: true },
      { text: ") c", match: false },
    ]);
    expect(highlightWords("text", "")).toEqual([{ text: "text", match: false }]);
  });
});
