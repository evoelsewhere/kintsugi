import { open, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { reviewReportSchema, taskStatusSchema, type ReviewReport, type TaskEvent, type TaskBrief } from "@kintsugi/harness-sdk";
import { CliError } from "./profile.js";

function citation(sourceId: string, path: string, startLine?: number, endLine?: number): string {
  const lines = startLine === undefined ? "" : endLine === undefined || endLine === startLine ? `#L${startLine}` : `#L${startLine}-L${endLine}`;
  return `\`${sourceId}\` — \`${path}${lines}\``;
}

export function renderBriefMarkdown(brief: TaskBrief): string {
  const lines = [
    `# ${brief.title}`,
    "",
    `- Task: \`${brief.projectId}/${brief.unitId}\``,
    `- Activity: ${brief.activity}`,
    `- Snapshot: \`${brief.snapshotId}\``,
    `- Context revision: \`${brief.contextRevision}\``,
    `- Document repository commit: \`${brief.documentRepoCommit}\``,
    `- Current: ${brief.freshness.isCurrent ? "yes" : "no; refresh before acting"}`,
    `- Required context: ${brief.requiredContextStatus}${brief.requiredContextStatus === "partial" ? " (required context is partial)" : ""}`,
    ...(brief.requiredContextStatus === "partial" ? ["", `> Required context is partial. Do not begin ${brief.activity} work until every required omitted section has been fetched from this same snapshot. Use document get with this snapshot ID and the registered source/section IDs; if the AI has no Kintsugi tool access, ask the developer to retrieve those sections first.`] : []),
    "",
    "## Objective",
    "",
    brief.objective,
    "",
    "## Acceptance criteria",
    "",
    ...(brief.acceptanceCriteria.length === 0 ? ["No acceptance criteria were supplied."] : brief.acceptanceCriteria.map((item) => `- ${item}`)),
    "",
    "## Readiness and blockers",
    "",
    ...(brief.blockers.length === 0 ? [brief.readiness.byActivity[brief.activity].ready ? "Ready for this activity." : "No blockers were reported; readiness is not asserted by this export."] : brief.blockers.map((blocker) => `- ${blocker.code}: ${blocker.message}`)),
    "",
    "## Context sections",
    "",
  ];
  for (const section of brief.sections) {
    lines.push(`### ${section.title}`, "", section.text, "", `Source: ${citation(section.citation.sourceId, section.citation.path, section.citation.startLine, section.citation.endLine)}`, "");
  }
  if (brief.sections.length === 0) lines.push("No context sections were returned.", "");
  lines.push("## Omitted sections", "");
  if (brief.omittedSections.length === 0) lines.push("No sections were omitted.", "");
  else for (const omitted of brief.omittedSections) lines.push(`- ${omitted.required ? "Required" : "Optional"}: source \`${omitted.sourceId}\`, section \`${omitted.sectionId}\``);
  lines.push("", "## Sources", "");
  if (brief.sources.length === 0) lines.push("No sources were returned.");
  else for (const source of brief.sources) lines.push(`- ${source.role}: \`${source.path}\` (${source.availability}; ${source.publication}; approval ${source.approval.status})${source.commit === undefined ? "" : ` at \`${source.commit}\``}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderBriefText(brief: TaskBrief): string {
  return renderBriefMarkdown(brief).replace(/^#{1,6}\s+/gm, "").replace(/`/g, "").replace(/\*\*/g, "");
}

function formatCitation(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const citation = value as Record<string, unknown>;
  if (typeof citation.sourceId !== "string" || typeof citation.path !== "string") return undefined;
  const start = typeof citation.startLine === "number" ? citation.startLine : undefined;
  const end = typeof citation.endLine === "number" ? citation.endLine : undefined;
  const range = start === undefined ? "" : end === undefined || end === start ? `#L${start}` : `#L${start}-L${end}`;
  return `${citation.sourceId} — ${citation.path}${range}`;
}

function renderDocumentPage(record: Record<string, unknown>, markdown: boolean): string {
  const path = typeof record.path === "string" ? record.path : "Document";
  const citations = Array.isArray(record.citations) ? record.citations.map(formatCitation).filter((entry): entry is string => entry !== undefined) : [];
  const remaining = Array.isArray(record.requiredSectionsRemaining) ? record.requiredSectionsRemaining.filter((entry): entry is string => typeof entry === "string") : [];
  const sources = citations.length === 0 ? [] : ["", "Sources:", ...citations.map((entry) => `- ${entry}`)];
  const lines = [
    ...(markdown ? [`# ${path}`] : [path]),
    ...(typeof record.projectId === "string" && typeof record.unitId === "string" ? [`Task: ${record.projectId}/${record.unitId}`] : []),
    ...(typeof record.snapshotId === "string" ? [`Snapshot: ${record.snapshotId}`] : []),
    ...(typeof record.sourceId === "string" ? [`Source: ${record.sourceId}`] : []),
    ...(typeof record.repositoryId === "string" ? [`Repository: ${record.repositoryId}`] : []),
    ...(typeof record.commit === "string" ? [`Repository commit: ${record.commit}`] : []),
    ...(typeof record.contentHash === "string" ? [`Content hash: ${record.contentHash}`] : []),
    ...(typeof record.complete === "boolean" ? [`Complete: ${record.complete ? "yes" : "no"}`] : []),
    ...(remaining.length > 0 ? [`Required sections remaining: ${remaining.join(", ")}`] : []),
    ...(typeof record.nextCursor === "string" ? [`Next cursor: ${record.nextCursor}`] : []),
    "",
    typeof record.text === "string" ? record.text : "",
    ...sources,
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function itemLines(item: unknown, markdown = false): string[] {
  if (item === null || typeof item !== "object") return [markdown ? `- ${String(item)}` : `- ${String(item)}`];
  const record = item as Record<string, unknown>;
  const title = record.title ?? record.name ?? record.projectId ?? record.reviewId ?? record.unitId ?? record.sourceId ?? "Result";
  const detail = [record.status, record.phase, record.currentness].filter((entry) => typeof entry === "string").join(" · ");
  const first = markdown ? `- **${String(title)}**${detail ? ` — ${detail}` : ""}` : `- ${String(title)}${detail ? ` — ${detail}` : ""}`;
  const lines = [first];
  if (typeof record.excerpt === "string") lines.push(`  ${record.excerpt}`);
  if (typeof record.objective === "string") lines.push(`  ${record.objective}`);
  if (record.readiness !== null && typeof record.readiness === "object") {
    const readiness = record.readiness as { readyFor?: unknown; blockers?: unknown };
    if (Array.isArray(readiness.readyFor)) lines.push(`  Ready for: ${readiness.readyFor.join(", ") || "none"}`);
    if (Array.isArray(readiness.blockers) && readiness.blockers.length > 0) {
      lines.push(`  Blockers: ${readiness.blockers.map((blocker) => blocker !== null && typeof blocker === "object" && "code" in blocker ? String((blocker as { code: unknown }).code) : "unresolved").join(", ")}`);
    }
  }
  const citationText = formatCitation(record.citation);
  if (citationText !== undefined) lines.push(`  Source: ${citationText}`);
  return lines;
}

export async function writeBrief(path: string, brief: TaskBrief, options: { overwrite: false }): Promise<void> {
  if (options.overwrite !== false) throw new CliError("EXPORT_POLICY", "Task brief export must refuse overwriting existing files");
  let file;
  try { file = await open(path, "wx", 0o600); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CliError("EXPORT_EXISTS", "Output file already exists; choose a new path");
    throw new CliError("EXPORT_FAILED", "Could not create the task brief output file");
  }
  try {
    await file.writeFile(renderBriefMarkdown(brief), "utf8");
    await file.sync();
    if (process.platform !== "win32") await file.chmod(0o600);
  } catch {
    throw new CliError("EXPORT_FAILED", "Could not write the task brief output file");
  } finally { await file.close(); }
  if (process.platform === "win32") {
    try { await restrictWindowsFile(path); } catch {
      await unlink(path).catch(() => undefined);
      throw new CliError("EXPORT_ACL_FAILED", "Could not restrict the exported task brief to the current Windows user");
    }
  }
}

function runWindowsTool(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => reject(new Error("Windows security tool unavailable")));
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error("Windows security command failed")));
  });
}

async function restrictWindowsFile(path: string): Promise<void> {
  const identity = await runWindowsTool("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = identity.match(/S-1-(?:\d+-)+\d+/)?.[0];
  if (sid === undefined) throw new Error("Current user SID could not be resolved");
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  await runWindowsTool(`${systemRoot}\\System32\\icacls.exe`, [path, "/inheritance:r", "/grant:r", `*${sid}:(M)`]);
}

function renderReviewReport(report: ReviewReport, markdown: boolean): string {
  const lines = [
    `${markdown ? "# " : ""}Review ${report.reviewId}`,
    `Task: ${report.projectId}/${report.unitId}`,
    `Generation: ${report.generation}`,
    `Currentness: ${report.currentness}`,
    `Verdict: ${report.verdict}`,
    `Coverage: ${report.coverage}`,
    `Reviewed head: ${report.reviewedHead}`,
    `Reviewed base: ${report.reviewedBase}`,
    ...(report.mergeBase === undefined ? [] : [`Merge base: ${report.mergeBase}`]),
    `Context revision: ${report.contextRevision}`,
    `Policy revision: ${report.policyRevision}`,
    `Agent version: ${report.agentVersion}`,
    "", `${markdown ? "## " : ""}Findings`, "",
  ];
  if (report.findings.length === 0) lines.push("No findings.");
  for (const finding of report.findings) {
    lines.push(`${markdown ? "### " : ""}${finding.findingId}: ${finding.title}`,
      `Severity: ${finding.severity}; currentness: ${finding.currentness}`, "", finding.rationale, "", `Repair guidance: ${finding.repairGuidance}`);
    const source = formatCitation(finding.citation);
    if (source !== undefined) lines.push(`Source: ${source}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderTaskStatusMarkdown(status: ReturnType<typeof taskStatusSchema.parse>): string {
  const lines = [
    "# Task status",
    "",
    `- Task: ${renderEventValue(status.projectId + "/" + status.unitId, true)}`,
    `- Status: ${status.status}`,
    `- Pull request evidence: ${status.evidenceAvailability.pullRequests}`,
    `- Review evidence: ${status.evidenceAvailability.reviews}`,
    "",
    "## Pull requests",
    "",
    ...(status.pullRequests.length === 0 ? ["No pull requests reported."] : status.pullRequests.flatMap((pullRequest) => [
      `- ${renderEventValue(pullRequest.pullRequestId, true)} (${renderEventValue(pullRequest.repositoryId, true)}) — ${pullRequest.state}`,
      `  - Head: ${renderEventValue(pullRequest.headRevision, true)}`,
      ...(pullRequest.updatedAt === undefined ? [] : [`  - Updated: ${renderEventValue(pullRequest.updatedAt, true)}`]),
    ])),
    "",
    "## Current reviews",
    "",
    ...(status.currentReviewIds.length === 0 ? ["No current review reports."] : status.currentReviewIds.map((reviewId) => `- ${renderEventValue(reviewId, true)}`)),
    "",
    "## Gates",
    "",
    ...(status.gates.length === 0 ? ["No gate status reported."] : status.gates.map((gate) => `- ${renderEventValue(gate.unitId, true)} · ${renderEventValue(gate.gateId, true)}: ${gate.status} (${gate.publication})`)),
    "",
    "## Next action",
    "",
    renderEventValue(status.nextAction, true),
    ...(status.latestContinuation === undefined ? [] : [
      "",
      "## Latest continuation (historical)",
      "",
      "Current status and next action above are authoritative.",
      renderTaskContinuationEvent(status.latestContinuation, true, false).trimEnd(),
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

function renderTaskStatusText(status: ReturnType<typeof taskStatusSchema.parse>): string {
  const lines = [
    `Task: ${escapeEventValue(status.projectId + "/" + status.unitId)}`,
    `Status: ${status.status}`,
    `Pull request evidence: ${status.evidenceAvailability.pullRequests}`,
    `Review evidence: ${status.evidenceAvailability.reviews}`,
    `Pull requests: ${escapeJsonDisplayControls(JSON.stringify(status.pullRequests))}`,
    `Current reviews: ${escapeJsonDisplayControls(JSON.stringify(status.currentReviewIds))}`,
    `Gates: ${escapeJsonDisplayControls(JSON.stringify(status.gates))}`,
    `Next action: ${escapeEventValue(status.nextAction)}`,
    ...(status.latestContinuation === undefined ? [] : [
      "",
      "Latest continuation (historical)",
      "Current status and next action above are authoritative.",
      renderTaskContinuationEvent(status.latestContinuation, false, false).trimEnd(),
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

function escapeEventValue(value: string, preserveBackslashes = false): string {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\") escaped += preserveBackslashes ? "\\" : "\\\\";
    else if (character === "\n") escaped += "\\n";
    else if (character === "\r") escaped += "\\r";
    else if (character === "\t") escaped += "\\t";
    else if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      || codePoint === 0x2028 || codePoint === 0x2029 || codePoint === 0x061c || codePoint === 0x200e || codePoint === 0x200f
      || (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069)) {
      escaped += "\\u" + codePoint.toString(16).toUpperCase().padStart(4, "0");
    } else escaped += character;
  }
  return escaped.replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => "\\u" + hex.toUpperCase());
}

function escapeJsonDisplayControls(value: string): string {
  return value.replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return "\\u" + codePoint.toString(16).padStart(4, "0").toUpperCase();
  });
}

function markdownCode(value: string): string {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const content = /^[ `]|[ `]$/.test(value) ? " " + value + " " : value;
  return fence + content + fence;
}

function renderEventValue(value: string, markdown: boolean, preserveBackslashes = false): string {
  const safe = escapeEventValue(value, preserveBackslashes);
  return markdown ? markdownCode(safe) : safe;
}

function renderTaskContinuationEvent(event: TaskEvent, markdown: boolean, includeRefreshAdvice = true): string {
  const metadata = event.metadata;
  const prefix = markdown ? "- " : "";
  const field = (label: string, value: unknown, dynamicLabel = false) => {
    const safeLabel = dynamicLabel ? renderEventValue(label, markdown) : label;
    const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
    return prefix + safeLabel + ": " + renderEventValue(text, markdown);
  };
  const rows = [
    markdown ? "### Task continuation guidance/evidence" : "Task continuation guidance/evidence",
    ...(markdown ? [""] : []),
    field("Event", event.id),
    field("Time", event.occurredAt),
    field("Task", event.projectId + "/" + event.unitId),
    field("Schema version", metadata.schemaVersion),
    field("Status", metadata.status),
    field("Code", metadata.code),
    field("Decision", metadata.decisionId),
    field("Gate", metadata.gateId),
    field("Evidence hash", metadata.evidenceHash),
    field("Record commit", metadata.recordCommit),
  ];
  for (const [key, label] of [["phase", "Phase"], ["stage", "Stage"], ["sourceCommit", "Source commit"]] as const) {
    const value = metadata[key];
    if (value !== null && value !== undefined) rows.push(field(label, value));
  }
  const knownFields = new Set(["schemaVersion", "status", "code", "decisionId", "gateId", "evidenceHash", "recordCommit", "phase", "stage", "sourceCommit", "nextAction"]);
  for (const [key, value] of Object.entries(metadata)) {
    if (knownFields.has(key)) continue;
    rows.push(field(key, value, true));
  }
  rows.push(field("Next action", metadata.nextAction), "", "Continuation is advisory only.", ...(includeRefreshAdvice ? ["Fetch current task status before taking action."] : []), "");
  return rows.join("\n") + "\n";
}

export function renderTaskEvent(event: TaskEvent, format: "text" | "json" | "markdown"): string {
  if (format === "json") return escapeJsonDisplayControls(JSON.stringify(event)) + "\n";
  if (event.kind === "task.continuation") return renderTaskContinuationEvent(event, format === "markdown");
  const markdown = format === "markdown";
  const jsonValue = (value: unknown) => {
    const encoded = escapeEventValue(JSON.stringify(value) ?? "null", true);
    return markdown ? markdownCode(encoded) : encoded;
  };
  const lines = [
    (markdown ? "### " : "") + renderEventValue(event.kind, markdown) + " (" + renderEventValue(event.id, markdown) + ")",
    "Time: " + renderEventValue(event.occurredAt, markdown),
    "Task: " + renderEventValue(event.projectId + "/" + event.unitId, markdown),
    ...Object.entries(event.metadata).map(([key, value]) => "Metadata " + renderEventValue(key, markdown) + ": " + jsonValue(value)),
  ];
  return lines.join("\n") + "\n\n";
}
export function formatResult(value: unknown, format: "text" | "json" | "markdown"): string {
  if (format === "json") return `${escapeJsonDisplayControls(JSON.stringify(value, null, 2))}\n`;
  const review = reviewReportSchema.safeParse(value);
  if (review.success) return renderReviewReport(review.data, format === "markdown");
  if (format === "markdown") {
    if (typeof value === "string") return `${value.trimEnd()}\n`;
    const values = value !== null && typeof value === "object" && "items" in value && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : Array.isArray(value) ? value : [value];
    if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { text?: unknown }).text === "string") {
      return renderDocumentPage(value as Record<string, unknown>, true);
    }
    const taskStatus = taskStatusSchema.safeParse(value);
    if (taskStatus.success) return renderTaskStatusMarkdown(taskStatus.data);
    const rows = values.flatMap((item) => itemLines(item, true));
    if (values.length === 0) rows.push("No results.");
    return `${rows.join("\n")}\n`;
  }
  if (value !== null && typeof value === "object" && "items" in value && Array.isArray((value as { items?: unknown }).items)) {
    const result = value as { items: unknown[]; nextCursor?: string };
    const lines = result.items.flatMap((item) => itemLines(item));
    if (lines.length === 0) lines.push("No results.");
    if (result.nextCursor !== undefined) lines.push(`More results available (cursor: ${result.nextCursor})`);
    return `${lines.join("\n")}\n`;
  }
  if (Array.isArray(value)) return `${value.map((item) => {
    return itemLines(item).join("\n");
  }).join("\n")}\n`;
  if (value !== null && typeof value === "object") {
    const taskStatus = taskStatusSchema.safeParse(value);
    if (taskStatus.success) return renderTaskStatusText(taskStatus.data);
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return renderDocumentPage(record, false);
    }
    return `${Object.entries(record).map(([key, item]) => `${key}: ${typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item) : JSON.stringify(item)}`).join("\n")}\n`;
  }
  return `${String(value)}\n`;
}
