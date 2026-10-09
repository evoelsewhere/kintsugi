import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GatesService } from "./gates.service.js";
import type { Gate } from "./gate.dto.js";

@ApiTags("governance · quality gates")
@Controller("governance/gates")
export class GatesController {
  constructor(private readonly gates: GatesService) {}

  @Get()
  @ApiOperation({ summary: "List gates" })
  @ApiOkResponse({ description: "The matching gate records." })
  list(): Promise<Gate[]> {
    return this.gates.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one gate" })
  @ApiOkResponse({ description: "The gate." })
  get(@Param("id") id: string): Promise<Gate> {
    return this.gates.get(id);
  }
}
