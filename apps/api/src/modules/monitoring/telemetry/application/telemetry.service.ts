// Use cases of the telemetry views: the window defaults to the last 7 days and is capped, so a
// view never scans the whole table by accident.

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Page } from "#common/application/pagination.js";
import type { TelemetryFilter, TelemetryRun, TelemetryRunsFilter, TelemetrySummary, Trace } from "../domain/telemetry.js";
import { TelemetryReadModel } from "../domain/telemetry.ports.js";

const DAY_MS = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 90;

export interface TelemetryQuery {
  projectId?: string;
  agent?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class TelemetryService {
  constructor(private readonly reads: TelemetryReadModel) {}

  summary(query: TelemetryQuery): Promise<TelemetrySummary> {
    return this.reads.summary(this.#filter(query));
  }

  runs(query: TelemetryQuery & { status?: "ok" | "error"; limit: number; offset: number }): Promise<Page<TelemetryRun>> {
    const filter: TelemetryRunsFilter = { ...this.#filter(query), limit: query.limit, offset: query.offset, ...(query.status === undefined ? {} : { status: query.status }) };
    return this.reads.runs(filter);
  }

  async trace(runId: string, options: { step?: string; attempt?: number }): Promise<Trace> {
    const trace = await this.reads.trace(runId, options);
    if (trace === undefined) throw new NotFoundException(`No telemetry for run ${runId} (it may be older than the retention period, or not an agent job)`);
    return trace;
  }

  #filter(query: TelemetryQuery): TelemetryFilter {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
    if (!(from < to)) throw new BadRequestException("`from` must be before `to`");
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) throw new BadRequestException(`The window can span at most ${MAX_WINDOW_DAYS} days`);
    return { from, to, ...(query.projectId === undefined ? {} : { projectId: query.projectId }), ...(query.agent === undefined ? {} : { agent: query.agent }) };
  }
}
