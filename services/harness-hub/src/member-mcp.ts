import { McpServer } from "@modelcontextprotocol/server";
import type {
  CodingAgentWorkflowCapabilities,
  CodingAgentWorkflowPort,
} from "@kintsugi/harness-sdk";
import { registerCodingAgentWorkflowTools } from "./tool-map.js";

export function createCodingAgentWorkflowMcp(
  access: CodingAgentWorkflowPort,
  capabilities: CodingAgentWorkflowCapabilities,
): McpServer {
  const server = new McpServer(
    { name: "kintsugi-coding-agent-workflow", version: "0.1.0" },
    { instructions: "Use explicit project, task, and snapshot identifiers. All tools are read-only; Kintsugi authorization is enforced on every request." },
  );
  registerCodingAgentWorkflowTools(server, access, capabilities);
  return server;
}
