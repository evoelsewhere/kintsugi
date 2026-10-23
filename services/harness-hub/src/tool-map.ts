import {
  documentPageSchema,
  documentQuerySchema,
  documentSearchQuerySchema,
  documentSearchResultSchema,
  projectListResultSchema,
  projectQuerySchema,
  reviewQuerySchema,
  reviewReportSchema,
  taskBriefQuerySchema,
  taskBriefSchema,
  taskListResultSchema,
  taskQuerySchema,
  taskStatusQuerySchema,
  taskStatusSchema,
  type CodingAgentWorkflowCapabilities,
  type CodingAgentWorkflowPort,
} from "@kintsugi/harness-sdk";
import type { McpServer } from "@modelcontextprotocol/server";

export const CODING_AGENT_WORKFLOW_TOOL_NAMES = [
  "project_list",
  "task_list",
  "task_brief",
  "document_get",
  "document_search",
  "review_get",
  "task_status",
] as const;

export type CodingAgentWorkflowToolName = (typeof CODING_AGENT_WORKFLOW_TOOL_NAMES)[number];

export function getCodingAgentWorkflowToolNames(
  capabilities: CodingAgentWorkflowCapabilities,
): CodingAgentWorkflowToolName[] {
  return CODING_AGENT_WORKFLOW_TOOL_NAMES.filter((name) => name !== "review_get" || capabilities.reviews);
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const READ_ONLY_SNAPSHOT = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
} as const;

function toolFailure(error: unknown) {
  const candidate = error !== null && typeof error === "object" ? error as { code?: unknown } : {};
  const code = typeof candidate.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate.code)
    ? candidate.code
    : "KINTSUGI_REQUEST_FAILED";
  return {
    content: [{ type: "text" as const, text: "Kintsugi request failed (" + code + ")." }],
    isError: true,
  };
}

async function invokeRead<T extends object>(read: () => Promise<T>) {
  try {
    const result = await read();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: { ...result },
    };
  } catch (error) {
    return toolFailure(error);
  }
}

export function registerCodingAgentWorkflowTools(
  server: McpServer,
  access: CodingAgentWorkflowPort,
  capabilities: CodingAgentWorkflowCapabilities,
): void {
  server.registerTool("project_list", {
    title: "List Kintsugi projects",
    description: "List projects the authenticated member can access.",
    inputSchema: projectQuerySchema,
    outputSchema: projectListResultSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => access.listProjects(query)));

  server.registerTool("task_list", {
    title: "List Kintsugi tasks",
    description: "List tasks in the explicitly selected project.",
    inputSchema: taskQuerySchema,
    outputSchema: taskListResultSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => access.listTasks(query)));

  server.registerTool("task_brief", {
    title: "Read a task brief",
    description: "Prepare or retrieve a task brief and its immutable context snapshot. Preparing a brief stores a temporary snapshot. Pass its snapshotId to later document reads and searches.",
    inputSchema: taskBriefQuerySchema,
    outputSchema: taskBriefSchema,
    annotations: READ_ONLY_SNAPSHOT,
  }, (query) => invokeRead(() => access.briefTask(query)));

  server.registerTool("document_get", {
    title: "Read a document section",
    description: "Read a registered source from the explicit task context snapshot.",
    inputSchema: documentQuerySchema,
    outputSchema: documentPageSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => access.getDocument(query)));

  server.registerTool("document_search", {
    title: "Search task context",
    description: "Search registered sources within the explicit task context snapshot.",
    inputSchema: documentSearchQuerySchema,
    outputSchema: documentSearchResultSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => access.searchDocuments(query)));

  if (capabilities.reviews) {
    server.registerTool("review_get", {
      title: "Read a task review",
      description: "Read a review report available to the authenticated member.",
      inputSchema: reviewQuerySchema,
      outputSchema: reviewReportSchema,
      annotations: READ_ONLY,
    }, (query) => invokeRead(() => access.getReview(query)));
  }

  server.registerTool("task_status", {
    title: "Read task status",
    description: "Read current task, pull request, review availability, and gate references.",
    inputSchema: taskStatusQuerySchema,
    outputSchema: taskStatusSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => access.taskStatus(query)));
}
