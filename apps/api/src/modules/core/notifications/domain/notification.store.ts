// Port of the notification store. The Postgres adapter is in infrastructure.

import type { NewNotification, NotificationRow } from "./notification.js";

export interface UserName {
  username: string;
  displayName: string;
}

export abstract class NotificationStore {
  /** Stores a notification once (by its dedupe key) and tells the person's streams that theirs changed; false when it existed already. */
  abstract insert(notification: NewNotification): Promise<boolean>;
  /** A person's notifications of the given projects, newest first. */
  abstract list(userId: string, projectIds: readonly string[], options: { unread: boolean; limit: number; before: string | undefined }): Promise<NotificationRow[]>;
  abstract countUnread(userId: string, projectIds: readonly string[]): Promise<number>;
  /** Marks the person's own notifications of the given projects read (those ids, or all); returns how many changed. */
  abstract markRead(userId: string, projectIds: readonly string[], target: { ids: readonly string[] } | { all: true }): Promise<number>;
  abstract users(ids: readonly string[]): Promise<Map<string, UserName>>;
}
