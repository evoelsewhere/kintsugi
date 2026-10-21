import type {
  CodingAgentWorkflowCapabilities,
  CodingAgentWorkflowPort,
} from "@kintsugi/harness-sdk";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createCodingAgentWorkflowMcp } from "./member-mcp.js";

export { createCodingAgentWorkflowMcp } from "./member-mcp.js";
export {
  CODING_AGENT_WORKFLOW_TOOL_NAMES,
  getCodingAgentWorkflowToolNames,
  registerCodingAgentWorkflowTools,
} from "./tool-map.js";
export type { CodingAgentWorkflowToolName } from "./tool-map.js";
export {
  AGENT_PLUGINS_MCP_SCHEMA,
  AGENT_PLUGINS_SCHEMA,
  CODING_AGENT_WORKFLOW_PLUGIN_NAME,
  PluginSetupError,
  generateAccessPlugin,
  type AccessPluginInput,
  type CodingAgentClient,
  type GeneratedPluginFiles,
} from "./plugins/generate.js";
export {
  CODING_AGENT_CLIENT_COMPATIBILITY,
  assertClientCompatibility,
  type ClientCompatibility,
} from "./plugins/compatibility.js";
export {
  applyClientSetup,
  generateAccessMarketplace,
  planClientSetup,
  type SetupChange,
  type SetupFileDeps,
  type SetupInput,
  type SetupReport,
} from "./plugins/setup.js";

export interface StdioDeps {
  access: CodingAgentWorkflowPort;
  capabilities: CodingAgentWorkflowCapabilities;
}

export async function serveCodingAgentStdio(deps: StdioDeps): Promise<void> {
  const handle = serveStdio(() => createCodingAgentWorkflowMcp(deps.access, deps.capabilities));

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("close", onEnd);
      process.stdin.removeListener("error", onError);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const onEnd = () => finish();
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onSigint = () => {
      process.exitCode = 130;
      finish();
    };
    const onSigterm = () => {
      process.exitCode = 143;
      finish();
    };

    process.stdin.once("end", onEnd);
    process.stdin.once("close", onEnd);
    process.stdin.once("error", onError);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });

  await handle.close();
}
