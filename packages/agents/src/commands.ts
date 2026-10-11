// The built-in commands (ADR-0027): the stages of the guided modernization, one Markdown file
// per command under builtin/commands/ (adapted from the upstream code-modernization plugin).
// Their frontmatter says who runs each stage (`metadata.audience`: the runtime, a member's
// harness or the portal itself), which agents it starts, what it writes and where a person
// decides. The portal lists them as the pipeline; only the body is the specification.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_DIR } from "./builtin.js";
import { splitFrontmatter } from "./format.js";

export type CommandAudience = "runtime" | "member" | "portal";
export const COMMAND_AUDIENCES: readonly CommandAudience[] = ["runtime", "member", "portal"];

export interface BuiltinCommand {
  /** Stage id: the command without the `modernize-` prefix (`assess`, `extract-rules`; `modernize` for the entry point). */
  id: string;
  /** The command: its file name without `.md` (`modernize-assess`). */
  command: string;
  description: string;
  audience: CommandAudience;
  /** Agents the stage starts. */
  agents: string[];
  /** Document-repo paths the stage writes (patterns such as `assessment/<app>/ASSESSMENT.md`). */
  writes: string[];
  /** Where a person decides before the stage goes on. */
  gates: string[];
}

/** Pipeline order of the stages; unknown ids follow alphabetically. */
export const COMMAND_ORDER: readonly string[] = [
  "modernize",
  "preflight",
  "assess",
  "map",
  "extract-rules",
  "review",
  "brief",
  "harden",
  "transform",
  "uplift",
  "reimagine",
  "verify",
  "status",
];

const PREFIX = "modernize-";

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");

function commandList(metadata: Record<string, unknown>, field: string, file: string, problems: string[]): string[] {
  const value = metadata[field];
  if (value === undefined || value === null) return [];
  if (isStringList(value)) return value.map((entry) => entry.trim());
  problems.push(`${file}: \`metadata.${field}\` must be a list of strings`);
  return [];
}

/** Parses one command file; `command` is its file name without `.md`. */
function parseCommand(text: string, command: string, problems: string[]): BuiltinCommand | undefined {
  const file = `commands/${command}.md`;
  const document = splitFrontmatter(text, file);
  if (typeof document === "string") {
    problems.push(document);
    return undefined;
  }
  const before = problems.length;
  const description = document.data["description"];
  if (typeof description !== "string" || description.trim() === "") problems.push(`${file}: \`description\` is required`);
  const rawMetadata = document.data["metadata"];
  const metadata = rawMetadata !== null && typeof rawMetadata === "object" && !Array.isArray(rawMetadata) ? (rawMetadata as Record<string, unknown>) : {};
  if (metadata !== rawMetadata) problems.push(`${file}: \`metadata\` must be a mapping`);
  const audience = metadata["audience"];
  if (!COMMAND_AUDIENCES.includes(audience as CommandAudience)) problems.push(`${file}: \`metadata.audience\` must be one of ${COMMAND_AUDIENCES.join(", ")}`);
  const agents = commandList(metadata, "agents", file, problems);
  const writes = commandList(metadata, "writes", file, problems);
  const gates = commandList(metadata, "gates", file, problems);
  if (problems.length > before) return undefined;
  return {
    id: command.startsWith(PREFIX) ? command.slice(PREFIX.length) : command,
    command,
    description: (description as string).trim(),
    audience: audience as CommandAudience,
    agents,
    writes,
    gates,
  };
}

const rank = (id: string): number => {
  const index = COMMAND_ORDER.indexOf(id);
  return index === -1 ? COMMAND_ORDER.length : index;
};

/** Loads the built-in commands (`<dir>/commands/*.md`) in pipeline order; throws with every problem when one is invalid. */
export async function loadBuiltinCommands(dir: string = BUILTIN_DIR): Promise<BuiltinCommand[]> {
  const commandsDir = join(dir, "commands");
  const problems: string[] = [];
  const commands: BuiltinCommand[] = [];
  for (const entry of await readdir(commandsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const parsed = parseCommand(await readFile(join(commandsDir, entry.name), "utf8"), entry.name.slice(0, -".md".length), problems);
    if (parsed !== undefined) commands.push(parsed);
  }
  if (problems.length > 0) throw new Error(`Invalid built-in commands:\n- ${problems.join("\n- ")}`);
  return commands.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
