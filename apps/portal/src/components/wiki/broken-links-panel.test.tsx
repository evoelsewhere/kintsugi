// The report of broken links, rendered to markup (the portal has no DOM test environment).

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ expireSession: () => undefined }));
import type { BrokenLinksView } from "@/lib/wiki-broken";

const { BrokenLinksPanel, BrokenLinksTable } = await import("./broken-links-panel");

const view = (over: Partial<BrokenLinksView>): BrokenLinksView => ({ projectId: "shop", branch: "main", commit: "a".repeat(40), links: [], truncated: false, ...over });
const render = (node: React.JSX.Element): string => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe("BrokenLinksTable", () => {
  it("says so when there is nothing broken", () => {
    expect(render(<BrokenLinksTable projectId="shop" view={view({})} />)).toContain("No broken links");
  });

  it("lists each page that opens in the reader and what it links to, as plain text", () => {
    const html = render(
      <BrokenLinksTable
        projectId="shop"
        view={view({ links: [{ from: "20-spaces/team/db.md", target: "../gone/page.md" }, { from: "notes/a b.md", target: '<img src=x onerror="alert(1)">.md' }] })}
      />,
    );
    expect(html).toContain('href="/wiki/20-spaces/team/db.md?project=shop"');
    expect(html).toContain('href="/wiki/notes/a%20b.md?project=shop"');
    expect(html).toContain("../gone/page.md");
    expect(html).toContain("2 broken links at aaaaaaaaaaaa on main.");
    // The target is text, whatever it holds: escaped, and not a link.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain('href="../gone/page.md"');
  });

  it("says when the report stopped at its limit", () => {
    const html = render(<BrokenLinksTable projectId="shop" view={view({ links: [{ from: "a.md", target: "b.md" }], truncated: true })} />);
    expect(html).toContain("1 broken link at");
    expect(html).toContain("there may be more");
  });
});

describe("BrokenLinksPanel", () => {
  it("shows the title and a loading state before the report arrives", () => {
    const html = render(<BrokenLinksPanel projectId="shop" />);
    expect(html).toContain("Broken links");
    expect(html).toContain('aria-label="Loading"');
  });
});
