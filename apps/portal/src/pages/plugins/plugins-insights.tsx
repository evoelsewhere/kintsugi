// The figures above the plugin cards: how many commands, agents, skills, workflows, scripts and
// hooks the installation carries, and how each plugin splits into them.

import { ShareBar, StackedColumns } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import { COMPONENT_KINDS, type PluginSummary } from "@/lib/api/plugins";
import { countBy, formatCount, segmentsOf } from "../delivery/results/results-format";
import { Kpi, KpiRow, Section } from "../delivery/results/results-parts";

const KIND_COLOR = [CHART_COLOR.blue, CHART_COLOR.teal, CHART_COLOR.purple, CHART_COLOR.orange, CHART_COLOR.green, CHART_COLOR.pink];

export function PluginsInsights({ plugins }: { plugins: PluginSummary[] }): React.JSX.Element | null {
  if (plugins.length === 0) return null;
  const total = (kind: (typeof COMPONENT_KINDS)[number]["kind"]): number => plugins.reduce((sum, plugin) => sum + (plugin.counts[kind] ?? 0), 0);
  const kinds = COMPONENT_KINDS.map((entry, index) => ({ ...entry, color: KIND_COLOR[index] ?? CHART_COLOR.muted, count: total(entry.kind) }));
  const components = kinds.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div className="flex flex-col gap-4">
      <KpiRow>
        <Kpi label="Plugins" value={plugins.length} hint={`${plugins.filter((plugin) => plugin.audience !== "member").length} run in the runtime · ${plugins.filter((plugin) => plugin.audience !== "runtime").length} reach members`} />
        <Kpi label="Components" value={components} hint="across all plugins" />
        <Kpi label="Commands" value={total("command")} hint="started by a person" />
        <Kpi label="Agents" value={total("agent")} hint="runtime or member agents" />
        <Kpi label="Skills" value={total("skill")} hint="Agent Skills" />
        <Kpi label="Workflows and scripts" value={total("workflow") + total("script")} hint={`${total("hook")} hooks`} />
      </KpiRow>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Section title="What the plugins carry" description="Components per plugin, by kind." className="xl:col-span-3">
          <StackedColumns
            height={110}
            columns={plugins.map((plugin) => ({
              label: plugin.title,
              title: `${plugin.title}: ${kinds.filter((entry) => (plugin.counts[entry.kind] ?? 0) > 0).map((entry) => `${plugin.counts[entry.kind]} ${entry.plural.toLowerCase()}`).join(", ")}`,
              segments: kinds.map((entry) => ({ label: entry.plural, value: plugin.counts[entry.kind] ?? 0, color: entry.color })),
            }))}
            legend={kinds.filter((entry) => entry.count > 0).map((entry) => ({ label: `${entry.plural} · ${entry.count}`, color: entry.color }))}
          />
        </Section>
        <Section title="Who runs them" description="Plugins by the side that runs them." className="xl:col-span-2">
          <div className="flex flex-col gap-4">
            <ShareBar segments={segmentsOf(countBy(plugins, (plugin) => (plugin.audience === "runtime" ? "Kintsugi runtime" : plugin.audience === "both" ? "Runtime and members" : "Members' harnesses")))} format={formatCount} />
            <ShareBar segments={kinds.filter((entry) => entry.count > 0).map((entry) => ({ label: entry.plural, value: entry.count, color: entry.color }))} format={formatCount} />
          </div>
        </Section>
      </div>
    </div>
  );
}
