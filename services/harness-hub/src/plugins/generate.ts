import { isAbsolute } from "node:path";
import { activityHookOf, assertSafeHooks, DistributableError, hookCommandsOf } from "@kintsugi/harness-sdk";
import { KINTSUGI_MARKS } from "./marks.js";

export type HarnessClient = "claude" | "codex" | "copilot";

export interface ConnectorPluginInput {
  target: HarnessClient;
  /** Absolute Node executable path used to launch the local Kintsugi CLI. */
  launcherPath: string;
  /** Absolute path to the installed Kintsugi CLI entrypoint. */
  cliEntrypointPath: string;
  /** Non-secret local credential profile identifier. */
  profileId: string;
  /** Exact CLI package version embedded in the generated plugin. */
  cliVersion: string;
  /** Optional stable identity used when a personal marketplace can hold several project profiles. */
  pluginName?: string;
  /** Optional user-facing label for the client plugin directory. */
  pluginDisplayName?: string;
}

/**
 * What a member plugin may carry: skills (any text file under a skill), and for the clients that read them, agents and
 * commands as Markdown. Scripts and MCP entries are never distributed, and neither are hook files; the only hook that
 * reaches a member is the activity hook declared in the front matter of a command, agent or skill (see assertSafeHooks).
 */
export function assertDistributablePath(target: HarnessClient, path: string): void {
  const parts = path.split("/");
  const safe = path.length > 0 && path.length <= 300 && !path.includes("\\") && parts.every((part) => part !== "" && part !== "." && part !== "..");
  const skill = /^skills\/[^/]+\/.+$/.test(path);
  const markdown = /^(?:agents|commands)\/[^/]+\.md$/.test(path);
  if (!safe || !(skill || markdown)) throw new PluginSetupError("PLUGIN_FILE_NOT_DISTRIBUTABLE", `A member plugin cannot add ${path} to a ${target} package`);
}

export interface GeneratedPluginFiles {
  pluginName: string;
  files: Record<string, string>;
}

export class PluginSetupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PluginSetupError";
    this.code = code;
  }
}

export const KINTSUGI_PLUGIN_NAME = "kintsugi";
export const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGINS_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function assertInput(input: ConnectorPluginInput): void {
  if (!isAbsolute(input.launcherPath) || !isAbsolute(input.cliEntrypointPath)) {
    throw new PluginSetupError("PLUGIN_LAUNCHER_PATH_INVALID", "Kintsugi's Node executable and CLI entrypoint must be absolute paths");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.profileId)) {
    throw new PluginSetupError("PLUGIN_PROFILE_INVALID", "Kintsugi profile ID is invalid");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.cliVersion)) {
    throw new PluginSetupError("PLUGIN_VERSION_INVALID", "Kintsugi CLI version must be an exact semantic version");
  }
  if (input.pluginName !== undefined && !/^kintsugi(?:-[a-f0-9]{12})?$/.test(input.pluginName)) {
    throw new PluginSetupError("PLUGIN_NAME_INVALID", "Kintsugi plugin name is invalid");
  }
  if (input.pluginDisplayName !== undefined && (input.pluginDisplayName.trim() !== input.pluginDisplayName || input.pluginDisplayName.length < 1 || input.pluginDisplayName.length > 80 || hasControlCharacters(input.pluginDisplayName))) {
    throw new PluginSetupError("PLUGIN_DISPLAY_NAME_INVALID", "Kintsugi plugin display name must be 1 to 80 characters without control characters or surrounding whitespace");
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Generates the native client manifests of the Kintsugi connector: the local MCP server of the signed-in member. */
export function generateConnectorPlugin(input: ConnectorPluginInput): GeneratedPluginFiles {
  assertInput(input);
  const pluginName = input.pluginName ?? KINTSUGI_PLUGIN_NAME;
  const description = "Read Kintsugi projects and documents through a local, read-only MCP connection.";
  const displayName = input.pluginDisplayName ?? "Kintsugi";
  const args = [input.cliEntrypointPath, "mcp", "serve", "--profile", input.profileId];
  const files: Record<string, string> = {};

  if (input.target === "codex") {
    for (const [name, svg] of Object.entries(KINTSUGI_MARKS)) files[`assets/${name}`] = svg;
  }

  if (input.target === "claude") {
    files[".claude-plugin/plugin.json"] = json({
      name: pluginName,
      version: input.cliVersion,
      description,
      author: { name: "Kintsugi" },
      keywords: ["kintsugi", "read-only-context"],
    });
    files[".mcp.json"] = json({
      mcpServers: {
        kintsugi: { command: input.launcherPath, args },
      },
    });
  } else {
    // Codex only accepts a bare executable or a path inside the plugin package.
    const command = input.target === "codex" ? "node" : input.launcherPath;
    files["plugin.json"] = json({
      $schema: AGENT_PLUGINS_SCHEMA,
      name: pluginName,
      version: input.cliVersion,
      description,
      author: { name: "Kintsugi" },
      keywords: ["kintsugi", "read-only-context"],
      ...(input.target === "codex" ? { extensions: { "com.openai": { interface: {
        displayName,
        shortDescription: "Read project-scoped Kintsugi context",
        longDescription: description,
        brandColor: "#1E2A44",
        brandColorDark: "#F4EFE6",
        composerIcon: "./assets/kintsugi-mark-light.svg",
        composerIconDark: "./assets/kintsugi-mark-dark.svg",
        logo: "./assets/kintsugi-mark-light.svg",
        logoDark: "./assets/kintsugi-mark-dark.svg",
      } } } } : {}),
    });
    files["mcp.json"] = json({
      $schema: AGENT_PLUGINS_MCP_SCHEMA,
      mcpServers: {
        kintsugi: { type: "stdio", command, args },
      },
    });
  }
  return { pluginName, files };
}

export interface MemberPluginInput {
  target: HarnessClient;
  /** The plugin's name in Kintsugi (it may hold underscores); the client's name for it is `clientPluginName`. */
  name: string;
  version: string;
  description?: string;
  /** Text files of the plugin, by path relative to the plugin folder. */
  files: Record<string, string>;
}

/** The name a client shows for a plugin: lowercase letters, digits and hyphens, so `/modernize:build` is typed one way. */
export function clientPluginName(name: string): string {
  const converted = name.replace(/_/g, "-");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(converted) || converted === KINTSUGI_PLUGIN_NAME) {
    throw new PluginSetupError("PLUGIN_NAME_INVALID", `The plugin name ${name} cannot be used in a client`);
  }
  return converted;
}

/** The value of a top-level key of a front matter block (`description: "…"`), unquoted. */
function frontValue(lines: readonly string[], key: string): string | undefined {
  const line = lines.find((entry) => entry.startsWith(`${key}:`));
  if (line === undefined) return undefined;
  const value = line.slice(key.length + 1).trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
    return quote === '"' ? (JSON.parse(value) as string) : value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * A command as a skill, for the clients that have no commands (Codex) or whose skills are the one thing every client loads
 * (Copilot): the same text under `skills/<name>/SKILL.md`, run as `/<plugin>:<name>` or `$<name>`. A command's named arguments
 * (`arguments: unit project`, used as `$unit`) become a sentence, since these clients substitute nothing: the member types them
 * after the skill name and the AI reads them from the message. Hooks and other command-only fields are not carried over.
 */
export function commandAsSkill(name: string, content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const end = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  const front = end < 0 ? [] : lines.slice(1, end);
  const body = (end < 0 ? lines : lines.slice(end + 1)).join("\n").replace(/^\n+/, "");
  const description = frontValue(front, "description") ?? `Kintsugi ${name}`;
  const declared = (frontValue(front, "arguments") ?? "").replace(/[[\]]/g, "").split(/[\s,]+/).filter((entry) => /^[A-Za-z][A-Za-z0-9_]*$/.test(entry));
  const converted = declared.reduce((text, argument) => text.replace(new RegExp(`\\$${argument}\\b`, "g"), `<${argument}>`), body);
  const preface = declared.length === 0
    ? ""
    : `The member types the arguments after the name of this skill, in this order: ${declared.map((argument) => `\`<${argument}>\``).join(", ")}. Read them from the member's message; ask for any that is missing, and never guess.\n\n`;
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${preface}${converted}`;
}

type HookEvent = "start" | "stop" | "end";
const HOOK_EVENTS: Record<"codex" | "copilot", Record<HookEvent, string>> = {
  codex: { start: "SessionStart", stop: "Stop", end: "SessionEnd" },
  copilot: { start: "sessionStart", stop: "agentStop", end: "sessionEnd" },
};

/**
 * The hook file for the clients that scope a hook to the whole plugin, not to one command (Codex, Copilot): generated by
 * Kintsugi from the activity hooks the plugin's commands declare in their front matter, each with `--harness` added, so the
 * hook knows which transcript to read. Never taken from the plugin itself. Claude Code keeps the front matter hook.
 */
export function activityHooksFile(target: HarnessClient, files: Readonly<Record<string, string>>): { path: string; content: string } | undefined {
  if (target === "claude") return undefined;
  const wanted = new Map<string, { event: HookEvent; line: string }>();
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith(".md")) continue;
    for (const commandLine of hookCommandsOf(content)) {
      const hook = activityHookOf(commandLine);
      if (hook === undefined) continue;
      const line = `kintsugi activity hook ${hook.event} --plugin ${hook.plugin} --command ${hook.command} --harness ${target}`;
      wanted.set(`${hook.event}:${hook.plugin}:${hook.command}`, { event: hook.event, line });
    }
  }
  if (wanted.size === 0) return undefined;
  const names = HOOK_EVENTS[target];
  const byEvent = new Map<string, string[]>();
  for (const { event, line } of wanted.values()) byEvent.set(names[event], [...(byEvent.get(names[event]) ?? []), line]);
  const hooks = Object.fromEntries([...byEvent].map(([event, lines]) => [
    event,
    target === "codex"
      ? [{ hooks: lines.map((line) => ({ type: "command", command: line, commandWindows: line })) }]
      : lines.map((line) => ({ type: "command", bash: line, powershell: line, timeoutSec: 30 })),
  ]));
  return { path: "hooks/hooks.json", content: json(target === "copilot" ? { version: 1, hooks } : { hooks }) };
}

/**
 * The files a member plugin puts in a client's package, by path inside the plugin's folder: its skills, the commands as skills
 * where the client has no commands (and for Copilot, where skills are what loads), its agents where the client has them, and the
 * generated activity hook file. Every path must be distributable and every front matter hook the activity hook.
 */
export function plannedMemberFiles(target: HarnessClient, files: Readonly<Record<string, string>>): Record<string, string> {
  const planned: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    assertDistributablePath(target, path);
    try { assertSafeHooks(path, content); } catch (error) {
      if (error instanceof DistributableError) throw new PluginSetupError(error.code, error.message);
      throw error;
    }
    const command = /^commands\/([^/]+)\.md$/.exec(path);
    if (target !== "claude" && command !== null) planned[`skills/${command[1]!}/SKILL.md`] = commandAsSkill(command[1]!, content);
    else if (target === "codex" && path.startsWith("agents/")) continue; // Codex has no agents
    else planned[path] = content;
  }
  const hooks = activityHooksFile(target, files);
  if (hooks !== undefined) planned[hooks.path] = hooks.content;
  return planned;
}

/** The plugin package of one distributed member plugin: its own name (so a skill or command is `/<plugin>:<name>`), its files and no MCP entry. */
export function generateMemberPlugin(input: MemberPluginInput): GeneratedPluginFiles {
  const pluginName = clientPluginName(input.name);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version)) {
    throw new PluginSetupError("PLUGIN_VERSION_INVALID", `The version of ${input.name} must be an exact semantic version`);
  }
  const description = input.description?.trim() || `Kintsugi plugin ${input.name}`;
  const manifest = { name: pluginName, version: input.version, description, author: { name: "Kintsugi" }, keywords: ["kintsugi"] };
  // Copilot reads the Claude-style manifest and its default folders (skills/, agents/, hooks/hooks.json); Codex reads the Agent Plugins one.
  const files: Record<string, string> = input.target === "codex"
    ? { "plugin.json": json({ $schema: AGENT_PLUGINS_SCHEMA, ...manifest }) }
    : { ".claude-plugin/plugin.json": json(manifest) };
  for (const [path, content] of Object.entries(plannedMemberFiles(input.target, input.files))) {
    if (Object.hasOwn(files, path)) throw new PluginSetupError("PLUGIN_FILE_CONFLICT", `A member plugin file collides with a generated file: ${path}`);
    files[path] = content;
  }
  return { pluginName, files };
}
