// One short line per Brain node that has page attributes, printed after a brain tool's JSON so an agent sees a page's
// labels, space and status at a glance. The values come from a page's front matter, so they are printed as plain text,
// one line each, clipped, and never reach a tool description (a page must not write instructions into the tool list).

const MAX_LINES = 30;
const VALUE_MAX = 60;
const ID_MAX = 200;

interface Attributed {
  id: string;
  labels?: unknown;
  space?: unknown;
  status?: unknown;
  owner?: unknown;
  template?: unknown;
}

const plain = (value: string, max: number): string => {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const isNode = (value: unknown): value is Attributed =>
  value !== null && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && typeof (value as { kind?: unknown }).kind === "string";

/** `labels: a, b · space: ENG · status: current` for a node, or an empty string when it has none of them. */
export function pageAttributeLine(node: Attributed): string {
  const parts: string[] = [];
  const labels = Array.isArray(node.labels) ? node.labels.filter((label): label is string => typeof label === "string") : [];
  if (labels.length > 0) parts.push(`labels: ${labels.map((label) => plain(label, VALUE_MAX)).join(", ")}`);
  if (typeof node.space === "string" && node.space !== "") parts.push(`space: ${plain(node.space, VALUE_MAX)}`);
  if (typeof node.status === "string" && node.status !== "") parts.push(`status: ${plain(node.status, VALUE_MAX)}`);
  if (typeof node.owner === "string" && node.owner !== "") parts.push(`owner: ${plain(node.owner, VALUE_MAX)}`);
  if (node.template === true) parts.push("template");
  return parts.join(" · ");
}

/** The page attribute lines of every node in a brain result, in order of appearance, without repeats. */
export function pageAttributeLines(result: unknown): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (lines.length >= MAX_LINES || depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (isNode(value) && !seen.has(value.id)) {
      seen.add(value.id);
      const line = pageAttributeLine(value);
      if (line !== "" && lines.length < MAX_LINES) lines.push(`${plain(value.id, ID_MAX)} — ${line}`);
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(result, 0);
  return lines;
}
