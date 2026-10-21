import { dirname, join } from "node:path";
import type { Command } from "commander";
import { applyClientSetup, planClientSetup, type CodingAgentClient } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { CliError, profileConfigPathFromEnv } from "../profile.js";
import { selectedProfile } from "./shared.js";

const CLIENTS = ["claude", "codex", "copilot"] as const;

export function registerPluginsCommand(program: Command, deps: CliDeps): void {
  const plugins = program.command("plugins").description("Generate native coding-agent plugin packages");
  plugins.command("setup")
    .description("Generate the Kintsugi Coding Agent Workflow package for a local client")
    .requiredOption("--client <client>", "Client: claude, codex, or copilot")
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as { client: string };
      if (!CLIENTS.includes(options.client as (typeof CLIENTS)[number])) {
        throw new CliError("PLUGIN_CLIENT_INVALID", "Client must be claude, codex, or copilot");
      }
      if (deps.launcher === undefined || deps.getClientVersion === undefined) {
        throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI cannot verify its installed launcher and native client versions");
      }
      const target = options.client as CodingAgentClient;
      const { profile } = await selectedProfile(deps, this);
      let clientVersion: string;
      try {
        clientVersion = await deps.getClientVersion(target);
      } catch {
        throw new CliError("PLUGIN_CLIENT_UNAVAILABLE", `Could not read the ${target} CLI version; install it or make it available on PATH`);
      }
      const profilePath = profileConfigPathFromEnv(deps.env, deps.cwd);
      const artifactRoot = join(dirname(profilePath), "plugins", "coding-agent-workflow", target);
      const changes = planClientSetup({
        target,
        clientVersion,
        artifactRoot,
        ...deps.launcher,
        profileId: profile.id,
      });
      const report = await applyClientSetup(changes);
      const format = (this.optsWithGlobals() as { json?: boolean; format?: string }).json ? "json" : (this.optsWithGlobals() as { format?: string }).format ?? "text";
      if (format === "json") {
        deps.stdout.write(`${JSON.stringify({ success: true, data: report }, null, 2)}\n`);
        return;
      }
      if (format === "markdown") {
        const fence = "```";
        const shell = deps.env?.OS === "Windows_NT" || process.platform === "win32" ? "powershell" : "sh";
        deps.stdout.write([
          "# Coding Agent Workflow plugin",
          "",
          `Client: **${target}** (${clientVersion})`,
          `Kintsugi profile: \`${profile.id}\``,
          `Generated package: \`${report.pluginRoot}\``,
          "",
          "## Install",
          "",
          "Run these commands using the native client:",
          "",
          `${fence}${shell}`,
          ...report.installCommands,
          fence,
          "",
          "## Remove",
          "",
          "Run these commands to remove the client installation:",
          "",
          `${fence}${shell}`,
          ...report.rollbackCommands,
          fence,
          "",
          `After removal, delete \`${report.artifactRoot}\` to remove the generated package files.`,
        ].join("\n") + "\n");
        return;
      }
      deps.stdout.write(`Generated ${target} Coding Agent Workflow package at ${report.pluginRoot}\n`);
      deps.stdout.write(`Kintsugi profile: ${profile.id}; ${target} version: ${clientVersion}\n`);
      deps.stdout.write("Register and install it with the native client commands:\n");
      for (const command of report.installCommands) deps.stdout.write(`  ${command}\n`);
      deps.stdout.write("To remove the native installation later:\n");
      for (const command of report.rollbackCommands) deps.stdout.write(`  ${command}\n`);
      deps.stdout.write(`After removing it from the client, delete the generated package directory: ${report.artifactRoot}\n`);
    });
}
