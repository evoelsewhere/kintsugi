// The wiki parts of the Markdown renderer. Rendered to markup, so it runs without a browser: the portal has no DOM
// test environment.

import { buildBrainDocument } from "@kintsugi/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// The renderer imports the document links, which import the API client, which reads localStorage when it loads.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
});

import Markdown from "./markdown";

const render = (text: string): string => renderToStaticMarkup(<Markdown text={text} />);
const ids = (html: string): string[] => [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((match) => match[1] ?? "");

const SAMPLE = [
  "# Billing",
  "",
  "## Overview",
  "",
  "text",
  "",
  "## Overview",
  "",
  "### Overview",
  "",
  "## Overview",
  "",
  "## `code` and **bold** [a link](https://example.com)",
  "",
  "## Quy tắc làm tròn (v2)",
  "",
  "## RULE-INV01-0001: Round half up",
  "",
  "## Sample: a heading with a colon",
  "",
  "## snake_case_name and _emphasis_",
  "",
  "```md",
  "## not a heading",
  "```",
  "",
  "#### Deep",
  "",
  "##### Deeper",
  "",
  "###### Deepest",
  "",
].join("\n");

describe("heading ids", () => {
  it("are the anchors the Brain builder gives the sections of the same text, repeats and card ids included", () => {
    const sections = buildBrainDocument("sample.md", SAMPLE)
      .nodes.filter((node) => node.kind === "section" || node.kind === "card")
      .map((node) => node.anchor);
    expect(sections.length).toBe(12);
    expect(ids(render(SAMPLE))).toEqual(sections);
  });

  it("number a repeated heading the way GitHub does", () => {
    expect(ids(render("## A\n\n## A\n\n## A-1\n\n## A"))).toEqual(["a", "a-1", "a-1-1", "a-2"]);
  });

  it("start from nothing in each render", () => {
    expect(ids(render("## Same"))).toEqual(["same"]);
    expect(ids(render("## Same"))).toEqual(["same"]);
  });

  it("are not given to the document's title or an underlined heading, as the Brain makes no section of them, and take no number", () => {
    const html = render("# Overview\n\nSecond one\n---\n\n## Overview\n\n## Overview");
    expect(html).toContain("<h1");
    expect(html).toMatch(/<h2 class="[^"]*">Second one<\/h2>/);
    expect(ids(html)).toEqual(["overview", "overview-1"]);
  });

  it("are given to every `#` heading when the first heading is not the only top-level one", () => {
    const text = "## Intro\n\n# Overview\n\n# Overview\n\n## Intro";
    const sections = buildBrainDocument("two.md", text)
      .nodes.filter((node) => node.kind === "section" || node.kind === "card")
      .map((node) => node.anchor);
    expect(ids(render(text))).toEqual(["intro", "overview", "overview-1", "intro-1"]);
    expect(ids(render(text))).toEqual(sections);
  });

  it("do not appear on headings written as raw HTML, which stays dropped", () => {
    expect(render("<h2>raw</h2>\n\ntext")).not.toContain("<h2");
  });
});

describe("GitHub alerts", () => {
  it.each([
    ["NOTE", "Note"],
    ["TIP", "Tip"],
    ["IMPORTANT", "Important"],
    ["WARNING", "Warning"],
    ["CAUTION", "Caution"],
  ])("renders [!%s] as a labelled panel without its marker", (marker, label) => {
    const html = render(`> [!${marker}]\n> Check the **rounding** first.`);
    expect(html).toContain(`data-alert="${marker.toLowerCase()}"`);
    expect(html).toContain(`>${label}</p>`);
    expect(html).toContain("Check the <strong>rounding</strong> first.");
    expect(html).not.toContain(`[!${marker}]`);
    expect(html).not.toContain("<blockquote");
  });

  it("accepts the marker in any letter case, and a marker with nothing after it", () => {
    expect(render("> [!note]\n> text")).toContain('data-alert="note"');
    const alone = render("> [!TIP]");
    expect(alone).toContain('data-alert="tip"');
    expect(alone).not.toContain("[!TIP]");
  });

  it("keeps every other quote as it renders today", () => {
    for (const text of ["> plain quote", "> [!INFO]\n> unknown type", "> [!NOTE] text on the marker's line", "> text\n> [!NOTE]", "> > [!NOTE]\n> > nested"]) {
      const html = render(text);
      expect(html, text).toContain("<blockquote");
      expect(html, text).not.toContain("data-alert");
    }
  });
});

describe("kintsugi macro fences", () => {
  it("show a labelled block with the parameters as text, and run nothing", () => {
    const html = render("```kintsugi-children\ndepth: 2\nsort: title\n```");
    expect(html).toContain("Macro: children");
    expect(html).toContain('data-macro="children"');
    expect(html).toContain("depth: 2\nsort: title");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("<code");
  });

  it("show a macro without parameters as its label alone", () => {
    const html = render("```kintsugi-toc\n```");
    expect(html).toContain("Macro: toc");
    expect(html).not.toContain("whitespace-pre-wrap");
  });

  it("escape what is in the parameters", () => {
    const html = render('```kintsugi-include\npage: <script>alert(1)</script> [x](javascript:alert(1))\n```');
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<a ");
  });

  it("leave other fences as code", () => {
    for (const language of ["js", "kintsugi", "kintsugi-", "kintsugi_toc", "my-kintsugi-toc"]) {
      const html = render(`\`\`\`${language}\nx\n\`\`\``);
      expect(html, language).toContain("<pre");
      expect(html, language).not.toContain("Macro:");
    }
  });
});
