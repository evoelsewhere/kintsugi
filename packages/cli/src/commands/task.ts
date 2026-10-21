import type { Command } from "commander";
import type { MemberActivity } from "@kintsugi/domain";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { renderBriefMarkdown, writeBrief } from "../render.js";
import { apiFor, emit, projectId, type CommandOptions } from "./shared.js";

const activities: MemberActivity[] = ["design", "implementation", "verification"];

function splitUnit(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (normalized.split("/").filter(Boolean).length !== 3) throw new CliError("TASK_ID_INVALID", "Task identity must be application/module/unit");
  return normalized;
}

export function registerTaskCommands(program: Command, deps: CliDeps): void {
  const task = program.command("task").description("Read tasks, context briefs, and workflow status");
  task.command("list")
    .option("--project <id>", "Project id")
    .option("--mine", "Show tasks assigned to the current member")
    .option("--ready-for <activity>", "Filter by activity readiness")
    .option("--limit <count>", "Maximum results", "25")
    .option("--cursor <cursor>", "Continue a paged result")
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as CommandOptions & { mine?: boolean; readyFor?: string; limit?: string; cursor?: string };
      if (options.readyFor !== undefined && !activities.includes(options.readyFor as MemberActivity)) throw new CliError("ACTIVITY_INVALID", "Activity must be design, implementation, or verification");
      const limit = Number(options.limit ?? 25);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CliError("LIMIT_INVALID", "Limit must be an integer from 1 to 100");
      const { client, profile } = await apiFor(deps, this);
      const result = await client.listTasks({ projectId: projectId(options, profile.projectId), ...(options.mine ? { mine: true } : {}), ...(options.readyFor === undefined ? {} : { readyFor: options.readyFor as MemberActivity }), limit, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) });
      emit(deps, this, result);
    });

  task.command("brief <unitId>")
    .option("--project <id>", "Project id")
    .option("--activity <activity>", "design, implementation, or verification", "implementation")
    .option("--snapshot <id>", "Reuse a specific prepared snapshot")
    .option("--output <path>", "Write a private Markdown brief without overwriting")
    .action(async function(this: Command, unitId: string) {
      const options = this.optsWithGlobals() as CommandOptions & { activity?: string; snapshot?: string; output?: string };
      const activity = options.activity ?? "implementation";
      if (!activities.includes(activity as MemberActivity)) throw new CliError("ACTIVITY_INVALID", "Activity must be design, implementation, or verification");
      const { client, profile } = await apiFor(deps, this);
      const brief = await client.briefTask({ projectId: projectId(options, profile.projectId), unitId: splitUnit(unitId), activity: activity as MemberActivity, ...(options.snapshot === undefined ? {} : { snapshotId: options.snapshot }) });
      const markdown = renderBriefMarkdown(brief);
      if (options.output !== undefined) {
        const destination = await import("node:path").then(({ resolve }) => resolve(deps.cwd, options.output!));
        await writeBrief(destination, brief, { overwrite: false });
        emit(deps, this, { path: destination, snapshotId: brief.snapshotId, requiredContextStatus: brief.requiredContextStatus });
      } else emit(deps, this, brief, markdown);
    });

  task.command("status <unitId>").option("--project <id>", "Project id").action(async function(this: Command, unitId: string) {
    const options = this.optsWithGlobals() as CommandOptions;
    const { client, profile } = await apiFor(deps, this);
    emit(deps, this, await client.taskStatus({ projectId: projectId(options, profile.projectId), unitId: splitUnit(unitId) }));
  });

  task.command("watch <unitId>").description("Watch task changes (requires the streaming milestone)").action(async function() {
    throw new CliError("UNSUPPORTED_CAPABILITY", "Task event streaming is not available yet");
  });

  const review = program.command("review").description("Read review references attached to task status");
  review.command("list").requiredOption("--task <unitId>", "Task identity as application/module/unit").option("--project <id>", "Project id").action(async function(this: Command) {
    const options = this.optsWithGlobals() as CommandOptions & { task: string };
    const { client, profile } = await apiFor(deps, this);
    const status = await client.taskStatus({ projectId: projectId(options, profile.projectId), unitId: splitUnit(options.task) });
    emit(deps, this, status.currentReviewIds.map((reviewId) => ({ reviewId, currentness: "current" })));
  });
  review.command("get <reviewId>").option("--project <id>", "Project id").action(async function(this: Command, reviewId: string) {
    const options = this.optsWithGlobals() as CommandOptions;
    const scopedProjectId = projectId(options);
    const { client } = await apiFor(deps, this);
    emit(deps, this, await client.getReview({ projectId: scopedProjectId, reviewId }));
  });
}
