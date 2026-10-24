// Interface layer: installation settings managed in the portal (Settings → Git → Commit
// identity). Gated by git.manage, like the Git servers whose commits it signs.

import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermission } from "#common/auth/decorators.js";
import { InstallationSettingsService } from "../application/installation-settings.service.js";
import type { CommitIdentityView, SandboxSettingsView, TelemetryExportInput, TelemetryExportView } from "../domain/installation-settings.js";
import { type CommitIdentityInput, type SandboxSettingsInput, commitIdentitySchema, sandboxSettingsSchema, telemetryExportSchema } from "./installation-settings.dto.js";

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

/** Settings → Telemetry export (ADR-0074): where job spans are sent besides the portal. Gated by telemetry.manage. */
@ApiTags("admin · settings")
@Controller("admin/settings")
@RequirePermission("telemetry.manage")
export class TelemetryExportController {
  constructor(private readonly settings: InstallationSettingsService) {}

  @Get("telemetry-export")
  @ApiOperation({ summary: "Get the OpenTelemetry export of job spans: endpoint, service name and the names of its headers (never their values)" })
  @ApiOkResponse({ description: "The export in effect; isDefault while none was stored (export is off)." })
  telemetryExport(): Promise<TelemetryExportView> {
    return this.settings.telemetryExport();
  }

  @Put("telemetry-export")
  @ApiOperation({ summary: "Set the OpenTelemetry export (the worker applies it to the next batch of spans)" })
  @ApiOkResponse({ description: "The stored export. 400 names every field that is not valid." })
  setTelemetryExport(@Body({ schema: telemetryExportSchema }) body: TelemetryExportInput, @CurrentActor() actor: Actor): Promise<TelemetryExportView> {
    return this.settings.setTelemetryExport(body, actor);
  }
}

/** Settings → Sandbox (ADR-0055): the environment jobs run in. Gated by sandbox.manage. */
@ApiTags("admin · settings")
@Controller("admin/settings")
@RequirePermission("sandbox.manage")
export class SandboxSettingsController {
  constructor(private readonly settings: InstallationSettingsService) {}

  @Get("sandbox")
  @ApiOperation({ summary: "Get the settings of the sandbox environment: how long a job workspace keeps its checkouts and results, and the limits of its processes" })
  @ApiOkResponse({ description: "The settings in effect; isDefault while none was stored." })
  sandbox(): Promise<SandboxSettingsView> {
    return this.settings.sandbox();
  }

  @Put("sandbox")
  @ApiOperation({ summary: "Set the sandbox environment settings (the worker applies them to the next job and the next sweep)" })
  @ApiOkResponse({ description: "The stored settings. 400 names every field out of range." })
  setSandbox(@Body({ schema: sandboxSettingsSchema }) body: SandboxSettingsInput, @CurrentActor() actor: Actor): Promise<SandboxSettingsView> {
    return this.settings.setSandbox(body, actor);
  }
}
