// Formats and colours shared by the stage result views.

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
