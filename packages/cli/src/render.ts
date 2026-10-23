// Output of CLI results as text, Markdown or JSON. Content comes from the API and is never trusted for display.

function escapeJsonDisplayControls(value: string): string {
  return value.replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return "\\u" + codePoint.toString(16).padStart(4, "0").toUpperCase();
  });
}

function itemLines(item: unknown, markdown: boolean): string[] {
  if (item === null || typeof item !== "object") return [`- ${String(item)}`];
  const record = item as Record<string, unknown>;
  const title = record.name ?? record.title ?? record.projectId ?? record.path ?? "Result";
  const detail = [record.kind, record.role, record.status].filter((entry) => typeof entry === "string").join(" · ");
  return [markdown ? `- **${String(title)}**${detail ? ` \u2014 ${detail}` : ""}` : `- ${String(title)}${detail ? ` \u2014 ${detail}` : ""}`];
}

function renderDocument(record: Record<string, unknown>, markdown: boolean): string {
  const path = typeof record.path === "string" ? record.path : "Document";
  const lines = [
    ...(markdown ? [`# ${path}`] : [path]),
    ...(typeof record.projectId === "string" ? [`Project: ${record.projectId}`] : []),
    ...(typeof record.ref === "string" ? [`Ref: ${record.ref}`] : []),
    ...(typeof record.commit === "string" ? [`Commit: ${record.commit}`] : []),
    "",
    typeof record.content === "string" ? record.content : "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

export function formatResult(value: unknown, format: "text" | "json" | "markdown"): string {
  if (format === "json") return `${escapeJsonDisplayControls(JSON.stringify(value, null, 2))}\n`;
  const markdown = format === "markdown";
  if (typeof value === "string") return `${value.trimEnd()}\n`;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.content === "string") return renderDocument(record, markdown);
    const list = Array.isArray(record.items) ? record.items : Array.isArray(record.entries) ? record.entries : undefined;
    if (list !== undefined) {
      const lines = list.flatMap((item) => itemLines(item, markdown));
      if (lines.length === 0) lines.push("No results.");
      if (typeof record.nextCursor === "string") lines.push(`More results available (cursor: ${record.nextCursor})`);
      return `${lines.join("\n")}\n`;
    }
    return `${Object.entries(record).map(([key, item]) => `${key}: ${typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item) : JSON.stringify(item)}`).join("\n")}\n`;
  }
  if (Array.isArray(value)) return `${value.flatMap((item) => itemLines(item, markdown)).join("\n")}\n`;
  return `${String(value)}\n`;
}
