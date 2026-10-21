import { validateGateEvidence, type GateEvidence } from "./gate-evidence.js";

const OPEN = "<!-- kintsugi-gate-evidence:v1 -->";
const CLOSE = "<!-- /kintsugi-gate-evidence -->";
const MAX_RECORD_BYTES = 65_536;

export type GateRecordParseResult =
  | { status: "valid"; evidence: GateEvidence }
  | { status: "invalid"; code: "GATE_RECORD_SIZE" | "GATE_RECORD_BLOCK" | "GATE_RECORD_JSON" | "GATE_RECORD_SCHEMA" | "GATE_RECORD_SUMMARY" };

function summaryLines(value: GateEvidence): string[] {
  return [
    `# Gate ${value.gateId} — ${value.unitId}`,
    "",
    `- Decision: ${value.decision}`,
    ...(value.decisionReason === undefined ? [] : [`- Decision reason: ${JSON.stringify(value.decisionReason)}`]),
    `- Decided by user ID: ${value.actor.userId}`,
    `- Decision audit event: ${value.auditEventId}`,
    `- Context revision: ${value.contextRevision}`,
    `- Policy revision: ${value.policyRevision}`,
    ...(value.waiver === undefined ? [] : [
      `- Waived deliverables: ${value.waiver.deliverableIds.join(", ")}`,
      `- Waiver reason: ${JSON.stringify(value.waiver.reason)}`,
    ]),
    "- Required deliverables:",
    ...value.deliverables.map((item) =>
      `- ${item.deliverableId}: ${item.repositoryId} PR ${item.pullRequestId}; reviewed ${item.reviewedRevision}; merged ${item.mergedRevision}; review ${item.reviewResultId}`,
    ),
  ];
}

/** Render a readable gate record while keeping the validated evidence in one canonical block. */
export function formatGateRecord(evidence: GateEvidence): string {
  const validated = validateGateEvidence(evidence);
  if (!validated.ok) throw new TypeError("gate evidence is invalid");
  const lines = [
    ...summaryLines(validated.value),
    "",
    OPEN,
    JSON.stringify(validated.value, null, 2),
    CLOSE,
    "",
  ];
  const markdown = lines.join("\n");
  if (new TextEncoder().encode(markdown).byteLength > MAX_RECORD_BYTES) throw new RangeError("gate record exceeds 65536 bytes");
  return markdown;
}

/** Parse the single machine-evidence block and require the visible summary to match it. */
export function parseGateRecord(markdown: string): GateRecordParseResult {
  if (new TextEncoder().encode(markdown).byteLength > MAX_RECORD_BYTES) return { status: "invalid", code: "GATE_RECORD_SIZE" };
  if (markdown.split(OPEN).length !== 2 || markdown.split(CLOSE).length !== 2) {
    return { status: "invalid", code: "GATE_RECORD_BLOCK" };
  }
  const open = markdown.indexOf(OPEN);
  const close = markdown.indexOf(CLOSE);
  if (open < 0 || close < open) return { status: "invalid", code: "GATE_RECORD_BLOCK" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(markdown.slice(open + OPEN.length, close).trim()) as unknown;
  } catch {
    return { status: "invalid", code: "GATE_RECORD_JSON" };
  }
  const validated = validateGateEvidence(decoded);
  if (!validated.ok) return { status: "invalid", code: "GATE_RECORD_SCHEMA" };
  const evidence = validated.value;
  const visible = markdown.slice(0, open).trimEnd();
  if (visible !== summaryLines(evidence).join("\n")) return { status: "invalid", code: "GATE_RECORD_SUMMARY" };
  return { status: "valid", evidence };
}
