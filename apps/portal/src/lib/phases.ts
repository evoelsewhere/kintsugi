// Display names of the delivery lifecycle phases (docs/methodology/delivery-pipeline.md) and gate states.

import type { GateStatus, Phase } from "@kintsugi/domain";
import type { StatusTone } from "@/components/ui/status-dot";

export const PHASE_LABEL: Record<Phase, string> = {
  mobilize: "P0 Mobilize",
  "discover-assess": "P1 Discover & Assess",
  "define-to-be": "P2 Define To-Be",
  "prepare-factory": "P3 Prepare Factory",
  migrate: "P4 Migrate",
};

export const GATE_STATE: Record<GateStatus | "not-requested", { label: string; tone: StatusTone }> = {
  pending: { label: "waiting for a decision", tone: "orange" },
  approved: { label: "approved", tone: "green" },
  rejected: { label: "rejected", tone: "red" },
  waived: { label: "waived", tone: "blue" },
  "not-requested": { label: "not requested yet", tone: "muted" },
};
