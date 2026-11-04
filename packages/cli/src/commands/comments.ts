import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { apiFor, emit, projectId, type CommandOptions } from "./shared.js";

export function registerCommentsCommand(program: Command, deps: CliDeps): void {
  program.command("comments <path>")
    .description("List the comments of a wiki page: the open ones, with their quotes (--all adds resolved and deleted ones)")
    .option("--project <id>", "Project id")
    .option("--all", "Every comment of the page, resolved and deleted ones too")
    .action(async function(this: Command, path: string) {
      const options = this.optsWithGlobals() as CommandOptions & { all?: boolean };
      const { client, profile } = await apiFor(deps, this);
      const comments = await client.comments({ projectId: projectId(options, profile.projectId), path, status: options.all === true ? "all" : "open" });
      emit(deps, this, comments);
    });
}
