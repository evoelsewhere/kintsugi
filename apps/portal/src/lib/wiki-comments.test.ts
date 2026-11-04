import { describe, expect, it } from "vitest";
import { checkSelection, COMMENT_BODY_MAX, type CommentView, commentProblem, findQuote, plainSelection, QUOTE_MAX, threadsOf } from "./wiki-comments";

const comment = (id: string, over: Partial<CommentView> = {}): CommentView => ({
  id,
  parentId: null,
  author: { id: "u1", username: "kim", displayName: "Kim" },
  body: `body of ${id}`,
  createdAt: `2026-11-05T03:00:0${id.length > 1 ? id.slice(-1) : id}Z`,
  editedAt: null,
  resolved: false,
  deleted: false,
  node: null,
  status: "anchored",
  line: null,
  quote: null,
  ...over,
});

describe("what may be sent as a comment", () => {
  it("needs some text, at most 8,000 characters", () => {
    expect(commentProblem("")).toMatch(/Write something/);
    expect(commentProblem("  \n ")).toMatch(/Write something/);
    expect(commentProblem("Looks right")).toBeUndefined();
    expect(commentProblem("x".repeat(COMMENT_BODY_MAX))).toBeUndefined();
    expect(commentProblem("x".repeat(COMMENT_BODY_MAX + 1))).toMatch(/8,000/);
  });
});

describe("the threads of a page", () => {
  it("lists the comments in time order with the answers under their parent, also when they arrive out of order", () => {
    const list = threadsOf([comment("3", { parentId: "1" }), comment("2"), comment("1"), comment("4", { parentId: "1" })]);
    expect(list.threads.map((thread) => [thread.comment.id, thread.replies.map((reply) => reply.id)])).toEqual([
      ["1", ["3", "4"]],
      ["2", []],
    ]);
    expect(list.orphaned).toEqual([]);
  });

  it("puts the comments whose passage is gone under Orphaned, with the rest of the thread", () => {
    const list = threadsOf([comment("1"), comment("2", { node: "install", quote: "run the installer", status: "orphaned" }), comment("3", { parentId: "2" }), comment("4", { node: "install", quote: "moved text", status: "moved", line: 12 })]);
    expect(list.threads.map((thread) => thread.comment.id)).toEqual(["1", "4"]);
    expect(list.orphaned.map((thread) => [thread.comment.id, thread.comment.quote, thread.replies.map((reply) => reply.id)])).toEqual([["2", "run the installer", ["3"]]]);
  });

  it("counts the threads that are not resolved, a resolved or deleted one not", () => {
    const list = threadsOf([comment("1"), comment("2", { resolved: true }), comment("3", { deleted: true, body: "" }), comment("4", { status: "orphaned" })]);
    expect(list.open).toBe(2);
  });

  it("keeps a deleted comment only while it has answers to hold on to, and never shows a deleted answer", () => {
    const list = threadsOf([comment("1", { deleted: true, body: "" }), comment("2", { parentId: "1" }), comment("3", { deleted: true, body: "" }), comment("4", { parentId: "2", deleted: true })]);
    expect(list.threads.map((thread) => thread.comment.id)).toEqual(["1"]);
    expect(list.threads[0]?.replies.map((reply) => reply.id)).toEqual(["2"]);
  });

  it("shows an answer whose parent is not in the list as a comment of its own, and nothing for no comments", () => {
    expect(threadsOf([comment("2", { parentId: "99" })]).threads.map((thread) => thread.comment.id)).toEqual(["2"]);
    expect(threadsOf([])).toEqual({ threads: [], orphaned: [], open: 0 });
  });
});

describe("a selection of the rendered page", () => {
  it("collapses white space the way the anchor does", () => {
    expect(plainSelection("  run   the\n installer \t now ")).toBe("run the installer now");
  });

  it("is accepted inside one block, with some text, up to 500 characters", () => {
    expect(checkSelection("run the installer", 1)).toEqual({ ok: true, exact: "run the installer" });
    expect(checkSelection("   ", 1)).toMatchObject({ ok: false });
    expect(checkSelection("two\n paragraphs", 2)).toMatchObject({ ok: false, reason: expect.stringMatching(/one paragraph/) });
    expect(checkSelection("nothing selected", 0)).toMatchObject({ ok: false });
    expect(checkSelection("x".repeat(QUOTE_MAX), 1)).toMatchObject({ ok: true });
    expect(checkSelection("x".repeat(QUOTE_MAX + 1), 1)).toMatchObject({ ok: false, reason: expect.stringMatching(/501/) });
  });

  it("finds the passage in the text of a block, whatever the white space is", () => {
    const block = "Run  the\ninstaller, then restart the service.";
    const found = findQuote(block, "Run the installer, then");
    expect(found).not.toBeNull();
    expect(block.slice(found?.start, found?.end)).toBe("Run  the\ninstaller, then");
    expect(findQuote("a b c", "b c")).toEqual({ start: 2, end: 5 });
    expect(findQuote("  padded   text  ", "padded text")).toEqual({ start: 2, end: 15 });
  });

  it("finds nothing for a passage the block does not hold, or an empty one", () => {
    expect(findQuote("Run the installer", "restart")).toBeNull();
    expect(findQuote("Run the installer", "   ")).toBeNull();
    expect(findQuote("", "x")).toBeNull();
    // Words must come in order and with the same letters.
    expect(findQuote("Run the installer", "installer the")).toBeNull();
    expect(findQuote("Run the installer", "run the")).toBeNull();
  });

  it("takes the first place when the passage comes twice", () => {
    expect(findQuote("again and again", "again")).toEqual({ start: 0, end: 5 });
  });
});
