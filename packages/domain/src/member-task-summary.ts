/** Extracts the bounded task summary shared by member briefs and review jobs. */
export interface MemberTaskSummary {
  objective: string;
  acceptanceCriteria: string[];
}

export function memberTaskSummary(markdown: string | undefined, fallbackTitle: string): MemberTaskSummary {
  const objective = markdown === undefined ? undefined : markdownHeading(markdown, "Objective");
  const criteria = markdown === undefined ? undefined : markdownHeading(markdown, "Acceptance criteria");
  return {
    objective: objective?.slice(0, 16_384) || fallbackTitle,
    acceptanceCriteria: markdownBullets(criteria),
  };
}

export function markdownHeading(markdown: string, wanted: string): string | undefined {
  const lines = markdown.split(/\r\n|\n|\r/);
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[index] ?? "");
    if (match === null || match[2]!.trim().toLowerCase() !== wanted.toLowerCase()) continue;
    start = index + 1;
    level = match[1]!.length;
    break;
  }
  if (start < 0) return undefined;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = /^(#{1,6})[ \t]+/.exec(lines[index] ?? "");
    if (match !== null && match[1]!.length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

export function markdownBullets(section: string | undefined): string[] {
  if (section === undefined) return [];
  return section.split(/\r\n|\n|\r/)
    .map((line) => /^(?:[-*+][ \t]+|\d+[.)][ \t]+)(.+)$/.exec(line.trim())?.[1]?.trim())
    .filter((value): value is string => value !== undefined && value.length > 0)
    .slice(0, 100)
    .map((value) => value.slice(0, 2_000));
}
