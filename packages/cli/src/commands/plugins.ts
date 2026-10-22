import { dirname, join } from "node:path";
import type { Command } from "commander";
import { applyClientSetup, planClientSetup, type CodingAgentClient } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { CliError, profileConfigPathFromEnv } from "../profile.js";
import { selectedProfile } from "./shared.js";

const HARNESS_TARGETS = {
  "claude-code": "claude",
  codex: "codex",
  "copilot-cli": "copilot",
} as const satisfies Record<string, CodingAgentClient>;

export function registerPluginsCommand(program: Command, deps: CliDeps): void {
  const plugins = program.command("plugins").description("Generate native coding-agent plugin packages");
  plugins.command("setup")
    .description("Plan and generate the Kintsugi Coding Agent Workflow package for a local harness")
    .requiredOption("--harness <harness>", "Harness: claude-code, codex, or copilot-cli")
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as { harness: string };
      if (!Object.hasOwn(HARNESS_TARGETS, options.harness)) {
        throw new CliError("PLUGIN_HARNESS_INVALID", "Harness must be claude-code, codex, or copilot-cli");
      }
      if (deps.launcher === undefined || deps.getClientVersion === undefined) {
        throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI cannot verify its installed launcher and native client versions");
      }
      const harness = options.harness as keyof typeof HARNESS_TARGETS;
      const target = HARNESS_TARGETS[harness];
      const { profile } = await selectedProfile(deps, this);
      let clientVersion: string;
      try {
        clientVersion = await deps.getClientVersion(target);
      } catch {
        throw new CliError("PLUGIN_CLIENT_UNAVAILABLE", `Could not read the ${target} CLI version; install it or make it available on PATH`);
      }
      const profilePath = profileConfigPathFromEnv(deps.env, deps.cwd);
      const artifactRoot = join(dirname(profilePath), "plugins", "coding-agent-workflow", harness);
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
        deps.stdout.write(`${JSON.stringify({ success: true, data: { ...report, harness } }, null, 2)}\n`);
        return;
      }
      if (format === "markdown") {
        const fence = "```";
        const shell = deps.env?.OS === "Windows_NT" || process.platform === "win32" ? "powershell" : "sh";
        deps.stdout.write([
          "# Coding Agent Workflow plugin",
          "",
          `Harness: **${harness}** (${clientVersion})`,
          `Kintsugi profile: \`${profile.id}\``,
          `Generated package: \`${report.pluginRoot}\``,
          "",
          "## Package files created or updated",
          "",
          ...(report.written.length === 0 ? ["No package files needed changes."] : report.written.map((path) => `- \`${path}\``)),
          "",
          "## Package files unchanged",
          "",
          ...(report.unchanged.length === 0 ? ["No existing package files were unchanged."] : report.unchanged.map((path) => `- \`${path}\``)),
          "",
          "## Install",
          "",
          "Run these commands using the native client:",
          "",
          `${fence}${shell}`,
          ...report.installCommands,
          fence,
          "",
          "## Rollback",
          "",
          "Run these commands to undo the native client installation:",
          "",
          `${fence}${shell}`,
          ...report.rollbackCommands,
          fence,
          "",
          `After removal, delete \`${report.artifactRoot}\` to remove the generated package files.`,
        ].join("\n") + "\n");
        return;
      }
      deps.stdout.write(`Harness: ${harness} (${clientVersion}); Kintsugi profile: ${profile.id}\n`);
      deps.stdout.write(`Generated package: ${report.pluginRoot}\n`);
      deps.stdout.write("Package files created or updated:\n");
      for (const path of report.written) deps.stdout.write(`  ${path}\n`);
      if (report.written.length === 0) deps.stdout.write("  (none)\n");
      deps.stdout.write("Package files unchanged:\n");
      for (const path of report.unchanged) deps.stdout.write(`  ${path}\n`);
      if (report.unchanged.length === 0) deps.stdout.write("  (none)\n");
      deps.stdout.write("Register and install it with the native client commands:\n");
      for (const command of report.installCommands) deps.stdout.write(`  ${command}\n`);
      deps.stdout.write("Rollback the native client installation with:\n");
      for (const command of report.rollbackCommands) deps.stdout.write(`  ${command}\n`);
      deps.stdout.write(`After removing it from the client, delete the generated package directory: ${report.artifactRoot}\n`);
    });
}
