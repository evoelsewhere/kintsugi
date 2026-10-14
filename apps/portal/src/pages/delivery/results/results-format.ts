// Formats and colours shared by the stage result views.

import type { Segment } from "@/components/results/charts";
import { CHART_COLOR } from "@/components/results/chart-colors";
import type { StatusTone } from "@/components/ui/status-dot";
import type { Severity } from "@/lib/api/documents";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export const formatCount = (value: number | undefined): string => (value === undefined ? "—" : number.format(value));

export const SEVERITY_TONE: Record<Severity | "Unknown", StatusTone> = {
  Critical: "red",
  High: "orange",
  Medium: "purple-light",
  Low: "blue",
  Info: "muted",
  Unknown: "muted",
};

export const SEVERITY_RANK: Record<Severity | "Unknown", number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4, Unknown: 5 };

/** Categorical colours for domains (the status palette, which reads in light and dark). */
const DOMAIN_COLORS = ["#0062d1", "#067a6e", "#bf89ec", "#ff990a", "#45a557", "#ea3e83", "#52aeff", "#7820bc", "#398e4a", "#e5484d"];

export const EDGE_COLORS: Record<string, string> = { call: "#8f8f8f", dispatch: "#7820bc", read: "#0062d1", write: "#ff990a" };

export const edgeColor = (kind: string): string => EDGE_COLORS[kind] ?? "#8f8f8f";

export function domainColors(domains: readonly string[]): Map<string, string> {
  return new Map(domains.map((domain, index) => [domain, DOMAIN_COLORS[index % DOMAIN_COLORS.length] ?? "#8f8f8f"]));
}

export const SEVERITY_COLOR: Record<Severity | "Unknown", string> = {
  Critical: CHART_COLOR.red,
  High: CHART_COLOR.orange,
  Medium: CHART_COLOR.purple,
  Low: CHART_COLOR.blue,
  Info: CHART_COLOR.muted,
  Unknown: CHART_COLOR.muted,
};

export const PRIORITY_COLOR: Record<string, string> = { P0: CHART_COLOR.red, P1: CHART_COLOR.orange, P2: CHART_COLOR.blue, P3: CHART_COLOR.muted };

export const CONFIDENCE_COLOR: Record<string, string> = { High: CHART_COLOR.green, Medium: CHART_COLOR.orange, Low: CHART_COLOR.red };

export interface Tally {
  key: string;
  count: number;
}

/** How many items fall under each key, the largest first; items without a key are left out. */
export function countBy<T>(items: readonly T[], key: (item: T) => string | undefined): Tally[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value !== undefined && value !== "") counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ key: name, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** The largest `keep` tallies and the rest as one "N others". */
export function topWithOthers(tallies: Tally[], keep = 6): Tally[] {
  if (tallies.length <= keep) return tallies;
  return [...tallies.slice(0, keep), { key: `${tallies.length - keep} others`, count: tallies.slice(keep).reduce((sum, tally) => sum + tally.count, 0) }];
}

/** Tallies as chart segments, coloured by `color(key)` or from the categorical palette. */
export function segmentsOf(tallies: Tally[], color?: (key: string) => string | undefined): Segment[] {
  const palette = domainColors(tallies.map((tally) => tally.key));
  return tallies.map((tally) => ({ label: tally.key, value: tally.count, color: color?.(tally.key) ?? palette.get(tally.key) ?? CHART_COLOR.muted }));
}

export const percentOf = (part: number, total: number): string => (total === 0 ? "0%" : `${Math.round((part / total) * 100)}%`);
