// Diagnostics — installation health snapshot for support and troubleshooting: the API, and the worker from its
// heartbeats and the job queues (the same reads as Monitoring → Runtime, which has the detail).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchHealth, type HealthResponse } from "@/lib/api";
import { type WorkerHealth, type WorkerStatus, monitoringApi } from "@/lib/api/monitoring";
import { APP_VERSION } from "@/lib/app-info";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { formatRelative } from "@/lib/format";
import { useHealth } from "@/lib/use-health";
import { workerVerdict } from "@/lib/worker-health";

interface Row {
  label: string;
  value: string;
  tone: StatusTone;
}

function RowList({ rows }: { rows: Row[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3 text-[14px]">
          <StatusDot tone={row.tone} />
          <span className="text-text">{row.label}</span>
          <span className="ml-auto text-right font-mono text-[12px] text-text-secondary">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** The worker rows: its state, last heartbeat, the jobs it runs and the depth of its queues. */
function workerRows(worker: WorkerHealth, workers: WorkerStatus[]): Row[] {
  const verdict = workerVerdict(worker);
  const running = workers.filter((entry) => entry.state === "up");
  const activeJobs = running.reduce((total, entry) => total + entry.activeJobs, 0);
  const queued = worker.queues === null ? undefined : worker.queues.reduce((total, queue) => total + queue.queued, 0);
  return [
    { label: "Worker", value: verdict.label, tone: verdict.tone },
    { label: "Last heartbeat", value: formatRelative(worker.lastSeenAt), tone: "muted" },
    { label: "Workers up", value: String(worker.workersUp), tone: "muted" },
    { label: "Active jobs", value: String(activeJobs), tone: "muted" },
    { label: "Queued jobs", value: queued === undefined ? "unavailable" : String(queued), tone: "muted" },
  ];
}

export function DiagnosticsSection({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const health = useHealth();
  const [info, setInfo] = useState<HealthResponse | null>(null);
  const [worker, setWorker] = useState<{ health: WorkerHealth; workers: WorkerStatus[] } | null | "failed">(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal).then(setInfo).catch(() => setInfo(null));
    void Promise.all([monitoringApi.overview(), monitoringApi.workers()])
      .then(([overview, workers]) => {
        if (!controller.signal.aborted) setWorker({ health: overview.worker, workers });
      })
      .catch(() => {
        if (!controller.signal.aborted) setWorker("failed");
      });
    return () => controller.abort();
  }, []);

  const build = info?.build;
  const rows: Row[] = [
    { label: "API", value: health === "up" ? "up" : health === "down" ? "unreachable" : "checking…", tone: health === "up" ? "green" : health === "down" ? "red" : "orange" },
    { label: "Service", value: info?.service ?? "—", tone: "muted" },
    { label: "API version", value: build === undefined ? "—" : `${build.version} (${build.commitShort})`, tone: "muted" },
    { label: "Reported at", value: info?.at ?? "—", tone: "muted" },
    { label: "Database", value: "Postgres (schema per domain)", tone: "muted" },
    { label: "Portal", value: APP_VERSION, tone: "muted" },
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Installation health</CardTitle>
            <CardDescription>Live status of the API and the components of this installation.</CardDescription>
          </div>
          <Badge>
            <StatusDot tone={health === "up" ? "green" : health === "down" ? "red" : "orange"} />
            {health}
          </Badge>
        </CardHeader>
        <CardContent>
          <RowList rows={rows} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Worker and queues</CardTitle>
            <CardDescription>The worker runs the jobs; it reports a heartbeat every few seconds.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {worker === null ? (
            <p className="text-[13px] text-text-muted">Loading…</p>
          ) : worker === "failed" ? (
            <p className="text-[13px] text-text-muted">The worker state could not be read.</p>
          ) : (
            <RowList rows={workerRows(worker.health, worker.workers)} />
          )}
          <p className="text-[12px] text-text-muted">
            Each worker, its queues and the job workspaces are in{" "}
            <Link className="text-[var(--ds-accent)] hover:underline" to="/monitoring?tab=runtime" onClick={onNavigate}>
              Monitoring → Runtime
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
