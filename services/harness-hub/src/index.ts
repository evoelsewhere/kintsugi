import type { MemberPort } from "@kintsugi/harness-sdk";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMemberMcp } from "./member-mcp.js";

export { createMemberMcp } from "./member-mcp.js";
export { MEMBER_TOOL_NAMES, registerMemberTools } from "./tool-map.js";
export type { MemberToolName } from "./tool-map.js";
export {
  AGENT_PLUGINS_MCP_SCHEMA,
  AGENT_PLUGINS_SCHEMA,
  KINTSUGI_PLUGIN_NAME,
  PluginSetupError,
  generateConnectorPlugin,
  type ConnectorPluginInput,
  type HarnessClient,
  type GeneratedPluginFiles,
} from "./plugins/generate.js";
export {
  CLIENT_COMPATIBILITY,
  assertClientCompatibility,
  type ClientCompatibility,
} from "./plugins/compatibility.js";
export {
  applyClientSetup,
  codexDesktopPluginName,
  generateConnectorMarketplace,
  planCodexDesktopSetup,
  planClientSetup,
  stageCodexDesktopPlugin,
  type CodexDesktopSetupInput,
  type SetupChange,
  type SetupFileDeps,
  type SetupInput,
  type SetupReport,
} from "./plugins/setup.js";

export interface StdioDeps {
  member: MemberPort;
}

export async function serveMemberStdio(deps: StdioDeps): Promise<void> {
  const handle = serveStdio(() => createMemberMcp(deps.member));

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
