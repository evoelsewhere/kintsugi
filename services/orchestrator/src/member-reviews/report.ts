import { reviewReportSchema, type ReviewReportValue } from "@kintsugi/harness-sdk";
import type { ReviewInputManifest } from "./inputs.js";
import type { ReviewAttempt } from "./schedule.js";

/** Validates a model result against its persisted attempt and the files it actually received. */
export function validateReviewReport(
  value: unknown,
  attempt: ReviewAttempt,
  manifest: ReviewInputManifest,
): ReviewReportValue | undefined {
  const parsed = reviewReportSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const report = parsed.data;
  const key = attempt.key;
  if (report.projectId !== key.projectId || report.unitId !== key.unitId ||
      report.reviewId !== attempt.reviewId || report.generation !== attempt.generation ||
      report.reviewedHead !== key.headSha || report.reviewedBase !== key.baseSha || report.mergeBase !== key.mergeBaseSha ||
      report.contextRevision !== key.contextRevision || report.policyRevision !== key.policyRevision ||
      report.agentVersion !== key.agentVersion || report.coverage !== manifest.coverage.status) {
    return undefined;
  }
  if (report.verdict === "fail" && report.findings.length === 0) return undefined;

  const findingIds = new Set<string>();
  for (const finding of report.findings) {
    if (findingIds.has(finding.findingId)) return undefined;
    findingIds.add(finding.findingId);
    const citation = finding.citation;
    if (citation === undefined || citation.startLine === undefined) return undefined;
    if (citation.sourceId === "pull-request") {
      const file = manifest.changedFiles.find((candidate) => candidate.path === citation.path);
      if (file === undefined || file.binary || manifest.coverage.excludedFiles.some((excluded) => excluded.path === file.path)) return undefined;
      continue;
    }
    if (!manifest.sources.some((source) => source.sourceId === citation.sourceId && source.path === citation.path)) return undefined;
  }
  return report;
}
