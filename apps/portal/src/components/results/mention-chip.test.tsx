// How a rendered text shows @mentions. Rendered to markup: the portal has no DOM test environment.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// The renderer imports the document links, which import the API client, which reads localStorage when it loads.
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
});

import Markdown from "./markdown";
import { MentionDirectoryContext } from "./use-mentions";

const directory = new Map([["kim", "Kim Nguyen"]]);
const render = (text: string, known = true): string =>
  renderToStaticMarkup(
    <MentionDirectoryContext.Provider value={known ? { displayName: (username) => directory.get(username) } : null}>
      <Markdown text={text} />
    </MentionDirectoryContext.Provider>,
  );

describe("@mentions in a rendered text", () => {
  it("shows a person of the directory as a chip with the display name, and nothing else about them", () => {
    const html = render("Ask @kim about it.");
    expect(html).toContain('data-mention-chip="kim"');
    expect(html).toContain("Kim Nguyen");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("@kim about");
  });

  it("leaves a name the directory does not know as the plain text it was", () => {
    const html = render("Ask @stranger about it.");
    expect(html).not.toContain("data-mention-chip");
    expect(html).toContain("@stranger");
  });

  it("leaves every name plain where no directory was loaded", () => {
    const html = render("Ask @kim", false);
    expect(html).not.toContain("data-mention-chip");
    expect(html).toContain("@kim");
  });

  it("does not make a chip of a name in code, in a code block or in a link, nor of an email address", () => {
    const html = render("`@kim` and\n\n```\n@kim\n```\n\n[@kim](https://example.com) and kim@example.com");
    expect(html).not.toContain("data-mention-chip");
    expect(html).toContain("kim@example.com");
  });

  it("works in a list item, a table cell and bold text", () => {
    const html = render("- @kim\n\n| a |\n|---|\n| @kim |\n\n**@kim**");
    expect(html.match(/data-mention-chip="kim"/g)?.length).toBe(3);
  });
});
