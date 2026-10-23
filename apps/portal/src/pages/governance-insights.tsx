// The charts above the Governance tabs: gates (decisions by status, gate, how long the pending
// ones have waited and how fast the decided ones were decided) and the audit log (actions,
// actors and activity per day). Each reads a recent sample itself, independent of the filters.

import { BarList, Histogram, ShareBar, StackedColumns } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { GATE_COLOR } from "@/components/results/status-colors";
import { governanceApi } from "@/lib/api/governance";
import { formatRelative } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { useNow } from "@/lib/use-now";
import { formatMs } from "@/lib/run-stats";
import { countBy, formatCount, segmentsOf } from "./delivery/results/results-format";
import { Kpi, KpiRow, Section } from "./delivery/results/results-parts";

export function GovernanceInsights({ tab }: { tab: "gates" | "audit" | "restricted" | "telemetry" | "permissions" }): React.JSX.Element | null {
  if (tab === "gates") return <GatesInsights />;
  if (tab === "audit") return <AuditInsights />;
  return null;
}

const WAIT_BUCKETS: Array<{ label: string; below: number }> = [
  { label: "<1 h", below: 3600e3 },
  { label: "<1 d", below: 86400e3 },
  { label: "<3 d", below: 3 * 86400e3 },
  { label: "<7 d", below: 7 * 86400e3 },
  { label: "older", below: Number.POSITIVE_INFINITY },
];

function GatesInsights(): React.JSX.Element | null {
  const gates = useLoader("governance-insight-gates", async () => (await governanceApi.gates({ limit: 200 })).items, { live: ["gates"] });
  const now = useNow(false);
  if (gates.data === undefined) return null;
  const list = gates.data;
  const pending = list.filter((gate) => gate.status === "pending");
  const decided = list.filter((gate) => gate.decidedAt !== undefined);
  const latencies = decided.map((gate) => new Date(gate.decidedAt ?? 0).getTime() - new Date(gate.requestedAt).getTime()).sort((a, b) => a - b);
  const median = latencies.length === 0 ? undefined : latencies[Math.floor(latencies.length / 2)];
  const oldest = pending.map((gate) => gate.requestedAt).sort()[0];
  const counts = WAIT_BUCKETS.map(() => 0);
  for (const gate of pending) {
    const index = WAIT_BUCKETS.findIndex((bucket) => now - new Date(gate.requestedAt).getTime() < bucket.below);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const byKey = countBy(list, (gate) => gate.gateKey).slice(0, 8);
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Pending" value={pending.length} tone={pending.length > 0 ? "orange" : "green"} hint={oldest === undefined ? "nothing waiting" : `oldest ${formatRelative(oldest)}`} />
        <Kpi label="Approved" value={list.filter((gate) => gate.status === "approved").length} tone="green" />
        <Kpi label="Waived" value={list.filter((gate) => gate.status === "waived").length} tone="blue" hint="skipped with a note" />
        <Kpi label="Rejected" value={list.filter((gate) => gate.status === "rejected").length} tone="red" />
        <Kpi label="Median decision time" value={undefined} display={formatMs(median)} hint={`over ${decided.length} decided gates`} />
        <Kpi label="Gates sampled" value={list.length} hint="the latest requests" />
      </KpiRow>
      {list.length === 0 ? null : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Section title="Decisions" description="All gates in the sample by status.">
            <ShareBar segments={segmentsOf(countBy(list, (gate) => gate.status), (key) => GATE_COLOR[key])} format={formatCount} />
          </Section>
          <Section title="Waiting time of pending gates" description="How long they have been waiting for a decision.">
            {pending.length === 0 ? <p className="text-[12px] text-text-muted">Nothing is waiting.</p> : <Histogram buckets={WAIT_BUCKETS.map((bucket, index) => ({ label: bucket.label, value: counts[index] ?? 0 }))} format={formatCount} color={CHART_COLOR.orange} height={72} />}
          </Section>
          <Section title="By gate" description="Requests per gate key.">
            <BarList format={formatCount} color={CHART_COLOR.purple} rows={byKey.map((entry) => ({ key: entry.key, label: entry.key, value: entry.count, mono: true }))} />
          </Section>
        </div>
      )}
    </div>
  );
}

function AuditInsights(): React.JSX.Element | null {
  const audit = useLoader("governance-insight-audit", async () => (await governanceApi.audit({ limit: 200 })).items, { live: ["audit"] });
  const now = useNow(false);
  if (audit.data === undefined) return null;
  const list = audit.data;
  const actions = countBy(list, (entry) => entry.action).slice(0, 8);
  const actors = countBy(list, (entry) => entry.actor);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => new Date(today.getTime() - (13 - index) * 86400000));
  const top = actions.slice(0, 4).map((entry) => entry.key);
  const palette = [CHART_COLOR.blue, CHART_COLOR.teal, CHART_COLOR.purple, CHART_COLOR.orange];
  const columns = days.map((day) => {
    const inDay = list.filter((entry) => new Date(entry.at).getTime() >= day.getTime() && new Date(entry.at).getTime() < day.getTime() + 86400000);
    return {
      label: String(day.getDate()),
      title: `${day.toLocaleDateString()}: ${inDay.length} entries`,
      segments: [...top.map((action, index) => ({ label: action, value: inDay.filter((entry) => entry.action === action).length, color: palette[index] ?? CHART_COLOR.muted })), { label: "other", value: inDay.filter((entry) => !top.includes(entry.action)).length, color: CHART_COLOR.muted }],
    };
  });
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Entries sampled" value={list.length} hint="the latest audit entries" />
        <Kpi label="Actions" value={countBy(list, (entry) => entry.action).length} hint="distinct kinds" />
        <Kpi label="Actors" value={actors.length} hint="people who acted" />
        <Kpi label="Restricted reads" value={list.filter((entry) => entry.action === "restricted.read").length} tone={list.some((entry) => entry.action === "restricted.read") ? "orange" : undefined} hint="records opened" />
        <Kpi label="Gate decisions" value={list.filter((entry) => entry.action === "gate.decide").length} />
        <Kpi label="Last entry" value={undefined} display={list[0] === undefined ? "—" : formatRelative(list[0].at)} />
      </KpiRow>
      {list.length === 0 ? null : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Section title="Activity per day" description="Audit entries over the last 14 days, by the most frequent actions." className="xl:col-span-3">
            <StackedColumns columns={columns} legend={[...top.map((action, index) => ({ label: action, color: palette[index] ?? CHART_COLOR.muted })), { label: "other", color: CHART_COLOR.muted }]} />
          </Section>
          <Section title="Actions" description="Entries per action in the sample." className="xl:col-span-2">
            <BarList format={formatCount} rows={actions.map((entry) => ({ key: entry.key, label: entry.key, value: entry.count, mono: true }))} />
          </Section>
        </div>
      )}
    </div>
  );
}
