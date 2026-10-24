// What a member plugin may carry onto a member's machine (ADR-0069, ADR-0072). Files are text: skills, and for the clients
// that read them, agents and commands. A plugin never brings code of its own, with one narrow exception: a command, agent
// or skill may declare hooks in its front matter, and a hook may only call `kintsugi activity hook`, which reports to the
// project's monitoring what the command did (who, how long, how many tokens). Nothing else runs.

/** The only command a distributed hook may run. */
export const ACTIVITY_HOOK_COMMAND = /^kintsugi activity hook (?:start|stop|end) --plugin [a-z0-9][a-z0-9_-]{0,63} --command [a-z0-9][a-z0-9_-]{0,63}(?: --harness (?:claude-code|codex|copilot))?$/;

/** The clients a hook can report for; a hook declared in a command's front matter runs in Claude Code, which is the default. */
export const ACTIVITY_HARNESSES = ["claude-code", "codex", "copilot"] as const;
export type ActivityHarness = (typeof ACTIVITY_HARNESSES)[number];

export class DistributableError extends Error {
  readonly code = "PLUGIN_FILE_NOT_DISTRIBUTABLE";
}

function frontMatterOf(content: string): string | undefined {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  const end = lines.indexOf("---", 1);
  return end < 0 ? undefined : lines.slice(1, end).join("\n");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed;
}

/** The hook commands a file declares in its front matter (none when it declares no hooks). */
export function hookCommandsOf(content: string): string[] {
  const frontMatter = frontMatterOf(content);
  if (frontMatter === undefined || !/^hooks\s*:/m.test(frontMatter)) return [];
  return [...frontMatter.matchAll(/^\s*-?\s*command\s*:\s*(.+)$/gm)].map((match) => unquote(match[1] ?? ""));
}

/**
 * Throws unless every hook the file declares is the activity hook. The check is deliberately syntactic and strict: a file
 * that declares hooks in any other shape (a prompt, an agent, a URL, a script, a second key) is refused whole.
 */
export function assertSafeHooks(path: string, content: string): void {
  if (!path.endsWith(".md")) return;
  const frontMatter = frontMatterOf(content);
  if (frontMatter === undefined || !/^hooks\s*:/m.test(frontMatter)) return;
  const commands = hookCommandsOf(content);
  const types = [...frontMatter.matchAll(/^\s*-?\s*type\s*:\s*(.+)$/gm)].map((match) => unquote(match[1] ?? ""));
  const keys = [...frontMatter.matchAll(/^\s*-?\s*(url|prompt|agent|script|shell|if|matcher)\s*:/gm)].map((match) => match[1]);
  if (commands.length === 0 || types.some((type) => type !== "command") || keys.some((key) => key !== "matcher") || !commands.every((command) => ACTIVITY_HOOK_COMMAND.test(command))) {
    throw new DistributableError(`${path} declares a hook that is not allowed: a distributed hook may only run \`kintsugi activity hook\``);
  }
}

/** The plugin and command an activity hook command line reports for, or undefined when the line is not an activity hook. */
export function activityHookOf(commandLine: string): { event: "start" | "stop" | "end"; plugin: string; command: string } | undefined {
  if (!ACTIVITY_HOOK_COMMAND.test(commandLine)) return undefined;
  const words = commandLine.split(" ");
  return { event: words[3] as "start" | "stop" | "end", plugin: words[5]!, command: words[7]! };
}
