import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { apiFor, emit, projectId, type CommandOptions } from "./shared.js";

export function registerDocumentCommands(program: Command, deps: CliDeps): void {
  const document = program.command("document").description("Read the project's document repository");
  document.command("tree [path]")
    .description("List a directory of the document repository")
    .option("--project <id>", "Project id")
    .option("--ref <ref>", "Branch or commit (default branch when omitted)")
    .action(async function(this: Command, path: string | undefined) {
      const options = this.optsWithGlobals() as CommandOptions & { ref?: string };
      const { client, profile } = await apiFor(deps, this);
      const tree = await client.documentTree({ projectId: projectId(options, profile.projectId), ...(options.ref === undefined ? {} : { ref: options.ref }), ...(path === undefined ? {} : { path }) });
      emit(deps, this, tree);
    });
  document.command("get <path>")
    .description("Read a Markdown file of the document repository")
    .option("--project <id>", "Project id")
    .option("--ref <ref>", "Branch or commit (default branch when omitted)")
    .action(async function(this: Command, path: string) {
      const options = this.optsWithGlobals() as CommandOptions & { ref?: string };
      const { client, profile } = await apiFor(deps, this);
      const file = await client.documentFile({ projectId: projectId(options, profile.projectId), path, ...(options.ref === undefined ? {} : { ref: options.ref }) });
      emit(deps, this, file);
    });
}
