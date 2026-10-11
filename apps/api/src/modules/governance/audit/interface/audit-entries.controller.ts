// Interface layer: the audit log, read-only over HTTP (entries are written by the use cases
// they audit). Needs audit.read.

import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Page } from "#common/application/pagination.js";
import { RequirePermission } from "#common/auth/decorators.js";
import { AuditService } from "../application/audit.service.js";
import type { AuditEntry } from "../domain/audit-entry.js";
import { type ListAuditQuery, listAuditQuerySchema } from "./audit.dto.js";

@ApiTags("governance · audit & traceability")
@Controller("governance/audit")
@RequirePermission("audit.read")
export class AuditEntriesController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: "List audit entries, newest first (filter by actions, actor, subject, project)" })
  @ApiOkResponse({ description: "A page of audit entries." })
  list(@Query({ schema: listAuditQuerySchema }) query: ListAuditQuery): Promise<Page<AuditEntry>> {
    return this.audit.list({
      limit: query.limit,
      offset: query.offset,
      ...(query.action === undefined ? {} : { actions: query.action }),
      ...(query.actor === undefined ? {} : { actor: query.actor }),
      ...(query.subject === undefined ? {} : { subject: query.subject }),
      ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    });
  }

  @Get("actions")
  @ApiOperation({ summary: "List the actions the audit log records (for filters)" })
  @ApiOkResponse({ description: "The action names, sorted." })
  actions(): readonly string[] {
    return this.audit.actions();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one audit entry" })
  @ApiOkResponse({ description: "The entry." })
  get(@Param("id") id: string): Promise<AuditEntry> {
    return this.audit.get(id);
  }
}
