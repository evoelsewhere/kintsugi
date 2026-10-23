// JobSpec validation before anything starts: the kernel refuses jobs it cannot run safely
// instead of failing half-way.

import { statSync } from "node:fs";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { isMcpToolEntry, mcpHeaderValueProblem, mcpServerOfEntry, MCP_SERVER_ID_PATTERN } from "@kintsugi/domain";
import { isKernelToolName, KERNEL_TOOL_NAMES } from "./tool-names.js";

const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

/** Throws with every problem found; returns nothing when the job is runnable. */
export function validateJobSpec(spec: JobSpec): void {
  const problems: string[] = [];
  const { agent, workspace, limits } = spec;

  if (agent.id.trim() === "") problems.push("agent.id is empty");
  if (agent.instructions.trim() === "") problems.push("agent.instructions is empty");
  if (spec.task.trim() === "") problems.push("task is empty");

  const servers = new Map((spec.mcp?.servers ?? []).map((server) => [server.name, server]));
  for (const tool of agent.tools) {
    if (isMcpToolEntry(tool)) {
      const named = mcpServerOfEntry(tool)!;
      if (!servers.has(named)) problems.push(`tool "${tool}" names the MCP server "${named}", which the job was not given`);
    } else if (!isKernelToolName(tool)) problems.push(`unknown tool "${tool}" (available: ${KERNEL_TOOL_NAMES.join(", ")}, or an MCP tool such as mcp__<server>__*)`);
  }
  for (const server of servers.values()) {
    if (!MCP_SERVER_ID_PATTERN.test(server.name)) problems.push(`MCP server id "${server.name}" is not valid`);
    if (!/^https?:\/\/\S+$/.test(server.url)) problems.push(`MCP server "${server.name}" must have an http(s) URL`);
    for (const [name, value] of Object.entries(server.headers)) {
      const problem = mcpHeaderValueProblem(value);
      if (problem !== undefined) problems.push(`MCP server "${server.name}", header "${name}": ${problem}`);
    }
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

  if (workspace.readOnly.length === 0) problems.push("workspace.readOnly needs at least one entry");
  for (const dir of [workspace.root, workspace.outDir]) {
    if (!isDirectory(dir)) problems.push(`not a directory: ${dir}`);
  }
  // The first entry is where a search without a path looks, so it is a directory; the others may be single files (the guide).
  if (workspace.readOnly[0] !== undefined && !isDirectory(workspace.readOnly[0])) problems.push(`not a directory: ${workspace.readOnly[0]}`);
  for (const entry of workspace.readOnly.slice(1)) {
    if (!exists(entry)) problems.push(`does not exist: ${entry}`);
  }

  if (!(limits.timeoutSec >= 0)) problems.push("limits.timeoutSec must be zero (no limit) or positive");
  if (limits.idleTimeoutSec !== undefined && !(limits.idleTimeoutSec >= 0)) problems.push("limits.idleTimeoutSec must be zero (off) or positive");
  if (limits.maxTurns !== undefined && !(limits.maxTurns >= 1)) problems.push("limits.maxTurns must be at least 1");
  if (limits.maxCostUsd !== undefined && !(limits.maxCostUsd > 0)) problems.push("limits.maxCostUsd must be positive");

  if (problems.length > 0) throw new Error(`invalid job: ${problems.join("; ")}`);
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
