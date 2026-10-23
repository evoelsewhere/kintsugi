import { Controller, Get, Module, Query } from "@nestjs/common";
import { AllowMemberRead } from "#common/auth/decorators.js";

@Controller("__test/member-context")
class MemberContextProbeController {
  @Get()
  @AllowMemberRead({ projectIdFrom: "query" })
  read(@Query("projectId") projectId: string): { projectId: string; marker: string } {
    return { projectId, marker: "PRIVATE_CONTEXT_MARKER" };
  }
}

@Module({ controllers: [MemberContextProbeController] })
export class MemberContextProbeModule {}