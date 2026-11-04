// Where an inline comment sits in a page (P3-001, ADR-0099 decisions 1 and 2): the text a reader sees, the anchor made of a
// selection of it, and finding it again when the page changed. The sections come from the Brain's own builder, so the
// line ranges are the real ones.

import { describe, expect, it } from "vitest";
import { buildBrainDocument } from "../src/brain.js";
import { type AnchorSection, type CommentAnchor, ANCHOR_CONTEXT_MAX, ANCHOR_EXACT_MAX, createAnchor, plainTextOf, reanchor } from "../src/comment-anchor.js";

const lines = (text: string): string[] => text.split("\n");
const sectionsOf = (text: string): AnchorSection[] =>
  buildBrainDocument("a.md", text).nodes.filter((node) => node.anchor !== null).map((node) => ({ anchor: node.anchor ?? "", lineStart: node.lineStart ?? 1, lineEnd: node.lineEnd ?? 1 }));
/** The selection of `quote` in the plain text of the page. */
const rangeOf = (text: string, quote: string): { start: number; end: number } => {
  const start = plainTextOf(lines(text)).indexOf(quote);
  if (start < 0) throw new Error(`no ${quote} in the plain text`);
  return { start, end: start + quote.length };
};
const anchorFor = (text: string, quote: string, node: string): CommentAnchor => createAnchor(text, rangeOf(text, quote), node);

describe("plainTextOf", () => {
  it("shows a link by its text and an image by its alt text", () => {
    expect(plainTextOf(["See [the guide](../guide.md#setup) and ![a diagram](_attachments/d.png) or <https://example.com/x>."])).toBe("See the guide and a diagram or https://example.com/x.");
    expect(plainTextOf(["[one][ref] and [two](<a b.md>)"])).toBe("one and two");
  });

  it("drops emphasis marks and back ticks but keeps what is not a mark", () => {
    expect(plainTextOf(["**Bold** and *italic* and __bold__ and _italic_ and ~~gone~~ and `code_here` and snake_case_name and 2 * 3"])).toBe("Bold and italic and bold and italic and gone and code_here and snake_case_name and 2 * 3");
    expect(plainTextOf(["Escaped \\*star\\* and a `` back`tick `` span"])).toBe("Escaped *star* and a back`tick span");
  });

  it("drops the table pipes and the separator row, one row per line", () => {
    expect(plainTextOf(["| Name | Role |", "| --- | :---: |", "| Ada | **Lead** |", "", "After."])).toBe("Name Role\nAda Lead\nAfter.");
  });

  it("drops list markers and quote marks, one item per line, and joins the lines of a paragraph", () => {
    expect(plainTextOf(["- first item", "  continued", "* second", "1. third", "10) fourth", "", "> quoted line", "> goes on", "", "Plain", "paragraph"])).toBe("first item continued\nsecond\nthird\nfourth\nquoted line goes on\nPlain paragraph");
  });

  it("drops the front matter, the heading marks, rules and comments, and makes every run of white space one space", () => {
    expect(plainTextOf(["---", "title: A", "---", "", "# Title  ", "", "Some   text\twith gaps.", "", "---", "<!-- hidden -->", "## Next ##"])).toBe("Title\nSome text with gaps.\nNext".replace(" ", " "));
  });

  it("shows the lines of a code block as written, one per line, without the fences", () => {
    expect(plainTextOf(["```ts", "const a  = 1;", "", "const b = [x](y);", "```", "After"])).toBe("const a = 1;\nconst b = [x](y);\nAfter");
  });

  it("is empty for an empty page, and reads CRLF lines like LF ones", () => {
    expect(plainTextOf([])).toBe("");
    expect(plainTextOf(["", "  "])).toBe("");
    expect(plainTextOf(["# T\r", "\r", "Body **text**\r"])).toBe("T\nBody text");
  });
});

describe("createAnchor", () => {
  const PAGE = "# Guide\n\nIntro text.\n\n## Setup\n\nInstall the **tool** with [this link](x.md) first.\n";

  it("keeps the quote and the plain text around it, not the source", () => {
    const anchor = anchorFor(PAGE, "Install the tool with this link first.", "setup");
    expect(anchor).toEqual({ node: "setup", exact: "Install the tool with this link first.", prefix: "Guide\nIntro text.\nSetup\n", suffix: "" });
  });

  it("cuts the quote at 500 characters and the context at 64, from the whole page", () => {
    const text = `# T\n\n${"a".repeat(100)} ${"b".repeat(700)} ${"c".repeat(100)}\n`;
    const plain = plainTextOf(lines(text));
    const start = plain.indexOf("b");
    const anchor = createAnchor(text, { start, end: start + 700 }, "t");
    expect(anchor.exact).toBe("b".repeat(ANCHOR_EXACT_MAX));
    expect(anchor.prefix).toHaveLength(ANCHOR_CONTEXT_MAX);
    expect(anchor.prefix.endsWith(" ")).toBe(true);
    expect(anchor.suffix).toBe("b".repeat(ANCHOR_CONTEXT_MAX));
  });

  it("is never inside a CRLF and holds the range inside the text", () => {
    const text = "# T\r\n\r\nOne line\r\nsecond line\r\n";
    const anchor = anchorFor(text, "One line second line", "t");
    expect(anchor.exact).toBe("One line second line");
    expect(`${anchor.prefix}${anchor.exact}${anchor.suffix}`).not.toMatch(/[\r]/);
    expect(createAnchor(text, { start: -5, end: 9999 }, "t").exact).toBe("T\nOne line second line");
    expect(createAnchor(text, { start: 7, end: 3 }, "t").exact).toBe("");
    expect(createAnchor("", { start: 0, end: 10 }, "t")).toEqual({ node: "t", exact: "", prefix: "", suffix: "" });
  });
});

describe("reanchor", () => {
  const PAGE = ["# Guide", "", "Intro text.", "", "## Setup", "", "Install the tool first.", "", "## Usage", "", "Run the tool daily.", ""].join("\n");
  const quote = "Install the tool first.";

  it("finds the quote in its section when the text around it was edited", () => {
    const anchor = anchorFor(PAGE, quote, "setup");
    const edited = PAGE.replace("Intro text.", "A much longer introduction that was written later.").replace("Run the tool daily.", "Run the tool every day, please.");
    const result = reanchor(edited, anchor, sectionsOf(edited));
    expect(result).toMatchObject({ status: "anchored", line: 7 });
    if (result.status === "orphaned") throw new Error("orphaned");
    expect(plainTextOf(lines(edited)).slice(result.start, result.end)).toBe(quote);
  });

  it("follows the quote when lines are added above it", () => {
    const anchor = anchorFor(PAGE, quote, "setup");
    const edited = `# Guide\n\nNew first paragraph.\n\nAnother one.\n\n${PAGE.slice(PAGE.indexOf("Intro text."))}`;
    expect(reanchor(edited, anchor, sectionsOf(edited))).toMatchObject({ status: "anchored", line: 11 });
  });

  it("is moved when the quote is under another heading now, and orphaned when it is gone", () => {
    const anchor = anchorFor(PAGE, quote, "setup");
    const moved = PAGE.replace("Install the tool first.\n", "").replace("Run the tool daily.", `Run the tool daily.\n\n${quote}`);
    expect(reanchor(moved, anchor, sectionsOf(moved))).toMatchObject({ status: "moved", line: 12 });
    const gone = PAGE.replace(quote, "Something else.");
    expect(reanchor(gone, anchor, sectionsOf(gone))).toEqual({ status: "orphaned" });
    // The section itself deleted: the quote is searched in the page.
    const withoutSection = PAGE.replace("## Setup\n\nInstall the tool first.\n\n", "");
    expect(reanchor(withoutSection, anchor, sectionsOf(withoutSection))).toEqual({ status: "orphaned" });
  });

  it("matches across markup: the quote was selected in the rendered page and the source has a link and bold text", () => {
    const text = "# T\n\n## Setup\n\nInstall the **tool** with [this link](x.md) first.\n";
    const anchor = anchorFor(text, "the tool with this link", "setup");
    expect(anchor.exact).toBe("the tool with this link");
    expect(reanchor(text.replace("Install", "Please install"), anchor, sectionsOf(text.replace("Install", "Please install")))).toMatchObject({ status: "anchored", line: 5 });
  });

  it("picks, among equal quotes, the one whose surroundings match the best, then the nearest to where it was", () => {
    const text = ["# T", "", "## One", "", "Alpha beta.", "", "see the note here.", "", "## Two", "", "Gamma delta.", "", "also the note here.", ""].join("\n");
    const anchor: CommentAnchor = { node: "", exact: "the note here.", prefix: "Gamma delta.\nalso ", suffix: "" };
    const result = reanchor(text, anchor, sectionsOf(text));
    expect(result).toMatchObject({ status: "anchored", line: 13 });
    // Equal context: the first, or the one nearest `near`.
    const same: CommentAnchor = { node: "", exact: "the note here.", prefix: "", suffix: "" };
    expect(reanchor(text, same, sectionsOf(text))).toMatchObject({ status: "anchored", line: 7 });
    expect(reanchor(text, same, sectionsOf(text), { near: plainTextOf(lines(text)).length })).toMatchObject({ status: "anchored", line: 13 });
    // Two equal quotes in one section: the one in the anchor's own section wins over the other section's.
    const inTwo = reanchor(text, { node: "two", exact: "the note here.", prefix: "", suffix: "" }, sectionsOf(text));
    expect(inTwo).toMatchObject({ status: "anchored", line: 13 });
  });

  it("reads CRLF like LF, and an empty page or an empty quote as orphaned", () => {
    const crlf = PAGE.replace(/\n/g, "\r\n");
    expect(reanchor(crlf, anchorFor(crlf, quote, "setup"), sectionsOf(crlf))).toMatchObject({ status: "anchored", line: 7 });
    expect(reanchor("", { node: "setup", exact: quote, prefix: "", suffix: "" }, [])).toEqual({ status: "orphaned" });
    expect(reanchor(PAGE, { node: "setup", exact: "", prefix: "", suffix: "" }, sectionsOf(PAGE))).toEqual({ status: "orphaned" });
    expect(reanchor(PAGE, { node: "setup", exact: "   ", prefix: "", suffix: "" }, sectionsOf(PAGE))).toEqual({ status: "orphaned" });
  });

  it("finds a quote at the very end of a page that has no final newline", () => {
    const text = "# T\n\n## End\n\nThe last words";
    const anchor = anchorFor(text, "The last words", "end");
    const result = reanchor(text, anchor, sectionsOf(text));
    expect(result).toMatchObject({ status: "anchored", line: 5 });
    if (result.status !== "orphaned") expect(result.end).toBeLessThanOrEqual(plainTextOf(lines(text)).length);
  });

  it("whitespace of the stored quote does not matter, and never throws for odd input", () => {
    const anchor: CommentAnchor = { node: "setup", exact: "Install   the\ttool  first.", prefix: "", suffix: "" };
    expect(reanchor(PAGE, anchor, sectionsOf(PAGE))).toMatchObject({ status: "anchored", line: 7 });
    expect(reanchor(PAGE, anchor, [{ anchor: "setup", lineStart: 999, lineEnd: -3 }])).toMatchObject({ status: "moved" });
    expect(reanchor(PAGE, { node: "x", exact: quote, prefix: undefined as unknown as string, suffix: null as unknown as string }, [])).toMatchObject({ status: "moved" });
  });

  it("never answers a place outside the text, in a seeded set of random edits", () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 200; round += 1) {
      const words = Array.from({ length: 5 + Math.floor(next() * 30) }, (_, n) => `w${Math.floor(next() * 12)}x${n % 3}`);
      const text = `# T\n\n## S\n\n${words.join(" ")}\n\n## U\n\n${words.slice().reverse().join(" ")}\n`;
      const plain = plainTextOf(lines(text));
      const start = Math.floor(next() * plain.length);
      const anchor = createAnchor(text, { start, end: Math.min(plain.length, start + 1 + Math.floor(next() * 40)) }, next() < 0.5 ? "s" : "u");
      const edited = text.split(" ").filter(() => next() > 0.2).join(" ");
      const result = reanchor(edited, anchor, sectionsOf(edited));
      if (result.status !== "orphaned") {
        const editedPlain = plainTextOf(lines(edited));
        expect(result.start, `round ${round}`).toBeGreaterThanOrEqual(0);
        expect(result.end, `round ${round}`).toBeLessThanOrEqual(editedPlain.length);
        expect(result.start, `round ${round}`).toBeLessThan(result.end);
      }
    }
  });
});

describe("pages written to be slow", () => {
  // A page is up to 5 MiB and written by anyone with wiki.write; the server reads it for every reader of a comment (review of
  // P3-001): each pattern of opening marks without closing ones must be read in well under a second at 2 MB, in one paragraph
  // and in many.
  const SIZE = 2_000_000;
  const patterns: Record<string, string> = {
    "bold": "**a ",
    "italic": "*a ",
    "underscore bold": "__a ",
    "underscore": "_a ",
    "strike": "~~a ",
    "link": "[x](",
    "image": "![",
    "reference link": "[x][",
    "open brackets": "[",
    "angle link": "<https://x ",
    "back ticks of every length": "` `` ``` ```` ````` ",
    "quote marks": ">",
    "table cells": "|a",
    "escapes": "\\*",
  };
  const cases = Object.entries(patterns).flatMap(([name, unit]) => [
    [`${name}, in one paragraph`, [unit.repeat(Math.ceil(SIZE / unit.length))]] as const,
    [`${name}, in many paragraphs`, Array.from({ length: Math.ceil(SIZE / 500) }, () => `${unit.repeat(Math.ceil(500 / unit.length))}\n`)] as const,
  ]);

  it.each(cases)("reads %s in under 300 ms a call", (_name, source) => {
    const page = source.flatMap((text) => text.split("\n"));
    const took = (work: () => unknown): number => {
      const started = performance.now();
      work();
      return performance.now() - started;
    };
    const plain = plainTextOf(page);
    const middle = Math.floor(plain.length / 2);
    const anchor = createAnchor(page, { start: middle, end: middle + 20 }, "");
    expect(took(() => plainTextOf(page))).toBeLessThan(300);
    expect(took(() => createAnchor(page, { start: middle, end: middle + 20 }, ""))).toBeLessThan(300);
    expect(took(() => reanchor(page, anchor, []))).toBeLessThan(300);
  });

  it("reads the marks of a long page of prose to its end, in a long paragraph and after many lines", () => {
    expect(plainTextOf([`${"word ".repeat(150_000)}**bold** and [a link](x.md)`])).toMatch(/word bold and a link$/);
    const lines = Array.from({ length: 1500 }, (_, n) => `- Line ${n} with *emphasis* and a [link](a.md).`);
    expect(plainTextOf([...lines, "", "The **end**"]).split("\n").slice(-2)).toEqual(["Line 1499 with emphasis and a link.", "The end"]);
  });

  it("keeps the marks as written once a page has used its work on text made of opening marks, and keeps the text", () => {
    const page = ["[x](".repeat(500_000), "", "The **end** of it"];
    const plain = plainTextOf(page);
    expect(plain.endsWith("The **end** of it")).toBe(true);
    expect(plain.length).toBeGreaterThan(1_000_000);
  });

  it("finds a quote of one letter in a page of a million of them without failing", () => {
    const page = ["a".repeat(1_000_000)];
    const anchor = createAnchor(page, { start: 10, end: 11 }, "section");
    expect(reanchor(page, anchor, [])).toMatchObject({ status: "moved" });
  });
});
