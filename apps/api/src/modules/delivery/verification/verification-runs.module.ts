import { Module } from "@nestjs/common";
import { VerificationRunsController } from "./verification-runs.controller.js";
import { VerificationRunsService } from "./verification-runs.service.js";

/** delivery · verification — docs/architecture/05-building-block-view.md. */
@Module({ controllers: [VerificationRunsController], providers: [VerificationRunsService], exports: [VerificationRunsService] })
export class VerificationRunsModule {}
