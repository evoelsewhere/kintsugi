// What a member plugin may carry onto a member's machine (ADR-0069, ADR-0072). Files are text: skills, and for the clients
// that read them, agents and commands. A plugin never brings code of its own, with one narrow exception: a command, agent
// or skill may declare hooks in its front matter, and a hook may only call `kintsugi activity hook`, which reports to the
// project's monitoring what the command did (who, how long, how many tokens). Nothing else runs.

import { isScalar, parseDocument, visit } from "yaml";

/** The only command a distributed hook may run. */
export const ACTIVITY_HOOK_COMMAND = /^kintsugi activity hook (?:start|stop|end) --plugin [a-z0-9][a-z0-9_-]{0,63} --command [a-z0-9][a-z0-9_-]{0,63}(?: --harness (?:claude-code|codex|copilot))?$/;

/** The clients a hook can report for; a hook declared in a command's front matter runs in Claude Code, which is the default. */
export const ACTIVITY_HARNESSES = ["claude-code", "codex", "copilot"] as const;
export type ActivityHarness = (typeof ACTIVITY_HARNESSES)[number];

export class DistributableError extends Error {
  readonly code = "PLUGIN_FILE_NOT_DISTRIBUTABLE";
}

const NOT_ALLOWED = "declares a hook that is not allowed: a distributed hook may only run `kintsugi activity hook`";

/** The keys a matcher group and a hook handler may have; anything else (a prompt, a URL, a shell, a condition) is refused. */
const GROUP_KEYS = new Set(["matcher", "hooks"]);
const HANDLER_KEYS = new Set(["type", "command", "timeout"]);

/**
 * The front matter a client may read: the lines after an opening `---` up to a closing one. Parsers differ on a closing
 * line with trailing spaces, so each reading is returned; `[]` without front matter, `undefined` when it is never closed.
 */
function frontMattersOf(content: string): string[] | undefined {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return [];
  const ends = new Set([lines.indexOf("---", 1), lines.findIndex((line, index) => index > 0 && line.trim() === "---")].filter((end) => end > 0));
  return ends.size === 0 ? undefined : [...ends].map((end) => lines.slice(1, end).join("\n"));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmptyList = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0;

/** What reading a front matter's hooks gave: the activity hook commands it declares, or why the file is refused. */
type HookReading = { commands: string[] } | { refused: string };

/** The first line of a YAML parser message, without where the parser was (the file is named anyway). */
const yamlProblem = (message: string): string => (message.split("\n")[0] ?? message).replace(/ at line \d+, column \d+:?$/, "");

/**
 * The commands of a front matter's hooks when it is safe to read them as YAML does: it parses cleanly, has no alias,
 * anchor, merge key or collection as a key, and `hooks` has exactly the allowed shape, every command being the
 * activity hook. Front matter that does not parse is refused even without the word `hooks`: an escaped key can spell it.
 */
function readHooks(frontMatter: string): HookReading {
  const document = parseDocument(frontMatter, { uniqueKeys: true, prettyErrors: false });
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem !== undefined) return { refused: `has front matter that is not valid YAML (${yamlProblem(problem.message)}); a distributed file's front matter must parse` };
  let tricky = false;
  visit(document, {
    Alias: () => { tricky = true; return visit.BREAK; },
    Node: (_key, node) => { if (node.anchor !== undefined) { tricky = true; return visit.BREAK; } return undefined; },
    Pair: (_key, pair) => { if (!isScalar(pair.key) || pair.key.value === "<<") { tricky = true; return visit.BREAK; } return undefined; },
  });
  if (tricky) return { refused: "has front matter with an alias, an anchor, a merge key or a collection as a key, which a distributed file may not use" };
  const root: unknown = document.toJS();
  if (root === null || root === undefined) return { commands: [] };
  if (!isRecord(root)) return { refused: "has front matter that is not a mapping of keys to values" };
  // A client that matched keys loosely would read these as hooks.
  if (Object.keys(root).some((key) => key !== "hooks" && key.trim().toLowerCase() === "hooks")) return { refused: NOT_ALLOWED };
  if (!("hooks" in root)) return { commands: [] };
  const { hooks } = root;
  if (!isRecord(hooks) || Object.keys(hooks).length === 0) return { refused: NOT_ALLOWED };
  const commands: string[] = [];
  for (const groups of Object.values(hooks)) {
    if (!nonEmptyList(groups)) return { refused: NOT_ALLOWED };
    for (const group of groups) {
      if (!isRecord(group) || Object.keys(group).some((key) => !GROUP_KEYS.has(key))) return { refused: NOT_ALLOWED };
      if (group["matcher"] !== undefined && typeof group["matcher"] !== "string") return { refused: NOT_ALLOWED };
      if (!nonEmptyList(group["hooks"])) return { refused: NOT_ALLOWED };
      for (const handler of group["hooks"]) {
        if (!isRecord(handler) || Object.keys(handler).some((key) => !HANDLER_KEYS.has(key))) return { refused: NOT_ALLOWED };
        const { type, command, timeout } = handler;
        if (type !== "command" || typeof command !== "string" || !ACTIVITY_HOOK_COMMAND.test(command)) return { refused: NOT_ALLOWED };
        if (timeout !== undefined && !(typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0)) return { refused: NOT_ALLOWED };
        commands.push(command);
      }
    }
  }
  return { commands };
}

/** The hook commands a file declares in its front matter (none when it declares no hooks or declares them in a refused shape). */
export function hookCommandsOf(content: string): string[] {
  const frontMatters = frontMattersOf(content) ?? [];
  return [...new Set(frontMatters.flatMap((frontMatter) => {
    const reading = readHooks(frontMatter);
    return "commands" in reading ? reading.commands : [];
  }))];
}

/**
 * Throws unless every hook the file declares is the activity hook. The front matter is read as YAML, as a client reads it,
 * and checked strictly: a file that declares hooks in any other shape (a prompt, an agent, a URL, a script, a second key,
 * an alias), or whose front matter does not parse, is refused whole, with the reason.
 */
export function assertSafeHooks(path: string, content: string): void {
  if (!path.endsWith(".md")) return;
  const frontMatters = frontMattersOf(content);
  // An opening line that is never closed is no front matter, unless some client reads it as one.
  if (frontMatters === undefined) {
    if (/hooks/i.test(content)) throw new DistributableError(`${path} has front matter that is never closed and mentions hooks; ${NOT_ALLOWED}`);
    return;
  }
  for (const frontMatter of frontMatters) {
    const reading = readHooks(frontMatter);
    if ("refused" in reading) throw new DistributableError(`${path} ${reading.refused}`);
  }
}

/** The plugin and command an activity hook command line reports for, or undefined when the line is not an activity hook. */
export function activityHookOf(commandLine: string): { event: "start" | "stop" | "end"; plugin: string; command: string } | undefined {
  if (!ACTIVITY_HOOK_COMMAND.test(commandLine)) return undefined;
  const words = commandLine.split(" ");
  return { event: words[3] as "start" | "stop" | "end", plugin: words[5]!, command: words[7]! };
}
