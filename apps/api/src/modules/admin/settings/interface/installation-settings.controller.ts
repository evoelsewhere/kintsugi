// Interface layer: installation settings managed in the portal (Settings → Git → Commit
// identity). Gated by git.manage, like the Git servers whose commits it signs.

import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { InstallationSettingsService } from "../application/installation-settings.service.js";
import type { CommitIdentityView } from "../domain/installation-settings.js";
import { type CommitIdentityInput, commitIdentitySchema } from "./installation-settings.dto.js";

@ApiTags("admin · settings")
@Controller("admin/settings")
@RequirePermission("git.manage")
export class InstallationSettingsController {
  constructor(private readonly settings: InstallationSettingsService) {}

  @Get("commit-identity")
  @ApiOperation({ summary: "Get the name and email of kintsugi-bot's commits to document repos" })
  @ApiOkResponse({ description: "The commit identity; isDefault while none was set." })
  commitIdentity(): Promise<CommitIdentityView> {
    return this.settings.commitIdentity();
  }

  @Put("commit-identity")
  @ApiOperation({ summary: "Set the name and email of kintsugi-bot's commits (used from the next write on)" })
  @ApiOkResponse({ description: "The stored commit identity." })
  setCommitIdentity(@Body({ schema: commitIdentitySchema }) body: CommitIdentityInput, @CurrentActor() actor: Actor): Promise<CommitIdentityView> {
    return this.settings.setCommitIdentity(body, actor);
  }
}
