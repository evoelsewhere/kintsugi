// Use cases of the MCP server registry (ADR-0047): register, change and remove the servers agents
// may use, and test a connection. Every change is audited (ids, URLs' host and field names only,
// never header values).

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { matchesToolPattern, mcpToolEntry, mcpToolPrefix } from "@kintsugi/domain";
import { AUDIT_ACTIONS, AuditTrail, auditRecord } from "#common/audit/audit-trail.js";
import type { Actor } from "#common/auth/decorators.js";
import type { McpServerRecord, RegisterMcpServer } from "../domain/mcp-server.js";
import { McpProbe, McpServerRepository } from "../domain/mcp-server.ports.js";

/** Presentation: the record, the prefix of its tools and the `tools` entry an agent uses to name it. */
export interface McpServerView extends McpServerRecord {
  toolPrefix: string;
  toolEntry: string;
}

/** What an agent builder offers: which servers exist, never where they are or how they are reached. */
export interface McpServerChoice {
  id: string;
  description?: string;
  enabled: boolean;
  toolEntry: string;
}

export interface McpTestedTool {
  /** The name the model sees: `mcp__<server>__<tool>`. */
  name: string;
  description?: string;
  /** The server marks the tool read-only. */
  readOnly: boolean;
  /** The tool runs in a job: read-only, or allowed by name. */
  allowed: boolean;
}

export interface McpTestResult {
  ok: boolean;
  message: string;
  serverName?: string;
  tools: McpTestedTool[];
}

const toolName = (id: string, name: string): string => `${mcpToolPrefix(id)}${name.replace(/[^A-Za-z0-9]/g, "_")}`;

function toView(record: McpServerRecord): McpServerView {
  return { ...record, toolPrefix: mcpToolPrefix(record.id), toolEntry: mcpToolEntry(record.id) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/** The names of the settings a replacement changes (header values are never compared or recorded). */
function changedFields(existing: McpServerRecord, input: RegisterMcpServer): string[] {
  const fields: string[] = [];
  if (existing.url !== input.url) fields.push("url");
  if ((existing.description ?? "") !== (input.description ?? "")) fields.push("description");
  if (existing.enabled !== input.enabled) fields.push("enabled");
  if (existing.timeoutSec !== input.timeoutSec) fields.push("timeoutSec");
  if (JSON.stringify(existing.allowedTools) !== JSON.stringify(input.allowedTools)) fields.push("allowedTools");
  const entered = Object.entries(input.headers);
  const names = entered.map(([name]) => name.toLowerCase()).sort().join("\n");
  if (names !== existing.headerNames.join("\n") || entered.some(([, value]) => value !== null)) fields.push("headers");
  return fields;
}

@Injectable()
export class McpServersService {
  constructor(
    private readonly servers: McpServerRepository,
    private readonly probe: McpProbe,
    private readonly audit: AuditTrail,
  ) {}

  async list(): Promise<McpServerView[]> {
    return (await this.servers.list()).map(toView);
  }

  async choices(): Promise<McpServerChoice[]> {
    return (await this.servers.list()).map((record) => ({ id: record.id, ...(record.description === undefined ? {} : { description: record.description }), enabled: record.enabled, toolEntry: mcpToolEntry(record.id) }));
  }

  async get(id: string): Promise<McpServerView> {
    return toView(await this.#mustGet(id));
  }

  async create(input: RegisterMcpServer, actor: Actor): Promise<McpServerView> {
    if ((await this.servers.get(input.id)) !== undefined) throw new ConflictException(`MCP server ${input.id} already exists`);
    const created = await this.servers.create({ ...input, actor: actor.username ?? actor.id });
    await this.audit.recordChange(
      auditRecord(actor, AUDIT_ACTIONS.mcpServerCreate, { subject: created.id, detail: { host: hostOf(created.url), enabled: created.enabled, headers: created.headerNames, allowedTools: created.allowedTools } }),
    );
    return toView(created);
  }

  async replace(id: string, input: RegisterMcpServer, actor: Actor): Promise<McpServerView> {
    const existing = await this.#mustGet(id);
    // A stored header is bound to the endpoint it was entered for; otherwise repointing the server would send the kept credential to another host.
    const keepsHeaders = Object.values(input.headers).some((value) => value === null);
    if (originOf(existing.url) !== originOf(input.url) && keepsHeaders) throw new BadRequestException("Changing the server's address requires re-entering its header values");
    const updated = await this.servers.replace(id, { ...input, id, actor: actor.username ?? actor.id });
    if (updated === undefined) throw new NotFoundException(`MCP server ${id} not found`);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.mcpServerUpdate, { subject: id, detail: { host: hostOf(updated.url), fields: changedFields(existing, input) } }));
    return toView(updated);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const existing = await this.servers.get(id);
    if (!(await this.servers.remove(id))) throw new NotFoundException(`MCP server ${id} not found`);
    await this.audit.recordChange(auditRecord(actor, AUDIT_ACTIONS.mcpServerDelete, { subject: id, ...(existing === undefined ? {} : { detail: { host: hostOf(existing.url) } }) }));
  }

  /** Connects with the stored headers and lists the tools, saying which would run in a job. A failure is a result, not an error. */
  async test(id: string): Promise<McpTestResult> {
    const record = await this.#mustGet(id);
    const headers = (await this.servers.resolveHeaders(id)) ?? {};
    try {
      const probed = await this.probe.probe({ url: record.url, headers, timeoutSec: Math.min(record.timeoutSec, 20) });
      const tools = probed.tools.map((tool): McpTestedTool => ({
        name: toolName(id, tool.name),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        readOnly: tool.readOnly,
        allowed: tool.readOnly || record.allowedTools.some((pattern) => matchesToolPattern(pattern, tool.name.replace(/[^A-Za-z0-9]/g, "_"))),
      }));
      const open = tools.filter((tool) => !tool.allowed).length;
      return {
        ok: true,
        message: `Connected: ${tools.length} tool${tools.length === 1 ? "" : "s"}, ${tools.length - open} usable by agents${open === 0 ? "" : ` (${open} need to be allowed by name)`}`,
        ...(probed.serverName === undefined ? {} : { serverName: probed.serverName }),
        tools,
      };
    } catch (error) {
      return { ok: false, message: `Could not connect: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`, tools: [] };
    }
  }

  async #mustGet(id: string): Promise<McpServerRecord> {
    const record = await this.servers.get(id);
    if (record === undefined) throw new NotFoundException(`MCP server ${id} not found`);
    return record;
  }
}
