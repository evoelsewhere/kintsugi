import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/auth/decorators.js";

export interface HealthResponse {
  status: "ok";
  service: string;
  at: string;
}

@ApiTags("system")
@Controller("health")
export class HealthController {
  @Get()
  @Public()
  @ApiOperation({ summary: "Liveness of the API process" })
  @ApiOkResponse({ description: "The API process is up." })
  health(): HealthResponse {
    return { status: "ok", service: "kintsugi-api", at: new Date().toISOString() };
  }
}
