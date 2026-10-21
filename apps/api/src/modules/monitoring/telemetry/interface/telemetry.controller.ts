// Interface layer: the telemetry of runtime jobs, read-only (ADR-0048). Needs telemetry.view.

import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { RequirePermission } from "#common/auth/decorators.js";
import { TelemetryService } from "../application/telemetry.service.js";
import type { TelemetryRun, TelemetrySummary, Trace } from "../domain/telemetry.js";
import {
  type TelemetryQueryInput,
  type TelemetryRunsQueryInput,
  type TraceQueryInput,
  telemetryQuerySchema,
  telemetryRunsQuerySchema,
  traceQuerySchema,
} from "./telemetry.dto.js";

const defined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

/** The window as dates, for the use cases. */
const window = ({ from, to, ...rest }: { from?: string | undefined; to?: string | undefined }): { from?: Date; to?: Date } & typeof rest => ({
  ...rest,
  ...(from === undefined ? {} : { from: new Date(from) }),
  ...(to === undefined ? {} : { to: new Date(to) }),
});

@ApiTags("monitoring · telemetry")
@Controller("monitoring/telemetry")
@RequirePermission("telemetry.view")
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Get("summary")
  @ApiOperation({ summary: "Tokens, cache hit rate, cost, compactions and tool latency of agent jobs in a window, by day, agent and model" })
  @ApiOkResponse({ description: "The summary; the window defaults to the last 7 days (at most 90)." })
  summary(@Query({ schema: telemetryQuerySchema }) query: TelemetryQueryInput): Promise<TelemetrySummary> {
    return this.telemetry.summary(window(defined(query)));
  }

  @Get("runs")
  @ApiOperation({ summary: "Attempts of agent jobs in a window, newest first, with their usage" })
  @ApiOkResponse({ description: "A page of attempts." })
  runs(@Query({ schema: telemetryRunsQuerySchema }) query: TelemetryRunsQueryInput): Promise<Page<TelemetryRun>> {
    return this.telemetry.runs(window(defined(query)) as ReturnType<typeof window> & { status?: "ok" | "error"; limit: number; offset: number });
  }

  @Get("runs/:runId/trace")
  @ApiOperation({ summary: "The spans of a run (job, turns, tool calls, compactions, retries) in start order; the client builds the tree from parentSpanId" })
  @ApiOkResponse({ description: "The trace, capped at 5000 spans." })
  trace(@Param("runId") runId: string, @Query({ schema: traceQuerySchema }) query: TraceQueryInput): Promise<Trace> {
    return this.telemetry.trace(runId, defined(query));
  }
}
