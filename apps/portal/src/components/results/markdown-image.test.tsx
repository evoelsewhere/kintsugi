// How a rendered page shows its images. Rendered to markup: the portal has no DOM test environment.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// The renderer imports the document links, which import the API client, which reads localStorage when it loads.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
});

import Markdown from "./markdown";
import { MarkdownImagesContext } from "./use-markdown-images";

const PAGE = "20-spaces/eng/runbooks/db-failover.md";
const wiki = { projectId: "wiki", commit: "a".repeat(40) };
const render = (text: string, inWiki: boolean): string =>
  renderToStaticMarkup(
    <MarkdownImagesContext.Provider value={inWiki ? wiki : null}>
      <Markdown text={text} path={PAGE} />
    </MarkdownImagesContext.Provider>,
  );

describe("images in a rendered page", () => {
  it("loads an attachment from the attachment route at the page's commit", () => {
    const html = render("![Failover](../_attachments/failover.png)", true);
    expect(html).toContain(`src="/api/projects/wiki/documents/attachment?ref=${"a".repeat(40)}&amp;path=20-spaces%2Feng%2F_attachments%2Ffailover.png"`);
    expect(html).toContain('alt="Failover"');
  });

  it("does not load an image of the web: the alt text is a link that opens in a new tab", () => {
    const html = render("![tracker](https://tracker.example/pixel.png)", true);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
    expect(html).toContain('href="https://tracker.example/pixel.png"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("tracker");
  });

  it("renders only the alt text for a data URL, a file outside _attachments or another type", () => {
    for (const source of ["data:image/png;base64,AAAA", "../diagram.png", "../_attachments/diagram.svg", "javascript:alert(1)"]) {
      const html = render(`![the alt](${source})`, true);
      expect(html).not.toContain("<img");
      expect(html).toContain("the alt");
    }
  });

  it("shows only the alt text of a repository image where the view does not say where its documents are from", () => {
    const html = render("![Failover](../_attachments/failover.png)", false);
    expect(html).not.toContain("<img");
    expect(html).toContain("Failover");
  });
});
