// What a security document says about its own run: whether every finder class returned, and whether instruction-shaped
// text was found in the source. Three states each: confirmed, a problem, or not reported. A section a document lacks
// (an older or partial run, a hand-written file) is not reported, never an all-clear.

import type { SecurityReport } from "./api/documents";

export type CoverageSignal = "complete" | "gaps" | "unknown";
export type InjectionSignal = "none" | "found" | "unknown";

export function coverageSignal(report: Pick<SecurityReport, "coverageComplete" | "coverageGaps">): CoverageSignal {
  if (report.coverageComplete) return "complete";
  return report.coverageGaps.length > 0 ? "gaps" : "unknown";
}

export function injectionSignal(report: Pick<SecurityReport, "injectionFlags">): InjectionSignal {
  if (report.injectionFlags === undefined || report.injectionFlags.trim() === "") return "unknown";
  return /^none\b/i.test(report.injectionFlags.trim()) ? "none" : "found";
}
