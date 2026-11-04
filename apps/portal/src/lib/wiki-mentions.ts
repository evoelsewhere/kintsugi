// @mentions in comments and pages: where a mention starts and ends, what the person is typing when the suggestions should
// open, and what choosing a suggestion does to the text. A name is a mention only where the rules of the thread say
// (`@` at the start or after white space or punctuation, a name of letters, digits, `.`, `_` and `-`, none in code); a
// name that is not in the directory of the project stays plain text, so a mention never tells who has access.

/** A person of the directory (`GET wiki/people?q=`): the name to show, never an email. */
export interface Person {
  id: string;
  username: string;
  displayName: string;
}

const NAME = /^[a-z0-9][a-z0-9._-]*/i;
/** What may stand in front of a mention: nothing (the start), white space or punctuation that opens or separates. */
const BEFORE = /[\s([{<>"'“‘,;:!?\-–—/]/;

/** One mention found in a text: its offsets (the `@` included) and the name (lower case, no trailing `.`, `_` or `-`). */
export interface MentionRange {
  start: number;
  end: number;
  username: string;
}

/** The mentions of a text, in order, none inside a code fence or in inline code. */
export function mentionRanges(text: string): MentionRange[] {
  const found: MentionRange[] = [];
  let inFence = false;
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const fence = /^\s{0,3}(```|~~~)/.test(line);
    if (fence) inFence = !inFence;
    if (!inFence && !fence) {
      let code = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index] as string;
        if (char === "`") {
          code = !code;
          continue;
        }
        if (code || char !== "@") continue;
        if (index > 0 && !BEFORE.test(line[index - 1] as string)) continue;
        const name = NAME.exec(line.slice(index + 1))?.[0];
        if (name === undefined) continue;
        const trimmed = name.replace(/[._-]+$/, "");
        if (trimmed === "") continue;
        found.push({ start: lineStart + index, end: lineStart + index + 1 + trimmed.length, username: trimmed.toLowerCase() });
        index += trimmed.length;
      }
    }
    lineStart += line.length + 1;
  }
  return found;
}

/** The distinct names a text mentions, in order of first appearance. */
export const mentionedNames = (text: string): string[] => [...new Set(mentionRanges(text).map((range) => range.username))];

/** What the person is typing: a `@` before the cursor with the start of a name after it. */
export interface MentionQuery {
  /** The offset of the `@`. */
  start: number;
  /** What is typed after it, up to the cursor (may be empty). */
  query: string;
}

/** The mention being typed at the cursor, or null when the cursor is not at the end of one. */
export function mentionQueryAt(text: string, cursor: number): MentionQuery | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !BEFORE.test(before[at - 1] as string)) return null;
  const typed = before.slice(at + 1);
  if (typed !== "" && !/^[a-z0-9][a-z0-9._-]*$/i.test(typed)) return null;
  return { start: at, query: typed };
}

/** The text and the cursor after a suggestion is chosen: the typed part is replaced by `@username` and a space. */
export function insertMention(text: string, query: MentionQuery, cursor: number, username: string): { text: string; cursor: number } {
  const inserted = `@${username} `;
  const rest = text.slice(cursor);
  // A space already there is not doubled.
  const tail = rest.startsWith(" ") ? rest.slice(1) : rest;
  const next = `${text.slice(0, query.start)}${inserted}${tail}`;
  return { text: next, cursor: query.start + inserted.length };
}

/** A text cut into plain parts and mentions of people the directory knows (an unknown name stays in the plain text). */
export type MentionPart = { text: string } | { mention: string; displayName: string };

export function splitMentions(text: string, directory: ReadonlyMap<string, string>): MentionPart[] {
  const parts: MentionPart[] = [];
  let at = 0;
  for (const range of mentionRanges(text)) {
    const displayName = directory.get(range.username);
    if (displayName === undefined) continue;
    if (range.start > at) parts.push({ text: text.slice(at, range.start) });
    parts.push({ mention: range.username, displayName });
    at = range.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
