// Notifications (ADR-0099 decision 3): what reaches a person about the wiki they watch. A row holds references only: the
// kind, who did it, which page and commit or comment. Never the text of a page or a comment, and never a name or a path:
// the inbox looks those up when it is read, and only for a person who may still open the project.

export const NOTIFICATION_KINDS = ["wiki-page-changed", "wiki-comment", "wiki-mention"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The only keys a `subject` may have, each an id or a commit. */
export const SUBJECT_KEYS = ["pageKey", "commit", "commentId", "actorId"] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];
export type NotificationSubject = Partial<Record<SubjectKey, string>>;

/** The longest value of a subject key: ids and commits are short, a longer one is text smuggled in. */
export const SUBJECT_VALUE_MAX = 200;

/** A notification to make; `dedupeKey` makes it once however many times it is asked for. */
export interface NewNotification {
  userId: string;
  projectId: string;
  kind: NotificationKind;
  subject: NotificationSubject;
  dedupeKey: string;
}

export interface NotificationRow {
  id: string;
  userId: string;
  projectId: string;
  kind: NotificationKind;
  subject: NotificationSubject;
  createdAt: string;
  readAt: string | null;
}

/**
 * The subject as stored: only the allowed keys, each a short string. Anything else (a `title`, a `path`, a body, a nested
 * object) is refused rather than dropped, so a caller that tries to put page text into a notification finds out.
 */
export function checkSubject(subject: Readonly<Record<string, unknown>>): NotificationSubject {
  const checked: NotificationSubject = {};
  for (const [key, value] of Object.entries(subject)) {
    if (!(SUBJECT_KEYS as readonly string[]).includes(key)) throw new Error(`A notification subject has no "${key}": it holds ids only (${SUBJECT_KEYS.join(", ")})`);
    if (typeof value !== "string" || value === "" || value.length > SUBJECT_VALUE_MAX) throw new Error(`The subject's "${key}" must be a short non-empty string`);
    checked[key as SubjectKey] = value;
  }
  return checked;
}

/** What the inbox shows of a notification, names looked up at read time. */
export interface NotificationView {
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
  items: NotificationView[];
  unread: number;
}
