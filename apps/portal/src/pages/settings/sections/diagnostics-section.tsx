// Diagnostics — installation health snapshot for support and troubleshooting.

import { useEffect, useState } from "react";
import { fetchHealth, type HealthResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { useHealth } from "@/lib/use-health";

export function DiagnosticsSection(): React.JSX.Element {
  const health = useHealth();
  const [info, setInfo] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal).then(setInfo).catch(() => setInfo(null));
    return () => controller.abort();
  }, []);

  const rows: Array<{ label: string; value: string; tone: "green" | "red" | "orange" | "muted" }> = [
    { label: "API", value: health === "up" ? "up" : health === "down" ? "unreachable" : "checking…", tone: health === "up" ? "green" : health === "down" ? "red" : "orange" },
    { label: "Service", value: info?.service ?? "—", tone: "muted" },
    { label: "Reported at", value: info?.at ?? "—", tone: "muted" },
    { label: "Database", value: "Postgres (schema per domain)", tone: "muted" },
    { label: "Runtime engine", value: "pi@1.1.0", tone: "muted" },
    { label: "Portal", value: "v0.0.0", tone: "muted" },
  ];

  return (
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
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-3 text-[14px]">
              <StatusDot tone={row.tone} />
              <span className="text-text">{row.label}</span>
              <span className="ml-auto font-mono text-[12px] text-text-secondary">{row.value}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
