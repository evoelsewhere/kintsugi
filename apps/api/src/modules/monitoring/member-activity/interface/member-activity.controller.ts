// Interface layer: what members' connections did in a project, read-only. Needs member.activity.view.

import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import type { Page } from "#common/application/pagination.js";
import { RequirePermission } from "#common/auth/decorators.js";
import { pageQuerySchema } from "#common/interface/pagination.js";
import { MemberActivityService } from "../application/member-activity.service.js";
import type { MemberActivity, MemberUsageSummary } from "../domain/member-activity.js";

const filter = z.string().min(1).max(200);
const instant = z.string().datetime({ offset: true }).optional();

const summaryQuerySchema = z.object({ projectId: filter, from: instant, to: instant });
type SummaryQuery = z.infer<typeof summaryQuerySchema>;

const listQuerySchema = pageQuerySchema.extend({ projectId: filter, userId: filter.optional(), pluginName: filter.optional(), kind: filter.optional() });
type ListQuery = z.infer<typeof listQuerySchema>;

@ApiTags("monitoring · member activity")
@Controller("monitoring/member-activity")
@RequirePermission("member.activity.view")
export class MemberActivityController {
  constructor(private readonly activity: MemberActivityService) {}

  @Get("summary")
  @ApiOperation({ summary: "What each member's connections did in a project in a window: events by kind and by plugin, and when they were last seen" })
  @ApiOkResponse({ description: "The members with activity; the window defaults to the last 30 days." })
  summary(@Query({ schema: summaryQuerySchema }) query: SummaryQuery): Promise<MemberUsageSummary> {
    return this.activity.summary(query.projectId, {
      ...(query.from === undefined ? {} : { from: new Date(query.from) }),
      ...(query.to === undefined ? {} : { to: new Date(query.to) }),
    });
  }

  @Get()
  @ApiOperation({ summary: "The activity records of a project, newest first, optionally of one member, plugin or kind" })
  @ApiOkResponse({ description: "A page of records." })
  list(@Query({ schema: listQuerySchema }) query: ListQuery): Promise<Page<MemberActivity>> {
    return this.activity.list({
      projectId: query.projectId,
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.pluginName === undefined ? {} : { pluginName: query.pluginName }),
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      limit: query.limit,
      offset: query.offset,
    });
  }
}
