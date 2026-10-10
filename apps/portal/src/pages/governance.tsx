import { Breadcrumbs } from "../components/breadcrumbs";
import { AreaCard, type AreaCardProps } from "../components/area-card";

/** Functional areas D1–D6 (docs/architecture/05-building-block-view.md). */
const AREAS = [
  {
    title: "D1 · Policy Engine",
    description: "Runtime policy (model allowlist, tools, network, budget), HarnessPolicy distribution, data residency, PII / secret redaction.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "D2 · Quality Gates",
    description: "Gates G0–G6 plus per-work-item gates, defined in kintsugi.yaml (Git).",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "D3 · Review & Approval",
    description: "ARB, design review, PR approval, go / no-go, with SLAs.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "D4 · Audit & Traceability",
    description: "Append-only audit (hash chain), requirement → design → code → test traceability, AI provenance.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    title: "D5 · Risk & Change",
    description: "Risk register, change requests, decision log.",
    status: "not implemented yet",
    tone: "muted",
  },
] as const satisfies ReadonlyArray<AreaCardProps>;

export function GovernancePage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Breadcrumbs items={["Governance"]} />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AREAS.map((area) => (
          <AreaCard key={area.title} {...area} />
        ))}
      </section>
    </div>
  );
}
