// Request schemas of the MCP server registry (ADR-0016: Standard Schema via zod).

import { mcpHeaderValueProblem, MCP_SERVER_ID_PATTERN } from "@kintsugi/domain";
import { z } from "zod";
import type { RegisterMcpServer } from "../domain/mcp-server.js";

const url = z
  .string()
  .min(1)
  .max(2000)
  .refine((value) => /^https?:\/\/\S+$/.test(value), { message: "Must be an http:// or https:// URL." });

const headerName = z.string().regex(/^[A-Za-z0-9-]{1,100}$/, "Header names use letters, digits and dashes.");

/** `null` keeps the stored value on a replace. Values pi would interpret (`!command`, `${VAR}`) are refused. */
const headers = z
  .record(headerName, z.string().min(1).max(8192).nullable())
  .refine((entries) => new Set(Object.keys(entries).map((name) => name.toLowerCase())).size === Object.keys(entries).length, { message: "Header names must be unique (case-insensitive)." })
  .superRefine((entries, context) => {
    for (const [name, value] of Object.entries(entries)) {
      const problem = value === null ? undefined : mcpHeaderValueProblem(value);
      if (problem !== undefined) context.addIssue({ code: "custom", path: [name], message: problem });
    }
  })
  .default({});

const fields = {
  url,
  description: z.string().min(1).max(500).optional(),
  enabled: z.boolean().default(true),
  timeoutSec: z.number().int().min(1).max(300).default(60),
  /** Tool-name patterns (`*` matches any characters) allowed besides the tools the server marks read-only. */
  allowedTools: z.array(z.string().regex(/^[A-Za-z0-9_*]{1,100}$/, "Tool names use letters, digits and underscores; * matches any characters.")).max(100).default([]),
  headers,
};

export const createMcpServerSchema = z
  .object({ id: z.string().regex(MCP_SERVER_ID_PATTERN, "Lowercase letters, digits and dashes, starting with a letter (at most 41 characters)."), ...fields })
  .superRefine((input, context) => {
    if (Object.values(input.headers).some((value) => value === null)) context.addIssue({ code: "custom", path: ["headers"], message: "Header values can only be null when keeping stored ones during a replacement." });
  });
export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;

export const replaceMcpServerSchema = z.object(fields);
export type ReplaceMcpServerInput = z.infer<typeof replaceMcpServerSchema>;

export function toCommand(id: string, input: ReplaceMcpServerInput, actor: string | undefined): RegisterMcpServer {
  return {
    id,
    url: input.url,
    ...(input.description === undefined ? {} : { description: input.description }),
    enabled: input.enabled,
    timeoutSec: input.timeoutSec,
    allowedTools: input.allowedTools,
    headers: input.headers,
    ...(actor === undefined ? {} : { actor }),
  };
}
