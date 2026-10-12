// JobSpec validation before anything starts: the kernel refuses jobs it cannot run safely
// instead of failing half-way.

import { statSync } from "node:fs";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { isKernelToolName, KERNEL_TOOL_NAMES } from "./tool-names.js";

const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

/** Throws with every problem found; returns nothing when the job is runnable. */
export function validateJobSpec(spec: JobSpec): void {
  const problems: string[] = [];
  const { agent, workspace, limits } = spec;

  if (agent.id.trim() === "") problems.push("agent.id is empty");
  if (agent.instructions.trim() === "") problems.push("agent.instructions is empty");
  if (spec.task.trim() === "") problems.push("task is empty");

  for (const tool of agent.tools) {
    if (!isKernelToolName(tool)) problems.push(`unknown tool "${tool}" (available: ${KERNEL_TOOL_NAMES.join(", ")})`);
  }
  const skillNames = new Set<string>();
  for (const skill of agent.skills ?? []) {
    if (!SKILL_NAME.test(skill.name)) problems.push(`skill name "${skill.name}" must match ${SKILL_NAME.source}`);
    if (skillNames.has(skill.name)) problems.push(`duplicate skill "${skill.name}"`);
    skillNames.add(skill.name);
  }
  for (const pattern of agent.denyCommandPatterns ?? []) {
    try {
      new RegExp(pattern);
    } catch {
      problems.push(`invalid denyCommandPatterns entry /${pattern}/`);
    }
  }

  if (workspace.readOnly.length === 0) problems.push("workspace.readOnly needs at least one directory");
  for (const dir of [...workspace.readOnly, workspace.outDir]) {
    if (!isDirectory(dir)) problems.push(`not a directory: ${dir}`);
  }

  if (!(limits.timeoutSec >= 0)) problems.push("limits.timeoutSec must be zero (no limit) or positive");
  if (limits.maxTurns !== undefined && !(limits.maxTurns >= 1)) problems.push("limits.maxTurns must be at least 1");
  if (limits.maxCostUsd !== undefined && !(limits.maxCostUsd > 0)) problems.push("limits.maxCostUsd must be positive");

  if (problems.length > 0) throw new Error(`invalid job: ${problems.join("; ")}`);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
