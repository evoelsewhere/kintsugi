// A new page: its address, the scope of its id and the text a template gives it (P2-034, ADR-0096 decisions 3 and 4).

import { describe, expect, it } from "vitest";
import { buildBrainDocument } from "../src/brain.js";
import { PAGE_DEFAULT_SCOPE, newPagePath, pageFromTemplate, pageIdScope, pageSlug } from "../src/page-template.js";

describe("pageSlug", () => {
  it("lowers the title, folds accents, joins the rest with one hyphen and trims it", () => {
    expect(pageSlug("Payment Outage Runbook")).toBe("payment-outage-runbook");
    expect(pageSlug("  --Hello,   World!!  ")).toBe("hello-world");
    expect(pageSlug("Hướng dẫn cài đặt")).toBe("huong-dan-cai-dat");
    expect(pageSlug("Đổi mật khẩu (2026)")).toBe("doi-mat-khau-2026");
    expect(pageSlug("A/B tests: 50% off")).toBe("a-b-tests-50-off");
  });

  it("is at most 60 characters and never ends in a hyphen", () => {
    const slug = pageSlug(`${"word ".repeat(30)}end`) ?? "";
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
    expect(pageSlug("a".repeat(100))).toHaveLength(60);
  });

  it("is undefined when nothing is left to name a page", () => {
    for (const title of ["", "   ", "!!!", "—", "日本語"]) expect(pageSlug(title), title).toBeUndefined();
  });
});

describe("newPagePath", () => {
  it("is <folder>/<slug>.md, with -2 and -3 while the path is taken", () => {
    expect(newPagePath("20-spaces/eng", "Setup guide", () => false)).toBe("20-spaces/eng/setup-guide.md");
    const taken = new Set(["20-spaces/eng/setup-guide.md", "20-spaces/eng/setup-guide-2.md"]);
    expect(newPagePath("20-spaces/eng", "Setup guide", (path) => taken.has(path))).toBe("20-spaces/eng/setup-guide-3.md");
    expect(newPagePath("20-spaces/eng/", "Setup guide", () => false)).toBe("20-spaces/eng/setup-guide.md");
  });

  it("keeps a numbered name within 60 characters", () => {
    const long = "x".repeat(80);
    const path = newPagePath("a", long, (candidate) => candidate === `a/${"x".repeat(60)}.md`) ?? "";
    expect(path).toBe(`a/${"x".repeat(58)}-2.md`);
  });

  it("is undefined without a folder or a usable title", () => {
    expect(newPagePath("", "A page", () => false)).toBeUndefined();
    expect(newPagePath("a", "???", () => false)).toBeUndefined();
  });
});

describe("pageIdScope", () => {
  it("is the space key in capitals, and DOC outside any space or for a key that cannot scope ids", () => {
    expect(pageIdScope("ENG")).toBe("ENG");
    expect(pageIdScope("eng")).toBe("ENG");
    expect(pageIdScope(null)).toBe(PAGE_DEFAULT_SCOPE);
    expect(pageIdScope(undefined)).toBe("DOC");
    expect(pageIdScope("E")).toBe("DOC");
    expect(pageIdScope("ENG-1")).toBe("DOC");
  });
});

describe("pageFromTemplate", () => {
  const page = { id: "PAGE-ENG-0042", title: "Payment outage" };

  it("sets id and title in place and removes the template lines, keeping every other byte", () => {
    const template = [
      "---",
      "type: template",
      "# a comment that stays",
      "labels:   [runbook,  sev1]",
      "title: Template title",
      "template: runbook",
      "owner: on-call-lead",
      "id: PAGE-ENG-0001",
      "---",
      "",
      "# {{title}}   ",
      "",
      "Steps:\t1. one",
      "",
    ].join("\n");
    expect(pageFromTemplate(template, page)).toBe(
      ["---", "# a comment that stays", "labels:   [runbook,  sev1]", "title: Payment outage", "owner: on-call-lead", "id: PAGE-ENG-0042", "---", "", "# {{title}}   ", "", "Steps:\t1. one", ""].join("\n"),
    );
  });

  it("adds id and title right after the opening line when the template has none, id first", () => {
    const template = "---\ntype: template\nlabels: [a]\n---\n\nBody.\n";
    expect(pageFromTemplate(template, page)).toBe("---\nid: PAGE-ENG-0042\ntitle: Payment outage\nlabels: [a]\n---\n\nBody.\n");
    expect(pageFromTemplate("---\ntitle: T\n---\nBody\n", page)).toBe("---\nid: PAGE-ENG-0042\ntitle: Payment outage\n---\nBody\n");
  });

  it("keeps CRLF endings and a missing final newline", () => {
    const template = "---\r\ntype: template\r\ntitle: T\r\n---\r\n\r\nBody without end";
    expect(pageFromTemplate(template, page)).toBe("---\r\nid: PAGE-ENG-0042\r\ntitle: Payment outage\r\n---\r\n\r\nBody without end");
  });

  it("gives a template without front matter a block of its own in front of its text", () => {
    expect(pageFromTemplate("# Plain\n\nText\n", page)).toBe("---\nid: PAGE-ENG-0042\ntitle: Payment outage\n---\n# Plain\n\nText\n");
    expect(pageFromTemplate("# Plain\r\n", page)).toBe("---\r\nid: PAGE-ENG-0042\r\ntitle: Payment outage\r\n---\r\n# Plain\r\n");
    // A first line that opens a block that never closes is text, not front matter.
    expect(pageFromTemplate("---\nno close\n", page)).toBe("---\nid: PAGE-ENG-0042\ntitle: Payment outage\n---\n---\nno close\n");
  });

  it("removes only type: template, whatever its quotes, and a template: key with the lines under it", () => {
    const template = "---\ntype: \"template\"\ntemplate:\n  name: runbook\n  version: 2\nkind: how-to\ntype: guide\n---\nx\n";
    expect(pageFromTemplate(template, page)).toBe("---\nid: PAGE-ENG-0042\ntitle: Payment outage\nkind: how-to\ntype: guide\n---\nx\n");
    expect(pageFromTemplate("---\ntype: howto-template\ntemplates: x\n---\n", page)).toBe("---\nid: PAGE-ENG-0042\ntitle: Payment outage\ntype: howto-template\ntemplates: x\n---\n");
  });

  it("writes a title that YAML would read differently as a quoted string", () => {
    for (const title of ["Q&A: what, why?", "true", "2026", "- dash start", "# not a comment", "He said \"no\"", "yes", "ends with space "]) {
      const text = pageFromTemplate("---\ntype: template\n---\nx\n", { id: "PAGE-ENG-0001", title });
      expect(buildBrainDocument("a.md", text).nodes[0]?.title, title).toBe(title.trim());
    }
    expect(pageFromTemplate("---\n---\nx\n", { id: "PAGE-ENG-0001", title: "Plain title (v2)" })).toContain("title: Plain title (v2)\n");
  });

  it("makes a page that is no template, with the id the Brain and pageIdOf read, and removes nothing else", () => {
    const template = "---\ntype: template\nlabels: [runbook]\nowner: lead\n---\n\n# Runbook\n\n## Steps\n";
    const text = pageFromTemplate(template, page);
    expect(text.split("\n")[1]).toBe("id: PAGE-ENG-0042");
    const document = buildBrainDocument("20-spaces/eng/payment-outage.md", text).nodes[0];
    expect(document).toMatchObject({ title: "Payment outage", template: false, labels: ["runbook"], owner: "lead", ids: ["PAGE-ENG-0042"] });
    // The text after the front matter is untouched, byte for byte.
    expect(text.slice(text.indexOf("\n---\n") + 5)).toBe(template.slice(template.indexOf("\n---\n") + 5));
  });
});
