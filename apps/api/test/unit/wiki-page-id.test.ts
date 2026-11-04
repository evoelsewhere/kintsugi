// Replacing the id line of a page's front matter (P2-055) without touching another byte.

import { describe, expect, it } from "vitest";
import { withPageId } from "../../src/modules/delivery/wiki/domain/wiki.page-id.js";

describe("withPageId", () => {
  it("replaces the id line and nothing else, keeping the line endings, quotes aside", () => {
    expect(withPageId("---\nid: PAGE-DOC-0001\ntitle: A\n---\n\n# A\n", "PAGE-DOC-0002")).toBe("---\nid: PAGE-DOC-0002\ntitle: A\n---\n\n# A\n");
    expect(withPageId("---\r\ntitle: A\r\nid: PAGE-DOC-0001\r\n---\r\n\r\n# A\r\n", "PAGE-ENG-0042")).toBe("---\r\ntitle: A\r\nid: PAGE-ENG-0042\r\n---\r\n\r\n# A\r\n");
    expect(withPageId('---\nid: "PAGE-DOC-0001"\n---\n', "PAGE-DOC-0003")).toBe("---\nid: PAGE-DOC-0003\n---\n");
    expect(withPageId("---\nid:   PAGE-DOC-0001  \n---\nid: PAGE-DOC-0001 in the body\n", "PAGE-DOC-0004")).toBe("---\nid: PAGE-DOC-0004\n---\nid: PAGE-DOC-0001 in the body\n");
  });

  it("changes only what pageIdOf reads: a text with no id in its front matter, an id outside it, or a bad id is not touched", () => {
    expect(withPageId("# No front matter\n\nid: PAGE-DOC-0001\n", "PAGE-DOC-0002")).toBeUndefined();
    expect(withPageId("---\ntitle: A\n---\n\nid: PAGE-DOC-0001\n", "PAGE-DOC-0002")).toBeUndefined();
    expect(withPageId("---\nid: not-an-id\n---\n", "PAGE-DOC-0002")).toBeUndefined();
    expect(withPageId("---\nid: PAGE-DOC-0001\n---\n", "not-an-id")).toBeUndefined();
    expect(withPageId("---\nid: PAGE-DOC-0001\n", "PAGE-DOC-0002")).toBe("---\nid: PAGE-DOC-0002\n");
  });
});
