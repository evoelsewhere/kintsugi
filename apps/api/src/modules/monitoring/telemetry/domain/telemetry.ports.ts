// Port of the telemetry read model; the Postgres adapter implements it.

import type { Page } from "#common/application/pagination.js";
import type { TelemetryFilter, TelemetryRun, TelemetryRunsFilter, TelemetrySummary, Trace } from "./telemetry.js";

export abstract class TelemetryReadModel {
  abstract summary(filter: TelemetryFilter): Promise<TelemetrySummary>;
  abstract runs(filter: TelemetryRunsFilter): Promise<Page<TelemetryRun>>;
  /** The spans of a top-level run; undefined when it has none. */
  abstract trace(runId: string, options: { step?: string; attempt?: number }): Promise<Trace | undefined>;
}
