// Deep links between pages, built in one place so every page links the same way.

const query = (entries: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
};

/**
 * Delivery for a project, optionally an application, a stage page and an open run. A run
 * without a stage opens the overview, which forwards to the run's stage page.
 */
export function deliveryLink(target: {
  projectId?: string | undefined;
  applicationId?: string | undefined;
  stage?: string | undefined;
  runId?: string | undefined;
  section?: "writes" | undefined;
}): string {
  const path = target.stage === undefined ? "/delivery" : `/delivery/${encodeURIComponent(target.stage)}`;
  return `${path}${query({ project: target.projectId, app: target.applicationId, run: target.runId, section: target.section })}`;
}

export type MonitoringTab = "runs" | "repositories" | "writes" | "runtime" | "members";

export function monitoringLink(tab: MonitoringTab, filter?: string): string {
  return `/monitoring${query({ tab, status: filter })}`;
}

export function projectLink(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export type GovernanceTab = "gates" | "audit" | "restricted" | "telemetry" | "permissions";

/** The trace of one agent attempt in Governance → Telemetry. */
export function telemetryTraceLink(run: { runId: string; stepRunId?: string | null; attempt?: number }): string {
  return `/governance${query({ tab: "telemetry", trace: run.runId, step: run.stepRunId ?? undefined, attempt: run.attempt === undefined ? undefined : String(run.attempt) })}`;
}

/** Governance on a tab; for gates, optionally filtered by status. */
export function governanceLink(tab: GovernanceTab, status?: string): string {
  return `/governance${query({ tab, status })}`;
}
