import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "#common/auth/decorators.js";
import { type BuildInfo, readBuildInfo } from "./build-info.js";

export interface HealthResponse {
  status: "ok";
  service: string;
  at: string;
  uptimeSeconds: number;
  build: BuildInfo;
  node: string;
}

const BUILD = readBuildInfo();

@ApiTags("system")
@Controller("health")
export class HealthController {
  @Get()
  @Public()
  @ApiOperation({ summary: "Liveness of the API process and the build that is deployed (version, commit, build time)" })
  @ApiOkResponse({ description: "The API process is up." })
  health(): HealthResponse {
    return {
      status: "ok",
      service: "kintsugi-api",
      at: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      build: BUILD,
      node: process.version,
    };
  }
}
