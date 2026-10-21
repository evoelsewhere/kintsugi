import { isAbsolute } from "node:path";
import { ACCESS_PLUGIN_SOURCE_PATHS, readAccessPluginSources } from "@kintsugi/agents/access-plugin";

export type CodingAgentClient = "claude" | "codex" | "copilot";

export interface AccessPluginInput {
  target: CodingAgentClient;
  /** Absolute Node executable path used to launch the local Kintsugi CLI. */
  launcherPath: string;
  /** Absolute path to the installed Kintsugi CLI entrypoint. */
  cliEntrypointPath: string;
  /** Non-secret local credential profile identifier. */
  profileId: string;
  /** Exact CLI package version embedded in the generated plugin. */
  cliVersion: string;
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

export const CODING_AGENT_WORKFLOW_PLUGIN_NAME = "kintsugi-coding-agent-workflow";
export const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGINS_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

function assertInput(input: AccessPluginInput): void {
  if (!isAbsolute(input.launcherPath) || !isAbsolute(input.cliEntrypointPath)) {
    throw new PluginSetupError("PLUGIN_LAUNCHER_PATH_INVALID", "Kintsugi's Node executable and CLI entrypoint must be absolute paths");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.profileId)) {
    throw new PluginSetupError("PLUGIN_PROFILE_INVALID", "Kintsugi profile ID is invalid");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.cliVersion)) {
    throw new PluginSetupError("PLUGIN_VERSION_INVALID", "Kintsugi CLI version must be an exact semantic version");
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Generates native client manifests from one reviewed access skill and a verified local launcher. */
export function generateAccessPlugin(input: AccessPluginInput): GeneratedPluginFiles {
  assertInput(input);
  const source = readAccessPluginSources();
  const canonicalManifest = JSON.parse(source[".claude-plugin/plugin.json"]) as { name?: string; version?: string };
  const kintsugiManifest = JSON.parse(source["kintsugi.json"]) as { audience?: string; requires?: unknown[] };
  if (canonicalManifest.name !== "access" || kintsugiManifest.audience !== "member" || (kintsugiManifest.requires?.length ?? 0) !== 0) {
    throw new PluginSetupError("ACCESS_PLUGIN_SOURCE_INVALID", "The canonical access plugin must be a standalone member plugin");
  }

  const description = "Read Kintsugi task context and workflow evidence through a local, read-only MCP connection.";
  const args = [input.cliEntrypointPath, "mcp", "serve", "--profile", input.profileId];
  const files: Record<string, string> = {
    "skills/kintsugi-task/SKILL.md": source["skills/kintsugi-task/SKILL.md"],
  };

  if (input.target === "claude") {
    files[".claude-plugin/plugin.json"] = json({
      name: CODING_AGENT_WORKFLOW_PLUGIN_NAME,
      version: input.cliVersion,
      description,
      author: { name: "Kintsugi" },
      keywords: ["kintsugi", "coding-agent-workflow", "read-only-context"],
    });
    files[".mcp.json"] = json({
      mcpServers: {
        kintsugi: { command: input.launcherPath, args },
      },
    });
  } else {
    files["plugin.json"] = json({
      $schema: AGENT_PLUGINS_SCHEMA,
      name: CODING_AGENT_WORKFLOW_PLUGIN_NAME,
      version: input.cliVersion,
      description,
      author: { name: "Kintsugi" },
      keywords: ["kintsugi", "coding-agent-workflow", "read-only-context"],
    });
    files["mcp.json"] = json({
      $schema: AGENT_PLUGINS_MCP_SCHEMA,
      mcpServers: {
        kintsugi: { type: "stdio", command: input.launcherPath, args },
      },
    });
  }

  // The canonical skill is intentionally the only content copied from the built-in plugin.
  for (const path of Object.keys(files)) {
    if (path !== "skills/kintsugi-task/SKILL.md" && path !== "plugin.json" && path !== ".claude-plugin/plugin.json" && path !== "mcp.json" && path !== ".mcp.json") {
      throw new PluginSetupError("ACCESS_PLUGIN_CONTENT_UNEXPECTED", `Unexpected generated plugin file: ${path}`);
    }
  }
  if (!ACCESS_PLUGIN_SOURCE_PATHS.includes("skills/kintsugi-task/SKILL.md")) {
    throw new PluginSetupError("ACCESS_PLUGIN_SOURCE_INVALID", "The canonical access skill is not registered");
  }
  return { pluginName: CODING_AGENT_WORKFLOW_PLUGIN_NAME, files };
}
