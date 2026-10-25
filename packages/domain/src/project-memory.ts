/** Shared operational memory; project documents in Git remain authoritative. */
export const MEMORY_CANDIDATES_FILE = "memory-candidates.json"; // Discarded legacy pilot scratch.
export const MEMORY_KINDS = ["fact", "lesson", "decision", "navigation"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryTarget = "long_term" | "daily";
export interface MemoryEvidence { repositoryId: string; path: string; quote?: string }
export interface MemoryWrite {
  kind: MemoryKind;
  content: string;
  target: MemoryTarget;
  scope: "project" | "application";
  summary: string;
  tags: string[];
  evidence?: MemoryEvidence;
}
export interface ProjectMemoryEntry {
  id: string;
  applicationId: string | null;
  originApplicationId: string | null;
  kind: MemoryKind;
  target: MemoryTarget;
  day: string | null;
  summary: string;
  content: string;
  tags: string[];
  evidence: (MemoryEvidence & { commit: string }) | null;
  sourceRunId: string | null;
  sourceStepId: string | null;
  sourceStage: string;
  producerStatus: string;
  agent: string;
  state: "learned" | "approved" | "rejected";
  deletedAt: string | null;
  recoveryId: string | null;
  createdAt: string;
}
export interface ProjectMemoryView { enabled: boolean; epoch: number; entries: ProjectMemoryEntry[]; total: number }
export interface ProjectMemoryStatus { enabled: boolean; epoch: number; available: number }
export interface MemoryPage { items: ProjectMemoryEntry[]; total: number }
export interface MemoryFilter { target?: MemoryTarget; kind?: MemoryKind; date?: string }
export type ScratchpadAction = "list" | "add" | "done" | "undo" | "clear";
export interface ScratchpadInput { action: ScratchpadAction; id?: string; text?: string }
export interface ScratchpadItem { id: string; text: string; done: boolean }
export const MEMORY_WRITE_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["kind", "content"],
  properties: {
    kind: { type: "string", enum: MEMORY_KINDS },
    content: { type: "string", minLength: 1, maxLength: 2000 },
    target: { type: "string", enum: ["long_term", "daily"] },
    scope: { type: "string", enum: ["project", "application"] },
    summary: { type: "string", minLength: 1, maxLength: 240 },
    tags: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 32 } },
    evidence: { type: "object", additionalProperties: false, required: ["repositoryId", "path"], properties: {
      repositoryId: { type: "string", minLength: 1, maxLength: 128 },
      path: { type: "string", minLength: 1, maxLength: 500 },
      quote: { type: "string", minLength: 12, maxLength: 400 },
    } },
  },
};
function clean(text: unknown, max: number, multiline = false): text is string {
  return typeof text === "string" && text.trim().length > 0 && text.length <= max && ![...text].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 || code === 127) && !(multiline && [9, 10, 13].includes(code));
  });
}
/** No caller-supplied project, revision, trust, run or author fields. */
export function parseMemoryWrite(value: unknown): MemoryWrite | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["kind", "content", "target", "scope", "summary", "tags", "evidence"].includes(key))) return undefined;
  if (!MEMORY_KINDS.includes(row.kind as MemoryKind) || !clean(row.content, 2000, true)) return undefined;
  if (row.target !== undefined && (typeof row.target !== "string" || !["long_term", "daily"].includes(row.target))) return undefined;
  if (row.scope !== undefined && (typeof row.scope !== "string" || !["project", "application"].includes(row.scope))) return undefined;
  if (row.summary !== undefined && !clean(row.summary, 240)) return undefined;
  const tags = row.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 8 || !tags.every((tag) => clean(tag, 32))) return undefined;
  let evidence: MemoryEvidence | undefined;
  if (row.evidence !== undefined) {
    if (typeof row.evidence !== "object" || row.evidence === null || Array.isArray(row.evidence)) return undefined;
    const ref = row.evidence as Record<string, unknown>;
    if (Object.keys(ref).some((key) => !["repositoryId", "path", "quote"].includes(key)) || !clean(ref.repositoryId, 128) || !clean(ref.path, 500) ||
      !/^[A-Za-z0-9_.@/-]+$/.test(ref.path) || ref.path.split("/").some((part) => ["", ".", ".."].includes(part)) ||
      (ref.quote !== undefined && (!clean(ref.quote, 400, true) || ref.quote.trim().length < 12))) return undefined;
    evidence = { repositoryId: ref.repositoryId, path: ref.path, ...(ref.quote === undefined ? {} : { quote: ref.quote as string }) };
  }
  return { kind: row.kind as MemoryKind, content: row.content.trim(), target: (row.target ?? "long_term") as MemoryTarget,
    scope: (row.scope ?? "project") as MemoryWrite["scope"], summary: typeof row.summary === "string" ? row.summary.trim() : Array.from(row.content.trim().split(/\r?\n/)[0]!).slice(0, 120).join(""),
    tags: [...new Set(tags as string[])], ...(evidence === undefined ? {} : { evidence }) };
}
export function validMemoryDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
