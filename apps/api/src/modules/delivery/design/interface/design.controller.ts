// Interface layer: the design of a project (ADR-0044, ADR-0045): its design sets and how each unit's
// design documents stand against them. Reading needs a session, like the documents it comes from.

import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import type { JobRunView } from "#modules/delivery/runtime-jobs/index.js";
import { DesignRunsService } from "../application/design-runs.service.js";
import { DesignService } from "../application/design.service.js";
import type { CommonDesignView, DesignActivityView, DesignOverviewView, DesignSetsView, UnitDesignView } from "../domain/design.js";
import { type DesignQuery, type DesignRunBody, type DesignSetsQuery, designQuerySchema, designRunSchema, designSetsQuerySchema } from "./design.dto.js";

@ApiTags("delivery · design")
@Controller("projects/:id")
export class DesignController {
  constructor(
    private readonly design: DesignService,
    private readonly runs: DesignRunsService,
  ) {}

  @Get("design/sets")
  @ApiOperation({
    summary: "The design sets the project defined in 01-standards/templates/, with the faults of their definitions",
    description: "Read at `ref` (default: the default branch). With `app`, each set also reports how that application's units stand with it (how many have a design of the set, and how many were written against an older version).",
  })
  @ApiOkResponse({ description: "The sets in the order they are written, each with its files, the contract of every template section, and the pipeline stages that produce it; and the problems found in the definitions." })
  sets(@Param("id") id: string, @Query({ schema: designSetsQuerySchema }) query: DesignSetsQuery): Promise<DesignSetsView> {
    return this.design.sets(id, query.ref, query.app);
  }

  @Get("applications/:appId/design")
  @ApiOperation({
    summary: "Every unit of the application with the state of its design, per design set",
    description: "A set's state for a unit: problems > missing > stale > waived > conformant, from the checks of the set's templates; not present when the set does not apply to the unit's kind. Derived on every read, never stored.",
  })
  @ApiOkResponse({ description: "The units (kind, wave, owner, per set the state, file counts and whether it is ready to be designed next, and the rules no design covers), the count of units per state for each set, and what needs attention." })
  overview(@Param("id") id: string, @Param("appId") appId: string, @Query({ schema: designQuerySchema }) query: DesignQuery): Promise<DesignOverviewView> {
    return this.design.overview(id, appId, query.ref);
  }

  @Get("applications/:appId/design/activity")
  @ApiOperation({
    summary: "The units whose design set a run is generating or a pull request carries",
    description: "What a new selection cannot take (ADR-0049): per unit and set, `running` (a queued or running design run) or `in-pr` (an open pull request nobody abandoned).",
  })
  @ApiOkResponse({ description: "The unit and set, its state and the run, and the branch and URL of the pull request." })
  activity(@Param("id") id: string, @Param("appId") appId: string): Promise<DesignActivityView> {
    return this.runs.activity(id, appId);
  }

  @RequirePermission("jobs.run")
  @Post("applications/:appId/design/runs")
  @HttpCode(202)
  @ApiOperation({
    summary: "Generate a design set for a selection of units, or resume a failed run",
    description:
      "One set and the units to write it for, in one run and one pull request (ADR-0049). 400 for an unknown set, unit or a set that does not apply to a unit's kind; 409 when the set has faults in its definition, or (with details.conflicts) when a unit has the set already, lacks a set it needs, is being generated or is in an open pull request; 422 above the units cap of a run.",
  })
  @ApiAcceptedResponse({ description: "The queued design run." })
  run(@Param("id") id: string, @Param("appId") appId: string, @Body({ schema: designRunSchema }) body: DesignRunBody, @CurrentActor() actor: Actor): Promise<JobRunView> {
    return this.runs.start(id, appId, body, actor);
  }

  @Get("applications/:appId/design/application")
  @ApiOperation({
    summary: "The application's own design: its design sets of scope `application`, file by file",
    description: "The same view as a unit's, for the application as a whole (ADR-0050): each file with its state and problems against its template, the references that do not resolve; no rule coverage.",
  })
  @ApiOkResponse({ description: "Per set of the application the files (state, stale, the template version written against, problems with their section) and the unresolved references. The unit is the pseudo-unit `@app`." })
  application(@Param("id") id: string, @Param("appId") appId: string, @Query({ schema: designQuerySchema }) query: DesignQuery): Promise<UnitDesignView> {
    return this.design.applicationDesign(id, appId, query.ref);
  }

  @Get("applications/:appId/design/common")
  @ApiOperation({ summary: "The common components of the project and the units whose designs name each one" })
  @ApiOkResponse({ description: "The components (02-architecture/common/COM-….md) with the units that name them, and the COM- ids designs name that no document defines." })
  common(@Param("id") id: string, @Param("appId") appId: string, @Query({ schema: designQuerySchema }) query: DesignQuery): Promise<CommonDesignView> {
    return this.design.common(id, appId, query.ref);
  }

  @Get("applications/:appId/design/units/:module/:unit")
  @ApiOperation({ summary: "One unit's design documents: each file with its state and problems, the rules each design covers, and the references that do not resolve" })
  @ApiOkResponse({ description: "Per applicable set the files (state, stale, the template version written against, problems with their section), the rule coverage with uncovered rules first, and the unresolved references. 404 for a unit without a unit file." })
  unit(@Param("id") id: string, @Param("appId") appId: string, @Param("module") module: string, @Param("unit") unit: string, @Query({ schema: designQuerySchema }) query: DesignQuery): Promise<UnitDesignView> {
    return this.design.unit(id, appId, module, unit, query.ref);
  }
}
