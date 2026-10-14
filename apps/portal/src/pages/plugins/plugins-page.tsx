// Plugins — the marketplace (Administration → Plugins, ADR-0035): every plugin the installation
// offers as a card with what it carries. A plugin is a whole capability in the Claude plugin
// format (commands, agents, skills, workflows, scripts, hooks); the card opens its page.

import { Blocks, Bot } from "lucide-react";
import { Link } from "react-router-dom";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Loaded } from "@/components/loaded";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { COMPONENT_KINDS, pluginsApi, type PluginSummary } from "@/lib/api/plugins";
import { useLoader } from "@/lib/use-loader";
import { PluginsInsights } from "./plugins-insights";

const AUDIENCE_LABEL = { runtime: "Runs in Kintsugi jobs", member: "Runs in members' harnesses" } as const;

export function PluginsPage(): React.JSX.Element {
  const plugins = useLoader("plugins", () => pluginsApi.list());
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Administration", "Plugins"]} />
      <PageHeading
        title="Plugins"
        description="The marketplace of Kintsugi: each plugin is a whole capability — the commands a person starts, the workflows, agents, scripts and hooks that run behind them — in the Claude plugin format."
      />
      <Loaded loader={plugins} rows={4}>
        {(items) => (
          <div className="flex flex-col gap-4">
            <PluginsInsights plugins={items} />
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((plugin) => (
                <PluginCard key={plugin.name} plugin={plugin} />
              ))}
            </div>
          </div>
        )}
      </Loaded>
      <Card className="flex items-center gap-3 p-3">
        <Bot className="size-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-text">Custom agents, shared skills and model bindings</p>
          <p className="text-[12px] text-text-muted">The Agent Builder is moving into the plugin editor; until then it keeps the installation&apos;s own agents and the model bound to each.</p>
        </div>
        <Link to="/plugins/builder" className="shrink-0 text-[13px] text-text-secondary hover:text-text hover:underline">
          Open Agent Builder
        </Link>
      </Card>
    </div>
  );
}

function PluginCard({ plugin }: { plugin: PluginSummary }): React.JSX.Element {
  return (
    <Link to={`/plugins/${encodeURIComponent(plugin.name)}`} className="rounded-xl focus-visible:outline-none focus-visible:[box-shadow:var(--ds-focus-ring)]">
      <Card className="flex h-full flex-col gap-3 transition-shadow hover:shadow-[var(--shadow-card-hover,0_2px_8px_rgba(0,0,0,0.08))]">
        <div className="flex items-start gap-3">
          <Blocks className="mt-0.5 size-5 shrink-0 text-text-secondary" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {plugin.title}
              <Badge>Built-in</Badge>
              <span className="font-mono text-[12px] font-normal text-text-muted">v{plugin.version}</span>
            </CardTitle>
            <CardDescription>{AUDIENCE_LABEL[plugin.audience]}</CardDescription>
          </div>
        </div>
        <p className="text-[13px] text-text-secondary">{plugin.description}</p>
        <ul className="mt-auto flex flex-wrap gap-1.5" aria-label="What the plugin carries">
          {COMPONENT_KINDS.filter(({ kind }) => (plugin.counts[kind] ?? 0) > 0).map(({ kind, label, plural }) => {
            const count = plugin.counts[kind] ?? 0;
            return (
              <li key={kind} className="rounded-[var(--geist-pill-radius)] px-2 py-0.5 text-[12px] text-text-secondary shadow-border">
                {count} {count === 1 ? label.toLowerCase() : plural.toLowerCase()}
              </li>
            );
          })}
        </ul>
      </Card>
    </Link>
  );
}
