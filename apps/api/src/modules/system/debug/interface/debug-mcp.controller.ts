// Interface layer: the debug MCP server (ADR-0056). One route, `POST /api/debug/mcp`, Streamable HTTP with JSON replies.
// The route is public to the global guards (a session is not what signs in here) and does its own authentication:
// HTTP Basic, an account holding debug.access. The answers are JSON-RPC, not the API's envelope.

import { Body, Controller, Get, HttpCode, HttpException, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import { Public, SkipCsrf } from "#common/auth/decorators.js";
import { readBuildInfo } from "#modules/system/health/index.js";
import { DebugAccess } from "../application/debug-access.js";
import { type JsonRpcResponse, type McpTool, handleMessage } from "../application/mcp-protocol.js";
import { clip } from "../infrastructure/pg-debug.store.js";

export const DEBUG_TOOLS = Symbol("debug-tools");

const INFO = {
  name: "kintsugi-debug",
  version: readBuildInfo().version,
  instructions:
    "Debug tools of a Kintsugi development installation, all read-only. Start with system.status (is everything up?), runs.list and runs.failure for a run that failed, " +
    "then runs.events, runs.step and runs.ledger for the detail, workspace.tree and workspace.read for what the job's sandbox holds, and logs.search for what the API and the worker printed. " +
    "db.query answers what the tools do not.",
};

@ApiTags("system · debug")
@Controller("debug")
export class DebugMcpController {
  constructor(
    private readonly access: DebugAccess,
    private readonly audit: AuditTrail,
    @Inject(DEBUG_TOOLS) private readonly tools: ReadonlyMap<string, McpTool<void>>,
  ) {}

  @Post("mcp")
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @ApiOperation({ summary: "The debug MCP server (development installations only, KINTSUGI_DEBUG_MCP=1): JSON-RPC over Streamable HTTP, HTTP Basic of an account with debug.access" })
  async mcp(@Req() request: Request, @Res() response: Response, @Body() body: unknown): Promise<void> {
    const actor = await this.access.authenticate(request);
    const onCall = (tool: string, args: unknown): Promise<void> =>
      this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.debugCall, { subject: tool, detail: { args: clip(args, 300) as Record<string, unknown> } }));
    const messages = Array.isArray(body) ? body : [body];
    const answers: JsonRpcResponse[] = [];
    for (const message of messages) {
      const answer = await handleMessage(message, this.tools, INFO, undefined, onCall);
      if (answer !== undefined) answers.push(answer);
    }
    if (answers.length === 0) {
      response.status(202).end();
      return;
    }
    response.status(200).json(Array.isArray(body) ? answers : answers[0]);
  }

  @Get("mcp")
  @Public()
  @ApiOperation({ summary: "Not offered: this server does not stream; POST a JSON-RPC message" })
  stream(): never {
    throw new HttpException("This MCP server answers POST requests only", 405);
  }
}
