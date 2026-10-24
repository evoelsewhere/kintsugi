// Monitoring → Members: what each member's connections did in one project (ADR-0069). The summary counts events by
// kind and plugin over the last 30 days; the list below is the records themselves, newest first. A record is a name,
// a short summary and a few scalars, never document content.

import { RefreshCw, Users } from "lucide-react";
import { useState } from "react";
import { Loaded } from "@/components/loaded";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { memberActivityApi } from "@/lib/api/member-plugins";
import { projectsApi } from "@/lib/api/projects";
import { formatDateTime, formatRelative } from "@/lib/format";
import { activityLine } from "@/lib/member-activity";
import { useLoader } from "@/lib/use-loader";

const PAGE_SIZE = 25;

const counts = (values: Record<string, number>): string =>
  Object.entries(values).sort(([, a], [, b]) => b - a).map(([name, count]) => `${name} ${count}`).join(" · ") || "—";

export function MembersView(): React.JSX.Element {
  const projects = useLoader("projects", projectsApi.list);
  const [chosen, setChosen] = useState("");
  const projectId = chosen !== "" ? chosen : (projects.data?.[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [offset, setOffset] = useState(0);
  const summary = useLoader(`members/summary/${projectId}`, () => (projectId === "" ? Promise.resolve(undefined) : memberActivityApi.summary(projectId)));
  const activity = useLoader(`members/activity/${projectId}/${userId}/${offset}`, () => (projectId === "" ? Promise.resolve(undefined) : memberActivityApi.list(projectId, { userId, limit: PAGE_SIZE, offset })));

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex-wrap px-4 pt-3">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>What each member's connections did in the project over the last 30 days: plugin downloads, document reads, what plugin commands used (tokens, turns, time) and what plugins recorded.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-56">
              <Select value={projectId} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, hint: project.id }))} onChange={(value) => { setChosen(value); setUserId(""); setOffset(0); }} />
            </div>
            <Button size="icon" variant="ghost" aria-label="Refresh members" onClick={() => { void summary.reload(); void activity.reload(); }}><RefreshCw className="size-4" /></Button>
          </div>
        </CardHeader>
        <div className="mt-2">
          <Loaded loader={summary} rows={3}>
            {(data) => data === undefined || data.members.length === 0 ? (
              <EmptyState icon={Users} title="No member activity yet" description="Activity appears when a member connects a coding agent to this project, installs a plugin or a plugin records something." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="text-[11px] tracking-wide text-text-muted uppercase">
                    <tr><th className="px-4 py-1.5 font-normal">Member</th><th className="px-2 py-1.5 font-normal">Last seen</th><th className="px-2 py-1.5 font-normal">Events</th><th className="px-2 py-1.5 font-normal">Plugins</th><th className="px-4 py-1.5 font-normal">Kinds</th></tr>
                  </thead>
                  <tbody>
                    {data.members.map((member) => (
                      <tr key={member.userId} className="align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
                        <td className="px-4 py-2.5"><button type="button" className="text-left text-text hover:underline" onClick={() => { setUserId(member.userId); setOffset(0); }}>{member.displayName === "" ? member.username : member.displayName}</button><p className="text-[11px] text-text-muted">{member.username}</p></td>
                        <td className="px-2 py-2.5 text-text-secondary" title={formatDateTime(member.lastSeenAt)}>{formatRelative(member.lastSeenAt)}</td>
                        <td className="px-2 py-2.5 text-text-secondary">{member.events}</td>
                        <td className="px-2 py-2.5 text-text-secondary">{counts(member.plugins)}</td>
                        <td className="px-4 py-2.5 text-text-secondary">{counts(member.kinds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Loaded>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-4 pt-3">
          <div>
            <CardTitle>Activity</CardTitle>
            <CardDescription>{userId === "" ? "All members, newest first." : "One member, newest first."}</CardDescription>
          </div>
          {userId === "" ? null : <Button size="small" variant="ghost" onClick={() => { setUserId(""); setOffset(0); }}>All members</Button>}
        </CardHeader>
        <div className="mt-2">
          <Loaded loader={activity} rows={4}>
            {(page) => page === undefined || page.items.length === 0 ? (
              <p className="px-4 pb-3 text-[13px] text-text-muted">No records.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[13px]">
                    <thead className="text-[11px] tracking-wide text-text-muted uppercase">
                      <tr><th className="px-4 py-1.5 font-normal">When</th><th className="px-2 py-1.5 font-normal">Member</th><th className="px-2 py-1.5 font-normal">Plugin</th><th className="px-2 py-1.5 font-normal">Kind</th><th className="px-4 py-1.5 font-normal">Summary</th></tr>
                    </thead>
                    <tbody>
                      {page.items.map((record) => (
                        <tr key={record.id} className="align-top [box-shadow:0_-1px_0_rgba(0,0,0,0.06)]">
                          <td className="px-4 py-2 whitespace-nowrap text-text-secondary">{formatDateTime(record.at)}</td>
                          <td className="px-2 py-2 text-text">{record.username}</td>
                          <td className="px-2 py-2 text-text-secondary">{record.pluginName ?? "—"}{record.harness === undefined ? "" : ` · ${record.harness}`}</td>
                          <td className="px-2 py-2 text-text-secondary">{record.kind}</td>
                          <td className="max-w-[420px] truncate px-4 py-2 text-text-secondary" title={activityLine(record)}>{activityLine(record)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {page.total > page.limit ? (
                  <div className="flex items-center justify-end gap-2 px-4 py-2 text-[12px] text-text-muted">
                    <span>{offset + 1}–{Math.min(offset + page.limit, page.total)} of {page.total}</span>
                    <Button size="small" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - page.limit))}>Previous</Button>
                    <Button size="small" variant="ghost" disabled={offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)}>Next</Button>
                  </div>
                ) : null}
              </>
            )}
          </Loaded>
        </div>
      </Card>
    </div>
  );
}
