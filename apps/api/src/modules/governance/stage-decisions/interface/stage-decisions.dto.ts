import { z } from "zod";

export const recordStageDecisionSchema = z.object({
  choice: z.string().trim().min(1).max(200),
}).strict();

export type RecordStageDecisionInput = z.infer<typeof recordStageDecisionSchema>;
