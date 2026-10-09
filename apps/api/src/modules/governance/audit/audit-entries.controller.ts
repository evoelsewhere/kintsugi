import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditEntriesService } from "./audit-entries.service.js";
import type { AuditEntry } from "./audit-entry.dto.js";

@ApiTags("governance · audit & traceability")
@Controller("governance/audit")
export class AuditEntriesController {
  constructor(private readonly auditEntries: AuditEntriesService) {}

  @Get()
  @ApiOperation({ summary: "List audit entries" })
  @ApiOkResponse({ description: "The matching audit-entry records." })
  list(): Promise<AuditEntry[]> {
    return this.auditEntries.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one audit-entry" })
  @ApiOkResponse({ description: "The audit-entry." })
  get(@Param("id") id: string): Promise<AuditEntry> {
    return this.auditEntries.get(id);
  }
}
