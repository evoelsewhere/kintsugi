// Interface layer: the portfolio overview, read-only. Needs a session (no permission code), like the
// other monitoring reads.

import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PortfolioService } from "../application/portfolio.service.js";
import type { PortfolioOverview } from "../domain/portfolio.js";

@ApiTags("monitoring · portfolio")
@Controller("monitoring")
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get("portfolio")
  @ApiOperation({ summary: "Where each application stands (phase, gate, assessment, catalog), what a person has to decide next, the unit funnel and the riskiest units still to analyse" })
  @ApiOkResponse({ description: "The portfolio overview; parts that cannot be read for an application are null." })
  get(): Promise<PortfolioOverview> {
    return this.portfolio.overview();
  }
}
