import { describe, expect, it } from "vitest";
import { bellCount, type NotificationItem, notificationLink, notificationText, unreadOf, watchAction, watchLabel } from "./notifications";

const item = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "n1",
  kind: "wiki-page-changed",
  projectId: "wiki",
  projectName: "Wiki",
  page: { key: "PAGE-ENG-0012", path: "20-spaces/eng/runbooks/cache-flush.md", title: "Cache flush" },
  actor: { username: "kim", displayName: "Kim" },
  at: "2026-11-05T03:00:00Z",
  read: false,
  ...over,
});

describe("how a notification reads", () => {
  it("starts with who did it and names the page", () => {
    expect(notificationText(item())).toBe("Kim changed “Cache flush”");
    expect(notificationText(item({ kind: "wiki-comment" }))).toBe("Kim commented on “Cache flush”");
    expect(notificationText(item({ kind: "wiki-mention" }))).toBe("Kim mentioned you on “Cache flush”");
  });

  it("falls back to the username without a display name, and says 'a page' when the page is gone", () => {
    expect(notificationText(item({ actor: { username: "kim", displayName: "" } }))).toBe("kim changed “Cache flush”");
    expect(notificationText(item({ page: null }))).toBe("Kim changed a page");
  });
});

describe("where a notification leads", () => {
  it("opens the page in its own project, each segment encoded", () => {
    expect(notificationLink(item())).toBe("/wiki/20-spaces/eng/runbooks/cache-flush.md?project=wiki");
    expect(notificationLink(item({ projectId: "my project", page: { key: "k", path: "notes/my page.md", title: "t" } }))).toBe("/wiki/notes/my%20page.md?project=my%20project");
  });

  it("opens the wiki of the project when the page is gone", () => {
    expect(notificationLink(item({ page: null }))).toBe("/wiki?project=wiki");
  });
});

describe("the bell", () => {
  it("shows nothing for none and 99+ for more than ninety-nine", () => {
    expect(bellCount(0)).toBeUndefined();
    expect(bellCount(-1)).toBeUndefined();
    expect(bellCount(1)).toBe("1");
    expect(bellCount(99)).toBe("99");
    expect(bellCount(100)).toBe("99+");
  });

  it("keeps the notifications that are not read", () => {
    expect(unreadOf([item({ id: "a" }), item({ id: "b", read: true }), item({ id: "c" })]).map((entry) => entry.id)).toEqual(["a", "c"]);
  });
});

describe("watching", () => {
  it("offers Watch, Unwatch, or says through what the page is watched", () => {
    expect(watchLabel({ direct: false, via: null })).toBe("Watch");
    expect(watchLabel({ direct: true, via: null })).toBe("Unwatch");
    expect(watchLabel({ direct: false, via: { scopeKind: "folder", target: "20-spaces/eng" } })).toBe("Watching via 20-spaces/eng");
    expect(watchLabel({ direct: false, via: { scopeKind: "space", target: "ENG" } })).toBe("Watching via ENG");
  });

  it("changes only a watch that was set on the page itself", () => {
    expect(watchAction({ direct: false, via: null })).toBe("watch");
    expect(watchAction({ direct: true, via: null })).toBe("unwatch");
    expect(watchAction({ direct: true, via: { scopeKind: "space", target: "ENG" } })).toBe("unwatch");
    expect(watchAction({ direct: false, via: { scopeKind: "space", target: "ENG" } })).toBe("none");
  });
});
