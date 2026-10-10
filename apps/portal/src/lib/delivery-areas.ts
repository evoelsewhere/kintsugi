import type { AreaCardProps } from "../components/area-card";

export interface DeliveryArea extends AreaCardProps {
  id: string;
}

export const DELIVERY_AREAS = [
  {
    id: "portfolio-assessment",
    title: "Portfolio & Assessment",
    description: "Inventory and unit files, dependencies, weighted scorecard, 7R recommendation, wave planning.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    id: "architecture-studio",
    title: "Architecture Studio",
    description: "AS-IS vs TO-BE architecture, ADRs, gap list, co-existence strategy, POC plan, ARB review.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    id: "factory-setup",
    title: "Factory Setup",
    description: "Base source, IaC, CI/CD; agent plugins and task-pack templates; gate-reviewer rules; pilot runs.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    id: "migration-workbench",
    title: "Migration Workbench",
    description: "Board of work items × stages, task packs, assignment, PR tracking, design ↔ code sync.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    id: "verification",
    title: "Verification",
    description: "Test generation, compare tests, coverage, non-functional tests, rehearsal, UAT tracking.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    id: "cutover",
    title: "Cutover",
    description: "Readiness checklist, runbook, go / no-go, decommissioning.",
    status: "not implemented yet",
    tone: "muted",
  },
  {
    id: "hypercare-operate",
    title: "Hypercare & Operate",
    description: "Incidents, user manual / training generation, end-user chatbot, KB handover.",
    status: "not implemented yet",
    tone: "muted",
  },
] as const satisfies ReadonlyArray<DeliveryArea>;
