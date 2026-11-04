import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportMarkdownButton } from "./export-markdown-button";

describe("ExportMarkdownButton", () => {
  it("is a button named for the file it saves", () => {
    const html = renderToStaticMarkup(<ExportMarkdownButton path="20-spaces/my team/db.md" text="# Db" />);
    expect(html).toContain("Export Markdown");
    expect(html).toContain('title="Save db.md"');
    expect(html).toContain('type="button"');
  });
});
