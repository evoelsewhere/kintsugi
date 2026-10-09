import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CostEntriesService } from "./cost-entries.service.js";
import type { CostEntry } from "./cost-entry.dto.js";

@ApiTags("monitoring · cost & FinOps")
@Controller("monitoring/cost")
export class CostEntriesController {
  constructor(private readonly costEntries: CostEntriesService) {}

  @Get()
  @ApiOperation({ summary: "List cost entries" })
  @ApiOkResponse({ description: "The matching cost-entry records." })
  list(): Promise<CostEntry[]> {
    return this.costEntries.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one cost-entry" })
  @ApiOkResponse({ description: "The cost-entry." })
  get(@Param("id") id: string): Promise<CostEntry> {
    return this.costEntries.get(id);
  }
}
