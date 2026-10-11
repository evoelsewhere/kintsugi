// Deep links between pages, built in one place so every page links the same way.

const query = (entries: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
};

/** Delivery for a project, optionally an application and an open run. */
export function deliveryLink(target: { projectId?: string | undefined; applicationId?: string | undefined; runId?: string | undefined; section?: "writes" | undefined }): string {
  return `/delivery${query({ project: target.projectId, app: target.applicationId, run: target.runId, section: target.section })}`;
}

export type MonitoringTab = "runs" | "repositories" | "writes" | "worker";

export function monitoringLink(tab: MonitoringTab, filter?: string): string {
  return `/monitoring${query({ tab, status: filter })}`;
}

export function projectLink(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export type GovernanceTab = "gates" | "audit" | "restricted" | "permissions";

/** Governance on a tab; for gates, optionally filtered by status. */
export function governanceLink(tab: GovernanceTab, status?: string): string {
  return `/governance${query({ tab, status })}`;
}
