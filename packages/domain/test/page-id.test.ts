// The id a page gives itself in its front matter (P2-029, ADR-0096 decision 4), and what the wiki may write
// (ADR-0098 decision 6, ADR-0096 decision 6) pinned in one table.

import { describe, expect, it } from "vitest";
import { PAGE_ID, isWikiEditablePath, pageId, pageIdOf } from "../src/document-layout.js";

const page = (front: string[], body = "Text.\n"): string => ["---", ...front, "---", "", "# Page", "", body].join("\n");

describe("pageIdOf", () => {
  it("reads id: PAGE-<KEY>-<nnnn> from the front matter", () => {
    expect(pageIdOf(page(["title: A", "id: PAGE-ENG-0001"]))).toBe("PAGE-ENG-0001");
    expect(pageIdOf(page(["id: PAGE-HR2-12345"]))).toBe("PAGE-HR2-12345");
    expect(pageIdOf(page(['id: "PAGE-OPS-0010"']))).toBe("PAGE-OPS-0010");
    expect(pageIdOf(page(["id:   'PAGE-OPS-0010'  "]))).toBe("PAGE-OPS-0010");
    // CRLF files read the same.
    expect(pageIdOf(page(["id: PAGE-ENG-0007"]).replace(/\n/g, "\r\n"))).toBe("PAGE-ENG-0007");
  });

  it("reads the key as the space key rule says: 2 to 10 capital letters or digits, a letter first, at least four digits", () => {
    for (const id of ["PAGE-E-0001", "PAGE-1AB-0001", "PAGE-ABCDEFGHIJK-0001", "PAGE-eng-0001", "PAGE-ENG-001", "PAGE-ENG-0000", "PAGE-ENG-00001", "PAGE-ENG-1", "page-ENG-0001", "PAGE-ENG-0001 x", "RULE-INV01-0001"]) {
      expect(pageIdOf(page([`id: ${id}`])), id).toBeUndefined();
    }
    expect(pageIdOf(page(["id: PAGE-ENG-10000"]))).toBe("PAGE-ENG-10000");
    expect(pageIdOf(page([`id: ${pageId("ENG", 42)}`]))).toBe("PAGE-ENG-0042");
  });

  it("does not read an id from the text, a code fence or a front matter that is not closed", () => {
    expect(pageIdOf("# Page\n\nid: PAGE-ENG-0001\n")).toBeUndefined();
    expect(pageIdOf(page(["title: A"], "id: PAGE-ENG-0001\n"))).toBeUndefined();
    expect(pageIdOf(page(["title: A"], "```yaml\n---\nid: PAGE-ENG-0001\n---\n```\n"))).toBeUndefined();
    expect(pageIdOf("```\n---\nid: PAGE-ENG-0001\n---\n```\n")).toBeUndefined();
    expect(pageIdOf("---\ntitle: A\nid: PAGE-ENG-0001\n\nNever closed.\n")).toBe("PAGE-ENG-0001");
    expect(pageIdOf("\n---\nid: PAGE-ENG-0001\n---\n")).toBeUndefined();
    expect(pageIdOf("")).toBeUndefined();
  });

  it("takes the first id line of the front matter, and ignores keys that only end in id", () => {
    expect(pageIdOf(page(["id: PAGE-ENG-0001", "id: PAGE-ENG-0002"]))).toBe("PAGE-ENG-0001");
    expect(pageIdOf(page(["parentId: PAGE-ENG-0001", "uid: PAGE-ENG-0002"]))).toBeUndefined();
    expect(pageIdOf(page(["  id: PAGE-ENG-0001"]))).toBeUndefined();
  });

  it("has a PAGE_ID pattern that matches whole ids only", () => {
    expect(PAGE_ID.test("PAGE-ENG-0001")).toBe(true);
    expect(PAGE_ID.test("xPAGE-ENG-0001")).toBe(false);
    expect(PAGE_ID.test("PAGE-ENG-0001\nPAGE-ENG-0002")).toBe(false);
  });
});

describe("what the wiki may write (review of ADR-0098 decision 6 and ADR-0096 decision 6)", () => {
  const editable = [
    "00-project/charter.md",
    "01-standards/conventions/naming.md",
    "02-architecture/overview.md",
    "03-transition/plan.md",
    "20-spaces/eng/README.md",
    "20-spaces/eng/runbooks/db-failover.md",
    "20-spaces/eng/ONBOARDING.MD",
    "README.md",
    "20-spaces/eng/_attachments/diagram.png",
    "20-spaces/eng/_attachments/photo.JPG",
    "20-spaces/eng/runbooks/_attachments/scan.pdf",
    "20-spaces/eng/_attachments/a.jpeg",
    "20-spaces/eng/_attachments/a.gif",
    "20-spaces/eng/_attachments/a.webp",
  ];
  const refused = [
    // not editable pages: generated, restricted, plugins, scratch, hidden, identifiers
    "10-applications/billing/_generated/GAPS.md",
    "20-spaces/eng/_generated/x.md",
    "restricted/a.md",
    "20-spaces/eng/restricted/a.md",
    "plugins/p/README.md",
    "scratch/a/b.md",
    ".github/readme.md",
    "20-spaces/.hidden/a.md",
    "20-spaces/eng/identifiers/ids.md",
    // not a Markdown page or an attachment of an allowed type in an _attachments folder
    "kintsugi.yaml",
    "20-spaces/eng/notes.txt",
    "20-spaces/eng/_attachments/logo.svg",
    "20-spaces/eng/_attachments/run.sh",
    "20-spaces/eng/_attachments/archive.zip",
    "20-spaces/eng/diagram.png",
    "20-spaces/eng/_attachments/sub/diagram.png",
    "20-spaces/eng/_attachments/.hidden.png",
    "20-spaces/eng/_attachments/a b.png",
    // stage-written documents stay pull-request-only through the stage path (a Phase 2 choice, safer than the ADR)
    "10-applications/billing/01-legacy/plan.md",
    "10-applications/billing/02-modern/requirements.md",
  ];

  it.each(editable)("lets the wiki write %s", (path) => {
    expect(isWikiEditablePath(path)).toBe(true);
  });

  it.each(refused)("never lets the wiki write %s", (path) => {
    expect(isWikiEditablePath(path)).toBe(false);
  });
});
