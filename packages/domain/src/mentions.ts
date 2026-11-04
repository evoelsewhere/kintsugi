/**
 * Mentions in a comment (COL-08, COL-10, COL-18, ADR-0099): `@username` names a person. The text is read for names here;
 * which of them are people with Project Access is the server's to say, and it says nothing of the ones that are not, so a
 * mention never shows who exists or who may read a project.
 */

/** The most names read from one text: a comment is at most a few thousand characters, and nobody mentions hundreds. */
export const MENTIONS_MAX = 50;

/** A username: a letter or a digit, then letters, digits, `.`, `_` and `-`. */
const MENTION = /(?<![A-Za-z0-9_@])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/** The lines of a text outside code fences, and with inline code taken out. */
function proseOf(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== undefined) {
      if (open?.[1] !== undefined && open[1][0] === fence[0] && open[1].length >= fence.length) fence = undefined;
      out.push("");
      continue;
    }
    if (open?.[1] !== undefined) {
      fence = open[1];
      out.push("");
      continue;
    }
    out.push(line.replace(/(`+)[^`]*?\1/g, " "));
  }
  return out.join("\n");
}

/**
 * The usernames a text mentions, in lower case, once each, in the order they come: `@ada` at the start of the text or of a
 * line, or after white space or punctuation. `a@b.c` is an address, not a mention; code in a fence or between back ticks is
 * not read; a full stop, a hyphen or an underscore that ends the name belongs to the sentence (`@ada.`).
 */
export function mentionsOf(text: string): string[] {
  const names: string[] = [];
  for (const match of proseOf(text).matchAll(MENTION)) {
    const name = (match[1] ?? "").replace(/[._-]+$/, "").toLowerCase();
    if (name !== "" && !names.includes(name)) names.push(name);
    if (names.length >= MENTIONS_MAX) break;
  }
  return names;
}

/** A person of the directory a mention is looked up in. */
export interface MentionablePerson {
  id: string;
  username: string;
}

/**
 * The ids of the people the names are, from a directory of the people the project's access lets in. A name that is not in
 * the directory is left out and not reported, whether nobody has it or the person has no access: the answer is the same, so
 * the comment does not tell which. Each person once, in the order of the names.
 */
export function resolveMentions(names: readonly string[], directory: readonly MentionablePerson[]): string[] {
  const byName = new Map(directory.map((person) => [person.username.toLowerCase(), person.id]));
  const ids: string[] = [];
  for (const name of names) {
    const id = byName.get(name.toLowerCase());
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
