import { Breadcrumbs } from "../components/breadcrumbs";
import { AreaCard, type AreaCardProps } from "../components/area-card";

/** Functional areas C1–C5 (docs/architecture/05-building-block-view.md). */
const AREAS = [
  {
    title: "C1 · Agent Observability",
    description: "Runtime job traces (tool calls, tokens, cost, outputs), session replay, normalized member-harness activity.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "C2 · Delivery Dashboard",
    description: "Progress by phase / wave / work item, burn-down, gate status.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "C3 · AI Metrics",
    description: "AI share, rework and review metrics computed from harness activity, artifact provenance and the tracker.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "C4 · Cost & FinOps",
    description: "Runtime LLM cost by project / agent / model, harness usage and licenses, to-be cloud cost.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "C5 · Target System Health",
    description: "Health and incidents of the migrated system (P6–P7).",
    status: "not implemented yet",
    tone: "muted",
  },
] as const satisfies ReadonlyArray<AreaCardProps>;

export function MonitoringPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Monitoring"]} />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AREAS.map((area) => (
          <AreaCard key={area.title} {...area} />
        ))}
      </section>
    </div>
  );
}
