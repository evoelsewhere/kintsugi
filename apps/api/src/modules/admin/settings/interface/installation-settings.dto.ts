// Request schemas of installation settings (ADR-0016: Standard Schema via zod). The full
// identity rules (no <, > or control characters, a plain address) are checked by the use case.

import { z } from "zod";

export const commitIdentitySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().min(3).max(254),
});
export type CommitIdentityInput = z.infer<typeof commitIdentitySchema>;

/** Body of PUT sandbox: every field; the use case checks the ranges with the rules the worker applies (@kintsugi/domain). */
export const sandboxSettingsSchema = z.object({
  checkoutHours: z.number(),
  retentionDays: z.number(),
  scriptTimeoutSec: z.number(),
  agentTimeoutSec: z.number(),
  agentIdleTimeoutSec: z.number(),
  maxOutputBytes: z.number(),
  maxTurns: z.number(),
  maxCostUsd: z.number(),
  markReadOnly: z.boolean(),
});
export type SandboxSettingsInput = z.infer<typeof sandboxSettingsSchema>;
