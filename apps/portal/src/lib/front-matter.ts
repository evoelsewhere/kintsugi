// The front matter of a document of the document repository (ADR-0042): facts as `key: value` lines (JSON
// scalars) and short block lists, between two `---` lines at the top. A document drawer shows them as a
// compact list instead of raw YAML above the text. Never throws: a document without front matter is all body.

export interface FrontMatter {
  fields: Array<[key: string, value: string]>;
  body: string;
}

const display = (raw: string): string => {
  const value = raw.trim();
  if (/^["[{]/.test(value)) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).join(", ") : String(parsed);
    } catch {
      return value;
    }
  }
  return value;
};

export function splitFrontMatter(text: string): FrontMatter {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { fields: [], body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0 || end > 200) return { fields: [], body: text };
  const fields: Array<[string, string]> = [];
  for (const line of lines.slice(1, end)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (pair !== null) fields.push([pair[1] ?? "", display(pair[2] ?? "")]);
    else if (item !== null && fields.length > 0) {
      const last = fields[fields.length - 1];
      if (last !== undefined) last[1] = last[1] === "" ? display(item[1] ?? "") : `${last[1]}, ${display(item[1] ?? "")}`;
    }
  }
  return { fields, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}
