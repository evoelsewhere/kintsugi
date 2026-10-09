import { MetricCard } from "../components/metric-card";
import { PageHeader } from "../components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { StatusDot, type StatusTone } from "../components/ui/status-dot";
import { useHealth } from "../lib/use-health";

const METRICS = [
  { title: "Units in flight", value: "24", subtitle: "12 awaiting review · 6 in progress", tone: "green" },
  { title: "Gate status", value: "G3 pending", subtitle: "Prepare factory readiness", tone: "orange" },
  { title: "AI-generated share", value: "38%", subtitle: "Declared via commit trailers", tone: "blue" },
  { title: "Runtime cost (MTD)", value: "$412", subtitle: "pi jobs · 6 runtime agents", tone: "cyan" },
] as const satisfies ReadonlyArray<{ title: string; value: string; subtitle: string; tone: StatusTone }>;

const PIPELINE = [
  { phase: "P0", name: "Mobilize", state: "done", tone: "green-light" },
  { phase: "P1", name: "Discover & Assess", state: "done", tone: "green-light" },
  { phase: "P2", name: "Define To-Be", state: "done", tone: "green-light" },
  { phase: "P3", name: "Prepare Factory", state: "in progress", tone: "orange" },
  { phase: "P4", name: "Migrate", state: "queued", tone: "cyan" },
  { phase: "P5", name: "Verify", state: "not started", tone: "muted" },
  { phase: "P6", name: "Cutover", state: "not started", tone: "muted" },
  { phase: "P7", name: "Hypercare & Operate", state: "not started", tone: "muted" },
] as const satisfies ReadonlyArray<{ phase: string; name: string; state: string; tone: StatusTone }>;

export function OverviewPage(): React.JSX.Element {
  const health = useHealth();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Overview"
        description="Programme health across the delivery pipeline — Mobilize → Discover & Assess → Define To-Be → Prepare Factory → Migrate → Verify → Cutover → Hypercare."
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((metric) => (
          <MetricCard key={metric.title} {...metric} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Delivery pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {PIPELINE.map((row) => (
                <li key={row.phase} className="flex items-center gap-3 text-[14px]">
                  <StatusDot tone={row.tone} />
                  <span className="w-8 font-mono text-text-muted">{row.phase}</span>
                  <span className="text-text">{row.name}</span>
                  <span className="ml-auto text-caption text-text-secondary">{row.state}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-[14px]">
              <li className="flex items-center gap-3">
                <StatusDot tone={health === "up" ? "green" : health === "down" ? "red" : "orange"} />
                <span className="text-text">API</span>
                <span className="ml-auto text-caption text-text-secondary">{health}</span>
              </li>
              <li className="flex items-center gap-3">
                <StatusDot tone="muted" />
                <span className="text-text">Runtime engine</span>
                <span className="ml-auto text-caption text-text-secondary">pi@1.1.0</span>
              </li>
              <li className="flex items-center gap-3">
                <StatusDot tone="muted" />
                <span className="text-text">Portal</span>
                <span className="ml-auto text-caption text-text-secondary">v0.0.0</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
