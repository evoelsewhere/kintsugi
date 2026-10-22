// Request schemas of the telemetry views (ADR-0016: Standard Schema via zod).

import { z } from "zod";
import { pageQuerySchema } from "#common/interface/pagination.js";

const filter = z.string().min(1).max(200).optional();
// ISO instants, as `Date.toISOString()` writes them. A string schema, not `z.coerce.date()`: the OpenAPI document cannot describe a Date.
const instant = z.string().datetime({ offset: true }).optional();

/** `?projectId&agent&from&to`: the window defaults to the last 7 days. */
export const telemetryQuerySchema = z.object({ projectId: filter, agent: filter, from: instant, to: instant });
export type TelemetryQueryInput = z.infer<typeof telemetryQuerySchema>;

/** The same filters plus `status`, the top-level `runId` (a link to one run) and a page. */
export const telemetryRunsQuerySchema = pageQuerySchema.extend({ ...telemetryQuerySchema.shape, status: z.enum(["ok", "error"]).optional(), runId: filter });
export type TelemetryRunsQueryInput = z.infer<typeof telemetryRunsQuerySchema>;

/** `?step&attempt`: narrows a trace to one agent step and one attempt of it. */
export const traceQuerySchema = z.object({ step: filter, attempt: z.coerce.number().int().min(1).optional() });
export type TraceQueryInput = z.infer<typeof traceQuerySchema>;
