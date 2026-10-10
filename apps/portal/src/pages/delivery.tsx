import { Breadcrumbs } from "../components/breadcrumbs";
import { AreaCard, type AreaCardProps } from "../components/area-card";

/** Functional areas B1–B7 (docs/architecture/05-building-block-view.md). */
const AREAS = [
  {
    title: "B1 · Portfolio & Assessment",
    description: "Inventory and unit files, dependencies, weighted scorecard, 7R recommendation, wave planning.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "B2 · Architecture Studio",
    description: "AS-IS vs TO-BE architecture, ADRs, gap list, co-existence strategy, POC plan, ARB review.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "B3 · Factory Setup",
    description: "Base source, IaC, CI/CD; agent plugins and task-pack templates; gate-reviewer rules; pilot runs.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "B4 · Migration Workbench",
    description: "Board of work items × stages, task packs, assignment, PR tracking, design ↔ code sync.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "B5 · Verification",
    description: "Test generation, compare tests, coverage, non-functional tests, rehearsal, UAT tracking.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "B6 · Cutover",
    description: "Readiness checklist, runbook, go / no-go, decommissioning.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "B7 · Hypercare & Operate",
    description: "Incidents, user manual / training generation, end-user chatbot, KB handover.",
    status: "not implemented yet",
    tone: "muted",
  },
] as const satisfies ReadonlyArray<AreaCardProps>;

export function DeliveryPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Delivery"]} />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AREAS.map((area) => (
          <AreaCard key={area.title} {...area} />
        ))}
      </section>
    </div>
  );
}
