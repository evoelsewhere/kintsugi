import { describe, expect, it } from "vitest";
import * as domain from "../src/index.js";
import { brainAnchor } from "../src/brain.js";
import { createHeadingSlugger, headingSlug, plainInlineText } from "../src/heading-slug.js";

/** Headings the Brain's tests, its fixtures and the repository's documents use, and the shapes around them. */
const HEADINGS = [
  "Quy tắc làm tròn (v2)",
  "`code` **bold**",
  "Overview",
  "Hello, World!",
  "1. Introduction",
  "API & Design",
  "C++ / C#",
  "a.b-c",
  "snake_case_name",
  "foo-bar",
  "Emoji 🚀 title",
  "Tiếng Việt: thiết kế",
  "日本語の見出し",
  "Заголовок документа",
  "Café Über",
  "[Link text](https://example.com/a_b) here",
  "![alt](image.png) Figure",
  "Use `<div>` tags",
  "<span>Raw</span> html",
  "**Bold** and __also bold__",
  "Escaped \\* star \\# hash",
  "Trailing hashes ##",
  "  padded  ",
  "(parenthesised)",
  "Q&A",
  "RULE-INV01-0001: Round half up",
  "SEC-ORD-0002",
  "COM-LOG-01",
  "!!!",
  "",
  "  ",
  "`",
  "[",
  "[a](",
  "<",
];

describe("headingSlug", () => {
  it("returns what the Brain's anchor returns today, on the headings the Brain meets", () => {
    expect(HEADINGS.length).toBeGreaterThanOrEqual(20);
    for (const heading of HEADINGS) expect(headingSlug(heading), JSON.stringify(heading)).toBe(brainAnchor(heading));
  });

  it("makes the anchor of ordinary headings", () => {
    expect(headingSlug("Hello, World!")).toBe("hello-world");
    expect(headingSlug("Quy tắc làm tròn (v2)")).toBe("quy-tắc-làm-tròn-v2");
    expect(headingSlug("`code` **bold**")).toBe("code-bold");
    expect(headingSlug("1. Introduction")).toBe("1-introduction");
    expect(headingSlug("[Link text](https://example.com) here")).toBe("link-text-here");
    expect(headingSlug("日本語の見出し")).toBe("日本語の見出し");
    expect(headingSlug("RULE-INV01-0001: Round half up")).toBe("rule-inv01-0001-round-half-up");
  });

  it("falls back to section when nothing is left", () => {
    for (const heading of ["", "  ", "!!!", "`", "<b></b>", "![alt](x.png)"]) expect(headingSlug(heading), JSON.stringify(heading)).toBe("section");
  });

  it("reads a pathological line in linear time", () => {
    for (const heading of ["[".repeat(100_000), "[a](".repeat(50_000), "<".repeat(100_000), " ".repeat(200_000) + "x", "`".repeat(100_000), "*_".repeat(50_000)]) {
      const started = Date.now();
      headingSlug(heading);
      expect(Date.now() - started).toBeLessThan(1_000);
    }
  });

  /**
   * Where the anchor differs from GitHub's. `today` is what the Brain makes and keeps making until the alignment
   * ticket; `github` is what GitHub makes of the heading. The gap is measured here, not fixed.
   */
  const KNOWN_DIFFERENCES: Array<{ name: string; heading: string; today: string; github: string }> = [
    { name: "a double space", heading: "a  b", today: "a-b", github: "a--b" },
    { name: "HTML inside a code span", heading: "Use `<div>` tag", today: "use-tag", github: "use-div-tag" },
    { name: "_emphasis_", heading: "_emph_", today: "_emph_", github: "emph" },
    { name: "a combining mark (NFD)", heading: "Café", today: "cafe", github: "café" },
    { name: "vowel signs that are marks", heading: "हिन्दी भाषा", today: "हनद-भष", github: "हिन्दी-भाषा" },
    { name: "an HTML entity", heading: "&amp; entity", today: "amp-entity", github: "entity" },
    { name: "a letter that lowercases to letter and mark", heading: "İstanbul", today: "istanbul", github: "i̇stanbul" },
  ];

  /** Headings where today's rule and GitHub's agree. */
  const SAME_AS_GITHUB: Array<[string, string]> = [
    ["Hello, World!", "hello-world"],
    ["API & Design", "api--design"],
    ["C++ / C#", "c--c"],
    ["a.b-c", "ab-c"],
    ["Emoji 🚀 title", "emoji--title"],
    ["snake_case_name", "snake_case_name"],
    ["1. Introduction", "1-introduction"],
    ["Café Über", "café-über"],
    ["Tiếng Việt: thiết kế", "tiếng-việt-thiết-kế"],
    ["[Link text](https://example.com) here", "link-text-here"],
    ["**Bold** and __also bold__", "bold-and-also-bold"],
  ];

  it("equals GitHub's anchor where the two agree", () => {
    for (const [heading, github] of SAME_AS_GITHUB) expect(headingSlug(heading), heading).toBe(github);
  });

  it("differs from GitHub's anchor only in the named known differences", () => {
    for (const { name, heading, today, github } of KNOWN_DIFFERENCES) {
      expect(headingSlug(heading), name).toBe(today);
      expect(today, name).not.toBe(github);
    }
  });
});

describe("plainInlineText", () => {
  it("keeps the text of links, emphasis and code, drops images and tags, and collapses whitespace", () => {
    expect(plainInlineText("[Link](https://example.com)  and **bold** `code` ![img](a.png) <b>x</b>")).toBe("Link and bold code x");
    expect(plainInlineText("  Escaped \\* star  ")).toBe("Escaped * star");
  });
});

describe("createHeadingSlugger", () => {
  it("numbers a repeated slug the way the Brain's builder does", () => {
    const slugger = createHeadingSlugger();
    expect([slugger.slug("A"), slugger.slug("A"), slugger.slug("A-1")]).toEqual(["a", "a-1", "a-1-1"]);
    const again = createHeadingSlugger();
    expect(["Same", "Same", "Same 1", "Same", "Same-1"].map((heading) => again.slug(heading))).toEqual(["same", "same-1", "same-1-1", "same-2", "same-1-2"]);
  });

  it("numbers every empty heading as section", () => {
    const slugger = createHeadingSlugger();
    expect([slugger.slug("!"), slugger.slug("?"), slugger.slug("")]).toEqual(["section", "section-1", "section-2"]);
  });

  it("makes a reserved anchor, such as a card id, count as taken", () => {
    const slugger = createHeadingSlugger();
    expect(slugger.reserve("a")).toBe("a");
    expect(slugger.slug("A")).toBe("a-1");
    expect(slugger.reserve("RULE-INV01-0001")).toBe("RULE-INV01-0001");
    expect(slugger.reserve("RULE-INV01-0001")).toBe("RULE-INV01-0001-1");
    expect(slugger.slug("a")).toBe("a-2");
  });

  it("shares no state between two sluggers", () => {
    const first = createHeadingSlugger();
    const second = createHeadingSlugger();
    expect(first.slug("Intro")).toBe("intro");
    expect(first.slug("Intro")).toBe("intro-1");
    expect(second.slug("Intro")).toBe("intro");
  });

  it("is exported from the package with headingSlug", () => {
    expect(domain.headingSlug).toBe(headingSlug);
    expect(domain.createHeadingSlugger).toBe(createHeadingSlugger);
  });
});
