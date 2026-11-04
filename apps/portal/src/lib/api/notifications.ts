// A person's notifications (`/api/notifications`): what changed on the pages they watch, comments on them and mentions of them.
// The API answers only for the person who asks, and leaves out what belongs to a project they can no longer open.

import { apiGet, apiSend } from "../api";
import type { NotificationList } from "../notifications";

export const notificationsApi = {
  list: (options: { unread?: boolean; limit?: number; before?: string } = {}): Promise<NotificationList> => {
    const query = new URLSearchParams();
    if (options.unread === true) query.set("unread", "true");
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.before !== undefined) query.set("before", options.before);
    const text = query.toString();
    return apiGet(`/api/notifications${text === "" ? "" : `?${text}`}`);
  },

  /** How many are not read: what the bell shows. */
  unread: (): Promise<{ unread: number }> => apiGet("/api/notifications/unread-count"),

  markRead: (ids: readonly string[]): Promise<void> => apiSend("/api/notifications/read", "POST", { ids }),

  markAllRead: (): Promise<void> => apiSend("/api/notifications/read", "POST", { all: true }),
};
