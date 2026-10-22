// Domain of the portfolio overview: where each application stands in the delivery lifecycle, what a
// person has to decide next and how far the unit catalog is understood. Derived from what the
// API already keeps (projects, runs, the catalog, gates, document writes); nothing is stored.
// Pure types and the derivations.

import type { GateStatus, ItemStatus, Phase } from "@kintsugi/domain";

/** The gate that closes a phase (docs/methodology/delivery-pipeline.md); later phases are not tracked yet. */
export const PHASE_GATE: Partial<Record<Phase, string>> = { mobilize: "G0", "discover-assess": "G1", "define-to-be": "G2" };

/** Units listed as the riskiest still to analyse. */
export const RISKIEST_LIMIT = 8;
/** Decisions listed on the overview. */
export const DECISIONS_LIMIT = 20;

export interface GateState {
  key: string;
  /** `not-requested` when nobody asked for a decision at this gate yet. */
  status: GateStatus | "not-requested";
  gateId?: string;
  requestedAt?: string;
}

export interface AssessSummary {
  sloc: number;
  sourceFiles: number;
  complexityIndex: number;
  critical: number;
  high: number;
  securityFindings: number;
  /** The assessment's rebuild outlook, as written. */
  outlook?: string;
}

export interface CatalogSummary {
  total: number;
  understood: number;
  counts: Partial<Record<ItemStatus, number>>;
}

export interface ApplicationProgress {
  projectId: string;
  projectName: string;
  applicationId: string;
  applicationName: string;
  phase: Phase;
  gate: GateState | null;
  assess: AssessSummary | null;
  catalog: CatalogSummary | null;
  /** Why runtime stages cannot run yet (no document repo or legacy repository). */
  blocked?: string;
  lastRunAt?: string;
}

export type DecisionKind = "gate" | "pull-request" | "findings";

/** Something only a person can do next. */
export interface DecisionItem {
  kind: DecisionKind;
  at: string;
  title: string;
  detail?: string;
  projectId: string;
  applicationId?: string;
  gateId?: string;
  documentWriteId?: string;
  prUrl?: string;
}

export interface UnitFunnel {
  total: number;
  counts: Partial<Record<ItemStatus, number>>;
}

/** A unit not yet understood, ranked by complexity then size. */
export interface RiskyUnit {
  projectId: string;
  applicationId: string;
  id: string;
  name: string;
  module: string;
  complexity: "low" | "medium" | "high";
  loc: number;
  status: ItemStatus;
}

export interface PortfolioOverview {
  generatedAt: string;
  applications: ApplicationProgress[];
  decisions: DecisionItem[];
  funnel: UnitFunnel;
  riskiest: RiskyUnit[];
}

export interface PhaseFacts {
  /** The project has a document repo and the application a legacy repository. */
  ready: boolean;
  /** An assess run succeeded. */
  assessed: boolean;
  /** Catalog items not retired, and how many of them are understood. */
  items: number;
  understood: number;
  /** A design run succeeded. */
  designed: boolean;
}

/**
 * The phase an application is in, from what its runtime stages produced. Member-run phases
 * (P3 onwards) are not tracked here: an application stays in `define-to-be` until they are.
 */
export function derivePhase(facts: PhaseFacts): Phase {
  if (!facts.ready) return "mobilize";
  if (facts.designed) return "define-to-be";
  if (!facts.assessed) return "discover-assess";
  return facts.items > 0 && facts.understood >= facts.items ? "define-to-be" : "discover-assess";
}

const COMPLEXITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const OPEN_STATUSES: readonly ItemStatus[] = ["not-analysed", "failed", "stale"];

/** The largest and most complex units that still need understanding. */
export function riskiestUnits(units: readonly RiskyUnit[], limit = RISKIEST_LIMIT): RiskyUnit[] {
  return units
    .filter((unit) => OPEN_STATUSES.includes(unit.status))
    .sort((a, b) => COMPLEXITY_RANK[a.complexity] - COMPLEXITY_RANK[b.complexity] || b.loc - a.loc || a.id.localeCompare(b.id))
    .slice(0, limit);
}
