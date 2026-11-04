// What the portal says about a person's notifications and about the pages, folders and spaces they watch: the shapes the API
// gives (threads/design-wiki-notifications), how a notification reads and where it leads, and which watch applies to a page.
// A notification holds references only; the names are looked up by the API when it is read, and only for a project the
// person can still open.

export type NotificationKind = "wiki-page-changed" | "wiki-comment" | "wiki-mention";

/** One notification as `GET /api/notifications` gives it. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  projectId: string;
  projectName: string;
  page: { key: string; path: string; title: string } | null;
  actor: { username: string; displayName: string };
  commentId?: string;
  at: string;
  read: boolean;
}

export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

/** What happened, in a sentence that starts with who did it. */
export function notificationText(item: Pick<NotificationItem, "kind" | "actor" | "page">): string {
  const who = item.actor.displayName === "" ? item.actor.username : item.actor.displayName;
  const page = item.page === null ? "a page" : `“${item.page.title}”`;
  switch (item.kind) {
    case "wiki-page-changed":
      return `${who} changed ${page}`;
    case "wiki-comment":
      return `${who} commented on ${page}`;
    case "wiki-mention":
      return `${who} mentioned you on ${page}`;
  }
}

/** Where a notification leads: the page in its project, or the wiki of the project when the page is gone. */
export function notificationLink(item: Pick<NotificationItem, "projectId" | "page">): string {
  const project = encodeURIComponent(item.projectId);
  if (item.page === null) return `/wiki?project=${project}`;
  return `/wiki/${item.page.path.split("/").map(encodeURIComponent).join("/")}?project=${project}`;
}

/** The notifications that are not read yet. */
export const unreadOf = (items: readonly NotificationItem[]): NotificationItem[] => items.filter((item) => !item.read);

/** The count the bell shows: nothing for none, and "99+" past ninety-nine. */
export const bellCount = (unread: number): string | undefined => (unread <= 0 ? undefined : unread > 99 ? "99+" : String(unread));

// ---- Watching ----------------------------------------------------------------------------------------------------

export type WatchScope = "page" | "folder" | "space";

/** What the API answers for a page: whether it is watched, and through what when it is not watched directly. */
export interface WatchState {
  /** The person watches this very page. */
  direct: boolean;
  /** The folder or space the page is watched through, when it is not watched directly. */
  via: { scopeKind: "folder" | "space"; target: string } | null;
}

/** The text of the Watch button for a state. */
export function watchLabel(state: WatchState): string {
  if (state.direct) return "Unwatch";
  if (state.via !== null) return `Watching via ${state.via.target}`;
  return "Watch";
}

/** What clicking the button does: unwatching a page watched directly, watching one that is not watched at all, and nothing for one watched through a folder or space (that is changed where it was set). */
export const watchAction = (state: WatchState): "watch" | "unwatch" | "none" => (state.direct ? "unwatch" : state.via !== null ? "none" : "watch");
