import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

/** Liveness of the API process. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
