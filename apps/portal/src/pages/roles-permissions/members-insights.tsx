// The figures above the members table: who is enabled, how the members split over the roles,
// how many permissions each role carries and which permission groups each role covers.

import { BarList, Donut, Heatmap } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { identityApi, type RoleRecord, type UserRecord } from "@/lib/api/identity";
import { useLoader } from "@/lib/use-loader";
import { countBy, formatCount, segmentsOf } from "../delivery/results/results-format";
import { Kpi, KpiRow, Section } from "../delivery/results/results-parts";

export function MembersInsights({ users, roles }: { users: UserRecord[]; roles: RoleRecord[] }): React.JSX.Element | null {
  const permissions = useLoader("members-insight-permissions", identityApi.permissions);
  if (users.length === 0 && roles.length === 0) return null;
  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const primary = roles.filter((role) => role.kind === "primary");
  const enabled = users.filter((user) => user.enabled).length;
  const memberRoles = countBy(users.flatMap((user) => user.roleIds), (id) => roleName.get(id) ?? id);
  const groups = [...new Set((permissions.data ?? []).map((permission) => permission.group))].sort();
  const groupOf = new Map((permissions.data ?? []).map((permission) => [permission.code, permission.group]));
  const heatRoles = roles.filter((role) => role.permissions.length > 0).slice(0, 8);
  const grid = groups.map((group) => heatRoles.map((role) => role.permissions.filter((code) => groupOf.get(code) === group).length));
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Members" value={users.length} hint={`${enabled} enabled`} />
        <Kpi label="Disabled" value={users.length - enabled} tone={users.length - enabled > 0 ? "orange" : undefined} hint="cannot sign in" />
        <Kpi label="Roles" value={roles.length} hint={`${primary.length} primary · ${roles.length - primary.length} sub-roles`} />
        <Kpi label="Permissions" value={permissions.data?.length} hint={`${groups.length} groups`} />
        <Kpi label="Without a sub-role" value={users.filter((user) => user.roleIds.every((id) => roles.find((role) => role.id === id)?.kind !== "sub")).length} hint="primary role only" />
        <Kpi label="Most permissions" value={undefined} display={[...roles].sort((a, b) => b.permissions.length - a.permissions.length)[0]?.name ?? "—"} hint={`${[...roles].sort((a, b) => b.permissions.length - a.permissions.length)[0]?.permissions.length ?? 0} granted`} />
      </KpiRow>
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
