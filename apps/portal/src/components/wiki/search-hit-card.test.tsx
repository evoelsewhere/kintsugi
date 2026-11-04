import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SearchHitCard } from "./search-hit-card";

const hit = {
  path: "20-spaces/eng/runbooks/db-failover.md",
  title: "Database failover",
  breadcrumb: ["Spaces", "eng"],
  space: "ENG",
  labels: ["runbook"],
  summary: "Steps to fail the database over.",
  lines: [{ line: 14, excerpt: "Promote the replica of the <b>database</b>.", anchor: "steps", section: "Steps" }],
};

const render = (ranked: boolean, query: string): string =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ul>
        <SearchHitCard projectId="shop" hit={hit} query={query} ranked={ranked} />
      </ul>
    </MemoryRouter>,
  );

describe("SearchHitCard", () => {
  it("shows the title, where the page is, its summary, the line number and the heading, and links to the page at that heading", () => {
    const html = render(true, "database failover");
    expect(html).toContain("Database failover");
    expect(html).toContain("Steps to fail the database over.");
    expect(html).toContain(">14<");
    expect(html).toContain("Steps ·");
    expect(html).toContain('href="/wiki/20-spaces/eng/runbooks/db-failover.md?project=shop#steps"');
  });

  it("marks each word of a ranked query, and shows the line as text, never as HTML", () => {
    const html = render(true, "replica database");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html.match(/<mark/g)).toHaveLength(2);
  });

  it("marks the whole text for an exact hit, and says what an archived page is", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ul>
          <SearchHitCard projectId="shop" hit={{ ...hit, hidden: "archived" }} query="the replica" ranked={false} />
        </ul>
      </MemoryRouter>,
    );
    expect(html).toContain("archived");
    expect(html.match(/<mark/g)).toHaveLength(1);
    expect(html).toContain(">the replica<");
  });
});
