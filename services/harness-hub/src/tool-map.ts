import {
  documentFileQuerySchema,
  documentFileSchema,
  documentTreeQuerySchema,
  documentTreeSchema,
  projectListResultSchema,
  projectQuerySchema,
  type MemberPort,
} from "@kintsugi/harness-sdk";
import type { McpServer } from "@modelcontextprotocol/server";

export const MEMBER_TOOL_NAMES = ["project_list", "document_tree", "document_get"] as const;

export type MemberToolName = (typeof MEMBER_TOOL_NAMES)[number];

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
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

/** The common member tools; flows beyond them are added by plugins. */
export function registerMemberTools(server: McpServer, member: MemberPort): void {
  server.registerTool("project_list", {
    title: "List Kintsugi projects",
    description: "List projects the authenticated member can access.",
    inputSchema: projectQuerySchema,
    outputSchema: projectListResultSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => member.listProjects(query)));

  server.registerTool("document_tree", {
    title: "List a document directory",
    description: "List a directory of the project's document repository at a branch or commit (the default branch when omitted).",
    inputSchema: documentTreeQuerySchema,
    outputSchema: documentTreeSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => member.documentTree(query)));

  server.registerTool("document_get", {
    title: "Read a document",
    description: "Read a Markdown file of the project's document repository at a branch or commit (up to 2 MiB).",
    inputSchema: documentFileQuerySchema,
    outputSchema: documentFileSchema,
    annotations: READ_ONLY,
  }, (query) => invokeRead(() => member.documentFile(query)));
}
