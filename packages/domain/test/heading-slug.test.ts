import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as domain from "../src/index.js";
import { atxHeading } from "../src/brain.js";
import { createHeadingSlugger, headingSlug, plainInlineText } from "../src/heading-slug.js";

/**
 * Pairs of heading and GitHub's anchor. Each anchor is what github-slugger makes of the heading's rendered text, taken
 * from the library run against the rendering of the heading by a CommonMark renderer; none comes from this module.
 */
const GITHUB: Array<[string, string]> = [
  ["Hello, World!", "hello-world"],
  ["API & Design", "api--design"],
  ["C++ / C#", "c--c"],
  ["a.b-c", "ab-c"],
  ["Emoji 🚀 title", "emoji--title"],
  ["🚀", ""],
  ["emoji ⚠️ warning", "emoji-️-warning"],
  ["1. Introduction", "1-introduction"],
  ["Quy tắc làm tròn (v2)", "quy-tắc-làm-tròn-v2"],
  ["Tiếng Việt: thiết kế", "tiếng-việt-thiết-kế"],
  ["日本語の見出し", "日本語の見出し"],
  ["Заголовок документа", "заголовок-документа"],
  ["Café Über", "café-über"],
  ["`code` **bold**", "code-bold"],
  ["**Bold** and __also bold__", "bold-and-also-bold"],
  ["*emph* text and ~~strike~~", "emph-text-and-strike"],
  ["[Link text](https://example.com/a_b) here", "link-text-here"],
  ["![alt](image.png) Figure", "-figure"],
  ["Title ![img](a.png)", "title-"],
  ["Escaped \\* star \\# hash", "escaped--star--hash"],
  ["foo `bar` baz", "foo-bar-baz"],
  ["``double `tick` span``", "double-tick-span"],
  ["Unclosed ` tick", "unclosed--tick"],
  ["RULE-INV01-0001: Round half up", "rule-inv01-0001-round-half-up"],
  // The differences the Brain's earlier rule had from GitHub
  ["a  b", "a--b"],
  ["Use `<div>` tag", "use-div-tag"],
  ["<span>Raw</span> html", "raw-html"],
  ["_emph_", "emph"],
  ["_a_ and _b_", "a-and-b"],
  ["snake_case_name", "snake_case_name"],
  ["__init__ method", "init-method"],
  ["x_1 and y_2", "x_1-and-y_2"],
  ["`a_b` and _c_", "a_b-and-c"],
  ["Café", "café"],
  ["हिन्दी भाषा", "हिन्दी-भाषा"],
  ["&amp; entity", "-entity"],
  ["& entity", "-entity"],
  ["İstanbul", "i̇stanbul"],
  ["tab\there", "tabhere"],
  ["Step 2: Configure (optional)", "step-2-configure-optional"],
  ["[ref link][ref]", "ref-linkref"],
];

describe("headingSlug", () => {
  it("makes GitHub's anchor of the heading's rendered text", () => {
    for (const [heading, github] of GITHUB) expect(headingSlug(heading), JSON.stringify(heading)).toBe(github === "" ? "section" : github);
  });

  it("falls back to section when nothing is left, which GitHub makes an empty anchor", () => {
    for (const heading of ["", "  ", "!!!", "`", "<b></b>", "🚀"]) expect(headingSlug(heading), JSON.stringify(heading)).toBe("section");
  });

  it("keeps a space next to a dropped character as a hyphen, and none collapses", () => {
    expect(headingSlug("Title ![img](a.png)")).toBe("title-");
    expect(headingSlug("a  b   c")).toBe("a--b---c");
  });

  it("reads a pathological line in bounded time", () => {
    const lines = ["[".repeat(100_000), "[a](".repeat(50_000), "<".repeat(100_000), " ".repeat(200_000) + "x", "`".repeat(100_000), "*_".repeat(50_000), "_a ".repeat(50_000), "`a ".repeat(50_000)];
    for (const heading of lines) {
      const started = Date.now();
      headingSlug(heading);
      expect(Date.now() - started).toBeLessThan(1_000);
    }
  });
});

/** The rule the Brain used before: plain text first, trimmed, a space run collapsed, marks and `_` emphasis kept as is. */
function earlierSlug(heading: string): string {
  const slug = plainInlineText(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
  return slug === "" ? "section" : slug;
}

/** The headings of the Markdown files under a folder, outside code fences. */
function headingsUnder(folder: URL): string[] {
  const found: string[] = [];
  for (const name of readdirSync(folder)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const child = new URL(name, folder);
    if (statSync(child).isDirectory()) {
      found.push(...headingsUnder(new URL(`${name}/`, folder)));
      continue;
    }
    if (!name.endsWith(".md")) continue;
    let fence: string | undefined;
    for (const line of readFileSync(child, "utf8").split("\n")) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]?.[0];
      if (marker !== undefined) {
        fence = fence === undefined ? marker : fence === marker ? undefined : fence;
        continue;
      }
      const heading = fence === undefined ? atxHeading(line) : undefined;
      if (heading !== undefined) found.push(heading.text);
    }
  }
  return found;
}

describe("the anchors the rule changes, measured on the repository's own documents", () => {
  const headings = [...new Set(["docs", "templates"].flatMap((folder) => headingsUnder(new URL(`../../../${folder}/`, import.meta.url))))];
  const changed = headings.filter((heading) => earlierSlug(heading) !== headingSlug(heading));
  /** A change that follows from the documented differences: a space next to a dropped character, or a tag or an escaped `<`. */
  const explained = (heading: string): boolean =>
    earlierSlug(heading).replaceAll("-", "") === headingSlug(heading).replaceAll("-", "") ||
    /`[^`]*<[^`]*`/.test(heading) ||
    heading.includes("\\<") ||
    /<\/?[A-Za-z]/.test(heading) ||
    /\p{M}/u.test(heading) ||
    /(^|[^\p{L}\p{N}_])_[^\s_]/u.test(heading);

  it("reads enough headings for the measure to mean something", () => {
    expect(headings.length).toBeGreaterThan(500);
  });

  it("changes only the anchors of headings that hold one of the documented cases", () => {
    expect(changed.filter((heading) => !explained(heading)), "an unexplained change").toEqual([]);
    // The changes are rare, and every one is listed in the failure message when this fails.
    expect(changed.length, changed.join(" | ")).toBeLessThan(headings.length / 20);
  });

  it("changes no anchor of a heading that starts with a reference id, as a card's heading does", () => {
    const cards = headings.filter((heading) => /^[A-Z][A-Z0-9]{1,15}(?:-[A-Z0-9]{1,16})*-[0-9]{2,}[A-Z]?\b/.test(heading));
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.filter((heading) => earlierSlug(heading) !== headingSlug(heading))).toEqual([]);
  });
});

describe("plainInlineText", () => {
  it("keeps the text of links, emphasis and code, drops images and tags, and collapses whitespace", () => {
    expect(plainInlineText("[Link](https://example.com)  and **bold** `code` ![img](a.png) <b>x</b>")).toBe("Link and bold code x");
    expect(plainInlineText("  Escaped \\* star  ")).toBe("Escaped * star");
  });
});

describe("createHeadingSlugger", () => {
  it("numbers a repeated slug as GitHub does, taking the first free number", () => {
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

  it("numbers many repeats in linear time", () => {
    const slugger = createHeadingSlugger();
    const started = Date.now();
    for (let repeat = 0; repeat < 20_000; repeat += 1) slugger.slug("Same");
    expect(slugger.slug("Same")).toBe("same-20000");
    expect(Date.now() - started).toBeLessThan(1_000);
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
    expect(domain.plainInlineText).toBe(plainInlineText);
  });
});
