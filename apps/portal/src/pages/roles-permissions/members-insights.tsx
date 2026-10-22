// What sits around the members table, kept small: a one-line summary above it, and an "Access
// overview" below it, closed until asked for, with how the members split over the roles, how many
// permissions each role carries and which permission groups each role covers. The table is the page.

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { BarList, Donut, Heatmap } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { StatusDot } from "@/components/ui/status-dot";
import { identityApi, type RoleRecord, type UserRecord } from "@/lib/api/identity";
import { cn } from "@/lib/utils";
import { useLoader } from "@/lib/use-loader";
import { countBy, formatCount, segmentsOf } from "../delivery/results/results-format";
import { Section } from "../delivery/results/results-parts";

const plural = (count: number, noun: string): string => `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;

/** One line: who can sign in, how many roles there are and who has no sub-role. */
export function MembersSummary({ users, roles }: { users: UserRecord[]; roles: RoleRecord[] }): React.JSX.Element | null {
  if (users.length === 0 && roles.length === 0) return null;
  const enabled = users.filter((user) => user.enabled).length;
  const disabled = users.length - enabled;
  const primary = roles.filter((role) => role.kind === "primary").length;
  const roleKind = new Map(roles.map((role) => [role.id, role.kind]));
  const withoutSub = users.filter((user) => user.roleIds.every((id) => roleKind.get(id) !== "sub")).length;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-text-secondary tabular-nums">
      <span>
        <span className="font-medium text-text">{plural(users.length, "member")}</span> · {enabled} can sign in
      </span>
      {disabled === 0 ? null : (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone="orange" className="size-2" />
          {disabled} disabled
        </span>
      )}
      <span>
        {plural(roles.length, "role")} ({primary} primary, {roles.length - primary} sub-role{roles.length - primary === 1 ? "" : "s"})
      </span>
      {withoutSub === 0 ? null : <span>{withoutSub} with a primary role only</span>}
    </p>
  );
}

/** The charts, closed by default: they are context for the table, not the work of this page. */
export function AccessOverview({ users, roles }: { users: UserRecord[]; roles: RoleRecord[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (users.length === 0 && roles.length === 0) return null;
  return (
    <section className="rounded-xl bg-surface shadow-border-medium">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-[13px] font-medium text-text hover:bg-hover focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]"
      >
        <ChevronRight className={cn("size-4 text-text-muted transition-transform", open && "rotate-90")} strokeWidth={1.75} />
        Access overview
        <span className="text-[12px] font-normal text-text-muted">members by role, permissions per role, permission groups</span>
      </button>
      {open ? <AccessCharts users={users} roles={roles} /> : null}
    </section>
  );
}

function AccessCharts({ users, roles }: { users: UserRecord[]; roles: RoleRecord[] }): React.JSX.Element {
  const permissions = useLoader("members-insight-permissions", identityApi.permissions);
  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const memberRoles = countBy(users.flatMap((user) => user.roleIds), (id) => roleName.get(id) ?? id);
  const groups = [...new Set((permissions.data ?? []).map((permission) => permission.group))].sort();
  const groupOf = new Map((permissions.data ?? []).map((permission) => [permission.code, permission.group]));
  const heatRoles = roles.filter((role) => role.permissions.length > 0).slice(0, 8);
  const grid = groups.map((group) => heatRoles.map((role) => role.permissions.filter((code) => groupOf.get(code) === group).length));
  return (
    <div className="flex flex-col gap-4 p-4 pt-1">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="Members by role" description="A member counts under each role they hold." className="xl:col-span-2">
          {memberRoles.length === 0 ? <p className="text-[12px] text-text-muted">No member holds a role yet.</p> : <Donut segments={segmentsOf(memberRoles)} format={formatCount} center={formatCount(users.length)} caption="members" />}
        </Section>
        <Section title="Permissions per role" description="How much each role may do." className="xl:col-span-3">
          <BarList format={formatCount} color={CHART_COLOR.purple} rows={[...roles].sort((a, b) => b.permissions.length - a.permissions.length).slice(0, 10).map((role) => ({ key: role.id, label: role.name, value: role.permissions.length, note: role.kind === "primary" ? "primary" : "sub-role" }))} />
        </Section>
      </div>
      {groups.length === 0 || heatRoles.length === 0 ? null : (
        <Section title="Permission groups by role" description="How many permissions of each group a role is granted: darker cells grant more.">
          <Heatmap rows={groups} columns={heatRoles.map((role) => role.name)} values={grid} color={CHART_COLOR.purple} />
        </Section>
      )}
    </div>
  );
}
