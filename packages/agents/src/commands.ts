// The built-in commands (ADR-0027): the stages of the guided modernization, one Markdown file
// per command under builtin/commands/ (adapted from the upstream code-modernization plugin).
// Their frontmatter says who runs each stage (`metadata.audience`: the runtime, a member's
// harness or the portal itself), which agents it starts, which shared skills it relies on,
// what it writes and where a person decides. The portal lists them as the pipeline; only the
// body is the specification.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { BUILTIN_DIR, builtinPluginDirs } from "./builtin.js";
import { type FlowNode, parseFlow } from "./flow.js";
import { splitFrontmatter } from "./format.js";

export type CommandAudience = "runtime" | "member" | "portal";
export const COMMAND_AUDIENCES: readonly CommandAudience[] = ["runtime", "member", "portal"];

export interface BuiltinCommand {
  /** Stage id: the command without the `modernize-` prefix (`assess`, `extract-rules`; `modernize` for the entry point). */
  id: string;
  /** The command: its file name without `.md` (`modernize-assess`). */
  command: string;
  /** The plugin that carries it. */
  plugin: string;
  description: string;
  audience: CommandAudience;
  /** Agents the stage starts. */
  agents: string[];
  /** Shared skills the stage relies on (a runtime stage's agents load them; members install them). */
  skills: string[];
  /** Paths the stage reads from the document repo or source, using domain-owned layout patterns. */
  reads: string[];
  /** Document-repo paths the stage writes, using domain-owned layout patterns. */
  writes: string[];
  /** Where a person decides before the stage goes on. */
  gates: string[];
  /** What the stage runs, in order (`metadata.flow`); absent for commands a member or the portal carries out. */
  flow?: FlowNode[];
}

/** Pipeline order of the stages; unknown ids follow alphabetically. */
export const COMMAND_ORDER: readonly string[] = [
  "assess",
  "understand",
  "plan-understand",
  "design-architecture",
  "scaffold",
  "design",
  "implement",
  "verify",
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
function parseCommand(text: string, command: string, problems: string[]): Omit<BuiltinCommand, "plugin"> | undefined {
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
  const skills = commandList(metadata, "skills", file, problems);
  const reads = commandList(metadata, "reads", file, problems);
  const writes = commandList(metadata, "writes", file, problems);
  const gates = commandList(metadata, "gates", file, problems);
  const flow = metadata["flow"] === undefined ? undefined : parseFlow(metadata["flow"], `${file}: metadata.flow`, problems);
  if (problems.length > before) return undefined;
  return {
    id: command.startsWith(PREFIX) ? command.slice(PREFIX.length) : command,
    command,
    description: (description as string).trim(),
    audience: audience as CommandAudience,
    agents,
    skills,
    reads,
    writes,
    gates,
    ...(flow === undefined ? {} : { flow }),
  };
}

const rank = (id: string): number => {
  const index = COMMAND_ORDER.indexOf(id);
  return index === -1 ? COMMAND_ORDER.length : index;
};

/** Loads the built-in commands (`<dir>/plugins/<plugin>/commands/*.md`) in pipeline order; throws with every problem when one is invalid. */
export async function loadBuiltinCommands(dir: string = BUILTIN_DIR): Promise<BuiltinCommand[]> {
  const problems: string[] = [];
  const commands: BuiltinCommand[] = [];
  for (const plugin of builtinPluginDirs(dir)) {
    const commandsDir = join(plugin.dir, "commands");
    if (!existsSync(commandsDir)) continue;
    for (const entry of await readdir(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const parsed = parseCommand(await readFile(join(commandsDir, entry.name), "utf8"), entry.name.slice(0, -".md".length), problems);
      if (parsed !== undefined) commands.push({ ...parsed, plugin: plugin.name });
    }
  }
  if (problems.length > 0) throw new Error(`Invalid built-in commands:\n- ${problems.join("\n- ")}`);
  return commands.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
