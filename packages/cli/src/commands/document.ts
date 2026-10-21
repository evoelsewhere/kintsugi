import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { apiFor, emit, projectId, type CommandOptions } from "./shared.js";

function validateUnit(value: string): string {
  if (value.trim().replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).length !== 3) throw new CliError("TASK_ID_INVALID", "Task identity must be application/module/unit");
  return value.trim().replace(/^\/+|\/+$/g, "");
}

export function registerDocumentCommands(program: Command, deps: CliDeps): void {
  const document = program.command("document").description("Retrieve content from a prepared task snapshot");
  document.command("get <unitId>")
    .requiredOption("--snapshot <id>", "Prepared snapshot id")
    .requiredOption("--source <id>", "Registered source id")
    .option("--section <id>", "Section id")
    .option("--project <id>", "Project id")
    .option("--cursor <cursor>", "Continue a paged read")
    .action(async function(this: Command, unitId: string) {
      const options = this.optsWithGlobals() as CommandOptions & { snapshot: string; source: string; section?: string; cursor?: string };
      const { client, profile } = await apiFor(deps, this);
      const page = await client.getDocument({ projectId: projectId(options, profile.projectId), unitId: validateUnit(unitId), snapshotId: options.snapshot, sourceId: options.source, ...(options.section === undefined ? {} : { sectionId: options.section }), ...(options.cursor === undefined ? {} : { cursor: options.cursor }) });
      emit(deps, this, page);
    });
  document.command("search <unitId>")
    .requiredOption("--snapshot <id>", "Prepared snapshot id")
    .requiredOption("--query <text>", "Search within the prepared snapshot")
    .option("--project <id>", "Project id")
    .option("--limit <count>", "Maximum number of results", "25")
    .option("--cursor <cursor>", "Continue paged results")
    .action(async function(this: Command, unitId: string) {
      const options = this.optsWithGlobals() as CommandOptions & { snapshot: string; query: string; limit?: string; cursor?: string };
      const limit = Number(options.limit ?? 25);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CliError("LIMIT_INVALID", "Limit must be an integer from 1 to 100");
      const { client, profile } = await apiFor(deps, this);
      const result = await client.searchDocuments({ projectId: projectId(options, profile.projectId), unitId: validateUnit(unitId), snapshotId: options.snapshot, query: options.query, limit, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) });
      emit(deps, this, result);
    });
}
