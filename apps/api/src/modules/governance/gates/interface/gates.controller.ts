// Interface layer: thin HTTP adapter — validates input, maps DTOs to application
// commands, delegates to the use cases. No business logic here.

import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Gate } from "../domain/gate.js";
import { GatesService } from "../application/gates.service.js";

@ApiTags("governance · quality gates")
@Controller("governance/gates")
export class GatesController {
  constructor(private readonly gates: GatesService) {}

  @Get()
  @ApiOperation({ summary: "List gates" })
  @ApiOkResponse({ description: "The matching records." })
  list(): Promise<Gate[]> {
    return this.gates.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one gate" })
  @ApiOkResponse({ description: "The record." })
  get(@Param("id") id: string): Promise<Gate> {
    return this.gates.get(id);
  }
}
