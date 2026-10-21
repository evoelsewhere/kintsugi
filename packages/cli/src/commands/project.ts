import { DEFAULT_LIST_LIMIT } from "@kintsugi/harness-sdk";
import type { Command } from "commander";
import type { CliDeps } from "../cli.js";
import { emit, apiFor } from "./shared.js";
import { CliError } from "../profile.js";

const PROJECT_LOOKUP_MAX_PAGES = 100;

export function registerProjectCommands(program: Command, deps: CliDeps): void {
  const project = program.command("project").description("Choose and inspect authorized projects");
  project.command("list").description("List projects available to this member")
    .option("--limit <count>", "Maximum results", "25")
    .option("--cursor <cursor>", "Continue a paged result")
    .action(async function(this: Command) {
    const { client } = await apiFor(deps, this);
    const options = this.opts<{ limit?: string; cursor?: string }>();
    const limit = Number(options.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CliError("LIMIT_INVALID", "Limit must be an integer from 1 to 100");
    const result = await client.listProjects({ limit, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) });
    emit(deps, this, result);
  });
  project.command("use <projectId>").description("Set the default project on the selected local profile").action(async function(this: Command, projectId: string) {
    const { client, profile } = await apiFor(deps, this);
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let found = false;
    let exhausted = false;
    for (let page = 0; page < PROJECT_LOOKUP_MAX_PAGES; page += 1) {
      const result = await client.listProjects({ limit: DEFAULT_LIST_LIMIT, ...(cursor === undefined ? {} : { cursor }) });
      if (result.items.some((item) => item.projectId === projectId)) {
        found = true;
        break;
      }
      if (result.nextCursor === undefined) {
        exhausted = true;
        break;
      }
      if (seenCursors.has(result.nextCursor)) throw new CliError("PROJECT_PAGINATION_INVALID", "Project list returned a repeated cursor");
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    if (!found && !exhausted) throw new CliError("PROJECT_LOOKUP_LIMIT_EXCEEDED", "Could not verify the project within 100 pages of 25 projects; use project list with --cursor to inspect the remaining pages");
    if (!found) throw new CliError("PROJECT_NOT_AVAILABLE", "Project is not available to this member");
    const config = await deps.profiles.load();
    config.profiles[profile.id] = { ...profile, projectId };
    await deps.profiles.save(config);
    emit(deps, this, { projectId, profile: profile.id });
  });
}
