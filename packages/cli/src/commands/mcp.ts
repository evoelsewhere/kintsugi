import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { apiForMcp } from "./shared.js";

export function registerMcpCommands(program: Command, deps: CliDeps): void {
  const mcp = program.command("mcp").description("Serve Kintsugi to a local coding agent");
  mcp.command("serve")
    .description("Start the local stdio MCP bridge")
    .action(async function(this: Command) {
      const { client } = await apiForMcp(deps, this);
      await deps.serveMcp(client);
    });
}
