// The inbox: what changed on the pages the person watches, comments on them and mentions of them, newest first. A click
// opens the page in its project and marks the notification read; Mark all read clears the bell. The API leaves out
// notifications of a project the person can no longer open.

import { Bell, BellRing } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Loaded } from "@/components/loaded";
import { StickyHeader } from "@/components/sticky-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { notificationsApi } from "@/lib/api/notifications";
import { formatRelative } from "@/lib/format";
import { type NotificationItem, notificationLink, notificationText } from "@/lib/notifications";
import { useLoader } from "@/lib/use-loader";
import { cn } from "@/lib/utils";

export function InboxPage(): React.JSX.Element {
  const navigate = useNavigate();
  const inbox = useLoader("notifications/list", () => notificationsApi.list({ limit: 50 }), { live: ["notifications"] });

  const open = async (item: NotificationItem): Promise<void> => {
    if (!item.read) await notificationsApi.markRead([item.id]).catch(() => undefined);
    void navigate(notificationLink(item));
  };

  return (
    <div className="flex flex-col gap-4">
      <StickyHeader className="flex flex-wrap items-center justify-between gap-2">
        <Breadcrumbs items={["Inbox"]} />
        <Button
          size="small"
          disabled={(inbox.data?.unread ?? 0) === 0}
          onClick={() => void notificationsApi.markAllRead().then(() => inbox.reload())}
        >
          Mark all read
        </Button>
      </StickyHeader>
      <Loaded loader={inbox} rows={4}>
        {(list) =>
          list.items.length === 0 ? (
            <Card>
              <EmptyState icon={Bell} title="Nothing in your inbox" description="Watch a page, a folder or a space of a wiki, and what changes there, a comment on it or a mention of you is listed here." />
            </Card>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {list.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void open(item)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-[var(--geist-radius)] p-3 text-left shadow-border hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]",
                      !item.read && "bg-recessed",
                    )}
                  >
                    {item.read ? <Bell className="mt-0.5 size-4 shrink-0 text-text-muted" strokeWidth={1.5} /> : <BellRing className="mt-0.5 size-4 shrink-0 text-text" strokeWidth={1.75} />}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={cn("text-[13px]", item.read ? "text-text-secondary" : "font-medium text-text")}>{notificationText(item)}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
                        <span>{item.projectName}</span>
                        <time dateTime={item.at}>{formatRelative(item.at)}</time>
                        {item.read ? null : <span className="rounded-full bg-hover px-1.5 py-px text-text-secondary">new</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      <p className="text-[12px] text-text-muted">
        <Link to="/wiki" className="text-accent hover:underline">
          Go to the wiki
        </Link>{" "}
        to watch a page, a folder or a space.
      </p>
    </div>
  );
}
