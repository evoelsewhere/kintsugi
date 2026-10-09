// StatusDot — DESIGN.md §2: status colors appear exclusively as small indicator
// dots (~10px), never as background fills or large swaths. "muted" marks inactive
// or not-yet-implemented state in the neutral gray of the achromatic palette.
import * as React from "react";
import { cn } from "../../lib/utils";

export type StatusTone =
  | "blue"
  | "cyan"
  | "teal-light"
  | "teal-dark"
  | "green-dark"
  | "green"
  | "green-light"
  | "orange"
  | "red"
  | "pink"
  | "purple-dark"
  | "purple-light"
  | "muted";

const TONE_COLOR: Record<StatusTone, string> = {
  blue: "var(--ds-status-blue)",
  cyan: "var(--ds-status-cyan)",
  "teal-light": "var(--ds-status-teal-light)",
  "teal-dark": "var(--ds-status-teal-dark)",
  "green-dark": "var(--ds-status-green-dark)",
  green: "var(--ds-status-green)",
  "green-light": "var(--ds-status-green-light)",
  orange: "var(--ds-status-orange)",
  red: "var(--ds-status-red)",
  pink: "var(--ds-status-pink)",
  "purple-dark": "var(--ds-status-purple-dark)",
  "purple-light": "var(--ds-status-purple-light)",
  muted: "var(--ds-text-muted)",
};

export interface StatusDotProps {
  tone: StatusTone;
  className?: string;
}

export function StatusDot({ tone, className }: StatusDotProps): React.JSX.Element {
  return <span aria-hidden className={cn("inline-block size-2.5 rounded-full", className)} style={{ backgroundColor: TONE_COLOR[tone] }} />;
}
