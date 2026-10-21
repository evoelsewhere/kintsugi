// Interface layer: the design of a project (ADR-0044, ADR-0045): its design sets and how each unit's
// design documents stand against them. Reading needs a session, like the documents it comes from.

import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DesignService } from "../application/design.service.js";
import type { CommonDesignView, DesignOverviewView, DesignSetsView, UnitDesignView } from "../domain/design.js";
import { type DesignQuery, type DesignSetsQuery, designQuerySchema, designSetsQuerySchema } from "./design.dto.js";

@ApiTags("delivery · design")
@Controller("projects/:id")
export class DesignController {
  constructor(private readonly design: DesignService) {}

  @Get("design/sets")
  @ApiOperation({
    summary: "The design sets the project defined in standards/design/, with the faults of their definitions",
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

  @Get("applications/:appId/design/common")
  @ApiOperation({ summary: "The common components of the project and the units whose designs name each one" })
  @ApiOkResponse({ description: "The components (architecture/common/COM-….md) with the units that name them, and the COM- ids designs name that no document defines." })
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
