import { z } from "zod";
import { GATE_KEY_PATTERN } from "@kintsugi/domain";

export const requestGateDecisionSchema = z.object({
  projectId: z.string().min(1).max(100),
  unitId: z.string().min(1).max(200),
  gateId: z.string().regex(GATE_KEY_PATTERN),
  decision: z.enum(["approved", "rejected", "waived"]),
  decisionReason: z.string().trim().min(1).max(2000).optional(),
  waiverDeliverableIds: z.array(z.string().min(1).max(100)).max(100).optional(),
  waiverReason: z.string().trim().min(1).max(2000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "rejected" && value.decisionReason === undefined) {
    context.addIssue({ code: "custom", path: ["decisionReason"], message: "A reason is required to reject a gate" });
  }
  if (value.decision !== "rejected" && value.decisionReason !== undefined) {
    context.addIssue({ code: "custom", path: ["decisionReason"], message: "Only rejected decisions accept decisionReason" });
  }
  if (value.decision === "waived" && (value.waiverDeliverableIds === undefined || value.waiverReason === undefined)) {
    context.addIssue({ code: "custom", path: ["waiverDeliverableIds"], message: "A waiver requires an explicit scope and reason" });
  }
  if (value.decision !== "waived" && (value.waiverDeliverableIds !== undefined || value.waiverReason !== undefined)) {
    context.addIssue({ code: "custom", path: ["waiverDeliverableIds"], message: "Only waived decisions accept waiver scope and reason" });
  }
});

export type RequestGateDecisionInput = z.infer<typeof requestGateDecisionSchema>;
