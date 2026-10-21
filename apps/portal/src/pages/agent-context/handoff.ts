import type { MemberActivity } from "@kintsugi/domain";

export function createTaskHandoffPrompt(projectId: string, unitId: string, activity: MemberActivity): string {
  return [
    "Use the Kintsugi Coding Agent Workflow MCP tools to work on this task.",
    `Project: ${projectId}`,
    `Unit: ${unitId}`,
    `Activity: ${activity}`,
    "Fetch the current task brief, then retrieve every required context section from its pinned snapshot before proposing or changing code.",
    "Cite the source path and lines for requirements. Separate draft, published and approved inputs; report blockers and unresolved decisions instead of guessing.",
    "Keep the work in the repository and branch configured for this task. Open a normal pull request and include the task association values from the brief.",
    "Do not claim a gate is effective until Kintsugi reports that its evidence record merged and became effective.",
  ].join("\n");
}

export function safeProfileName(projectId: string): string {
  const clean = projectId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return clean.length === 0 ? "kintsugi" : `kintsugi-${clean}`;
}

export function clientSetupCommands(origin: string, profile: string, client: "claude" | "codex"): string {
  return [
    `kintsugi auth login --url ${origin} --profile ${profile}`,
    `kintsugi plugins setup --client ${client} --profile ${profile}`,
  ].join("\n");
}
