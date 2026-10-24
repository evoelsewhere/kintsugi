// Optional export of job spans to an OpenTelemetry backend (ADR-0074). The worker hands every batch of spans it stores
// to `SpanExporter.export`; the pg adapter reads the setting (Settings → Telemetry export), and when it is on sends the
// batch as OTLP/HTTP JSON. Export is best effort: it never throws and never makes a job wait for the backend.

import { createHash } from "node:crypto";
import { type TelemetryExportSettings, DEFAULT_TELEMETRY_EXPORT, TELEMETRY_EXPORT_SETTING, otlpTracesUrl, resolveTelemetryExport } from "@kintsugi/domain";
import { type EncryptedSecret, decryptSecret } from "@kintsugi/secrets";
import type { Pool } from "pg";
import type { SpanExporter, SpanRecord } from "./jobs/model.js";

const TIMEOUT_MS = 5000;

/** A setting with its decrypted headers, as the exporter uses it. */
export interface ExportTarget extends TelemetryExportSettings {
  headers: Readonly<Record<string, string>>;
}

export type ExportTargetProvider = () => Promise<ExportTarget>;

const OFF: ExportTarget = { ...DEFAULT_TELEMETRY_EXPORT, headers: {} };

function isEncrypted(value: unknown): value is EncryptedSecret {
  const secret = value as Partial<EncryptedSecret> | null;
  return typeof secret === "object" && secret !== null && typeof secret.ciphertext === "string" && typeof secret.iv === "string" && typeof secret.authTag === "string";
}

/** The target in the database, read at most once per `ttlMs` (spans arrive in bursts). A value that cannot be read leaves export as it was. */
export function pgExportTarget(pool: Pick<Pool, "query">, ttlMs = 5000): ExportTargetProvider {
  let cached: { at: number; target: ExportTarget } | undefined;
  return async () => {
    if (cached !== undefined && Date.now() - cached.at < ttlMs) return cached.target;
    const result = await pool.query<{ value: unknown }>("select value from admin.installation_setting where key = $1", [TELEMETRY_EXPORT_SETTING]).catch(() => undefined);
    let target = cached?.target ?? OFF;
    if (result !== undefined) {
      const stored = result.rows[0]?.value as { headers?: unknown } | undefined;
      const settings = resolveTelemetryExport(stored);
      let headers: Record<string, string> = {};
      try {
        if (isEncrypted(stored?.headers)) headers = JSON.parse(decryptSecret(stored.headers)) as Record<string, string>;
      } catch {
        // headers that cannot be decrypted (a changed key) mean the backend would refuse the spans anyway: export stays off
        settings.enabled = false;
      }
      target = { ...settings, headers };
    }
    cached = { at: Date.now(), target };
    return target;
  };
}

const hex = (text: string, length: number): string => createHash("sha256").update(text).digest("hex").slice(0, length);

interface OtlpValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}

function value(raw: string | number | boolean): OtlpValue {
  if (typeof raw === "string") return { stringValue: raw };
  if (typeof raw === "boolean") return { boolValue: raw };
  return Number.isSafeInteger(raw) ? { intValue: String(raw) } : { doubleValue: raw };
}

const attribute = (key: string, raw: string | number | boolean): { key: string; value: OtlpValue } => ({ key, value: value(raw) });

/** One span record in the OTLP/JSON shape. One trace per job run; ids are derived, so a batch sent twice is the same spans. */
export function otlpSpan(record: SpanRecord): Record<string, unknown> {
  const scope = `${record.runId}:${record.stepId ?? ""}:${record.attempt}:${record.runAttempt ?? 0}`;
  const start = BigInt(Date.parse(record.span.startedAt)) * 1_000_000n;
  const end = start + BigInt(Math.max(0, Math.round(record.span.durationMs))) * 1_000_000n;
  const own = Object.entries(record.span.attributes).map(([key, raw]) => attribute(key, raw));
  return {
    traceId: hex(record.runId, 32),
    spanId: hex(`${scope}:${record.span.id}`, 16),
    ...(record.span.parentId === undefined ? {} : { parentSpanId: hex(`${scope}:${record.span.parentId}`, 16) }),
    name: record.span.name,
    kind: 1,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(end),
    attributes: [
      attribute("kintsugi.run.id", record.runId),
      ...(record.stepId === undefined ? [] : [attribute("kintsugi.step.id", record.stepId)]),
      attribute("kintsugi.project.id", record.projectId),
      ...(record.applicationId === undefined ? [] : [attribute("kintsugi.application.id", record.applicationId)]),
      attribute("kintsugi.agent", record.agent),
      attribute("kintsugi.provider", record.provider),
      attribute("kintsugi.model", record.model),
      attribute("kintsugi.attempt", record.attempt),
      ...own,
    ],
    status: record.span.status === "error" ? { code: 2, ...(record.span.error === undefined ? {} : { message: record.span.error }) } : { code: 1 },
  };
}

/** The request body for a batch of span records. */
export function otlpBody(serviceName: string, records: readonly SpanRecord[]): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute("service.name", serviceName)] },
        scopeSpans: [{ scope: { name: "kintsugi.runtime" }, spans: records.map(otlpSpan) }],
      },
    ],
  };
}

export interface SpanExporterOptions {
  target: ExportTargetProvider;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

/** The exporter the worker uses; with export off (the default) a batch costs one cached settings read. */
export function createSpanExporter(options: SpanExporterOptions): SpanExporter {
  const send = options.fetch ?? fetch;
  const log = options.log ?? (() => undefined);
  let lastFailure = 0;
  return {
    async export(records) {
      if (records.length === 0) return;
      try {
        const target = await options.target();
        if (!target.enabled) return;
        const response = await send(otlpTracesUrl(target.endpoint), {
          method: "POST",
          headers: { ...target.headers, "content-type": "application/json" },
          body: JSON.stringify(otlpBody(target.serviceName, records)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`the backend answered ${response.status}`);
      } catch (error) {
        // One line per minute at most: a backend that is down must not flood the log.
        if (Date.now() - lastFailure > 60_000) {
          lastFailure = Date.now();
          log(`telemetry export failed (${records.length} spans dropped): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}
