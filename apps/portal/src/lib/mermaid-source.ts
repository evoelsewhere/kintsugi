// Fixes what the Mermaid parser cannot take in agent-written diagrams before they are drawn. A `;` ends a statement in
// a sequence or state diagram, so one in a message ("map EIBAID (CSSTRPFY); admit only ENTER") makes the rest of the
// line a statement of its own and the whole diagram fails to parse. It is written as the entity #59;, which draws as `;`.
// The lint of the agents reports the same mistake as a warning (unescaped-semicolon); this makes the diagram readable
// anyway, so one stray character does not hide a diagram, and the source shown beside it stays as written.

const ENTITY_OR_SEMICOLON = /(#\w{1,10};)|;/g;
const escapeSemicolons = (text: string): string => text.replace(ENTITY_OR_SEMICOLON, (match, entity: string | undefined) => entity ?? "#59;");

export function drawableMermaid(source: string): string {
  const kind = /^\s*(?:%%\{[\s\S]*?\}%%\s*)?(sequenceDiagram|stateDiagram(?:-v2)?)\b/m.exec(source)?.[1];
  if (kind === undefined || !source.includes(";")) return source;
  if (kind === "sequenceDiagram") return source.split("\n").map(escapeSemicolons).join("\n");
  // A state diagram: only the text of a transition or description, after the first colon.
  return source
    .split("\n")
    .map((line) => {
      const colon = line.indexOf(":");
      return colon < 0 ? line : line.slice(0, colon + 1) + escapeSemicolons(line.slice(colon + 1));
    })
    .join("\n");
}
