// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { CostEntry } from "../domain/cost-entry.js";
import { CostEntriesService } from "../application/cost-entries.service.js";

@ApiTags("monitoring · cost & FinOps")
@Controller("monitoring/cost")
export class CostEntriesController {
  constructor(private readonly costEntries: CostEntriesService) {}

  @Get()
  @ApiOperation({ summary: "List cost entries" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<CostEntry[]> {
    return this.costEntries.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one cost entry" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<CostEntry> {
    return this.costEntries.get(id);
  }
}
