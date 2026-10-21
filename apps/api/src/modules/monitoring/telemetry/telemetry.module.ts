// Wiring of the telemetry module: the use cases plus the Postgres read model bound to its port.

import { Module } from "@nestjs/common";
import { TelemetryService } from "./application/telemetry.service.js";
import { TelemetryReadModel } from "./domain/telemetry.ports.js";
import { PgTelemetryReadModel } from "./infrastructure/pg-telemetry.read-model.js";
import { TelemetryController } from "./interface/telemetry.controller.js";

/** monitoring · telemetry: read-only views over the spans runtime jobs report (ADR-0048). */
@Module({
  controllers: [TelemetryController],
  providers: [TelemetryService, { provide: TelemetryReadModel, useClass: PgTelemetryReadModel }],
  exports: [TelemetryService],
})
export class TelemetryModule {}
