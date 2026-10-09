// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuditEntry } from "../domain/audit-entry.js";
import { AuditEntriesService } from "../application/audit-entries.service.js";

@ApiTags("governance · audit & traceability")
@Controller("governance/audit")
export class AuditEntriesController {
  constructor(private readonly auditEntries: AuditEntriesService) {}

  @Get()
  @ApiOperation({ summary: "List audit entries" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<AuditEntry[]> {
    return this.auditEntries.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one audit entry" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<AuditEntry> {
    return this.auditEntries.get(id);
  }
}
