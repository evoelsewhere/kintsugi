// The writer's duplicate page id check without Git: what it accepts and what it refuses (P2-029).

import { describe, expect, it } from "vitest";
import { OutputRuleError } from "../src/document-write/outputs.js";
import { assertNoDuplicatePageIds } from "../src/document-write/page-ids.js";

const page = (id: string): string => `---\nid: ${id}\n---\n\n# Page\n`;
const owners = (table: Record<string, string[]>) => async (id: string): Promise<string[]> => table[id] ?? [];

describe("assertNoDuplicatePageIds", () => {
  it("accepts a page whose id nobody holds, a page without an id and files that are not Markdown", async () => {
    await expect(
      assertNoDuplicatePageIds(
        [
          { path: "20-spaces/eng/new.md", content: page("PAGE-ENG-0005") },
          { path: "20-spaces/eng/plain.md", content: "# No front matter\n" },
          { path: "20-spaces/eng/_attachments/a.png", content: Uint8Array.from([0x89, 0x50]) },
        ],
        owners({}),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses an id that another file holds, and names the file", async () => {
    const check = assertNoDuplicatePageIds([{ path: "20-spaces/eng/new.md", content: page("PAGE-ENG-0001") }], owners({ "PAGE-ENG-0001": ["20-spaces/eng/a.md"] }));
    await expect(check).rejects.toThrow(OutputRuleError);
    await expect(check).rejects.toThrow("Page id PAGE-ENG-0001 is already defined by 20-spaces/eng/a.md");
  });

  it("accepts the same id at the page's own path (an edit) and at its renameFrom (a move)", async () => {
    const table = owners({ "PAGE-ENG-0001": ["20-spaces/eng/a.md"] });
    await expect(assertNoDuplicatePageIds([{ path: "20-spaces/eng/a.md", content: page("PAGE-ENG-0001") }], table)).resolves.toBeUndefined();
    await expect(assertNoDuplicatePageIds([{ path: "20-spaces/ops/a.md", renameFrom: "20-spaces/eng/a.md", content: page("PAGE-ENG-0001") }], table)).resolves.toBeUndefined();
    // But a move of another page onto an id the page at the head holds is a duplicate.
    await expect(assertNoDuplicatePageIds([{ path: "20-spaces/ops/b.md", renameFrom: "20-spaces/eng/b.md", content: page("PAGE-ENG-0001") }], table)).rejects.toThrow("already defined by 20-spaces/eng/a.md");
  });

  it("lets a write that removes or moves away the holder give its id to another file", async () => {
    const table = owners({ "PAGE-ENG-0001": ["20-spaces/eng/a.md"] });
    await expect(
      assertNoDuplicatePageIds([{ path: "20-spaces/eng/a.md", delete: true }, { path: "20-spaces/eng/b.md", content: page("PAGE-ENG-0001") }], table),
    ).resolves.toBeUndefined();
  });

  it("refuses two pages of one write that give the same id", async () => {
    await expect(
      assertNoDuplicatePageIds([{ path: "a.md", content: page("PAGE-ENG-0003") }, { path: "b.md", content: page("PAGE-ENG-0003") }], owners({})),
    ).rejects.toThrow("given by two pages of this write: a.md and b.md");
  });

  it("reads the id of a page written as bytes, and does not read one from the text", async () => {
    const table = owners({ "PAGE-ENG-0001": ["20-spaces/eng/a.md"] });
    await expect(assertNoDuplicatePageIds([{ path: "x.md", content: Buffer.from(page("PAGE-ENG-0001")) }], table)).rejects.toThrow(OutputRuleError);
    await expect(assertNoDuplicatePageIds([{ path: "x.md", content: "# X\n\nid: PAGE-ENG-0001\n" }], table)).resolves.toBeUndefined();
  });
});
