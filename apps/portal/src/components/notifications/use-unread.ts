// How many notifications the person has not read: the number on the bell. It is read again when the API says the person's
// notifications changed (the live topic) and when the tab shows again; an API without the route, or a refusal, counts none.

import { notificationsApi } from "@/lib/api/notifications";
import { useLoader } from "@/lib/use-loader";

export function useUnreadCount(): number {
  const unread = useLoader("notifications/unread", () => notificationsApi.unread().then((answer) => answer.unread).catch(() => 0), { live: ["notifications"] });
  return unread.data ?? 0;
}
