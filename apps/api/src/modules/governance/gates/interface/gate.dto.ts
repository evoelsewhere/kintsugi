// Interface layer: request schemas of gates (ADR-0016: Standard Schema; validated by
// `StandardSchemaValidationPipe`).

import { z } from "zod";
import { enumListQuery } from "#common/interface/dto.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import { GATE_KEY_PATTERN, GATE_STATUSES, type GateStatus } from "../domain/gate.js";

const id = z.string().min(1).max(128);
const gateKey = z.string().regex(GATE_KEY_PATTERN, "must be G0–G4 or a lowercase stage gate key such as stage:assess");

/** `?projectId&applicationId&gateKey&status=pending,approved&limit&offset`. */
export const listGatesQuerySchema = pageQuerySchema.extend({
  projectId: id.optional(),
  applicationId: id.optional(),
  gateKey: gateKey.optional(),
  status: enumListQuery(GATE_STATUSES as readonly [GateStatus, ...GateStatus[]]).optional(),
});
export type ListGatesQuery = z.infer<typeof listGatesQuerySchema>;

export const requestGateSchema = z.object({
  projectId: id,
  applicationId: id.optional(),
  gateKey,
  title: z.string().trim().min(1).max(300),
  subject: z.string().min(1).max(200).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type RequestGateInput = z.infer<typeof requestGateSchema>;

export const decideGateSchema = z.object({
  decision: z.enum(["approve", "reject", "waive"]),
  note: z.string().max(4000).optional(),
});
export type DecideGateInput = z.infer<typeof decideGateSchema>;
