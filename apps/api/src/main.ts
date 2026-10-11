// `kintsugi-app` REST + OpenAPI surface (ADR-0016: NestJS 12, ESM).
// The portal's static build and the Harness Hub MCP endpoint are served by the
// same container; this process owns the /api routes.

import "reflect-metadata";
import { existsSync } from "node:fs";
import { Logger, StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./common/config/env.js";
import { ensureSchema } from "./common/db/pool.js";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.js";
import { ResponseInterceptor } from "./common/interface/response.js";

/** Local development configuration lives in .env (gitignored); the compose package passes env directly. */
if (existsSync(".env")) process.loadEnvFile(".env");

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: [env.logLevel] });
  // Agent packages (Agent Builder import, ADR-0026) are larger than the 100 kB default.
  app.useBodyParser("json", { limit: "4mb" });

  // Never serve on a partly migrated schema: a failed migration stops startup.
  await ensureSchema();

  app.setGlobalPrefix("api");
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  const openApi = new DocumentBuilder()
    .setTitle("Kintsugi API")
    .setDescription("REST API of the Kintsugi migration & modernization portal.")
    .setVersion("0.0.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, openApi));

  await app.listen(env.port);
}

bootstrap().catch((error: unknown) => {
  new Logger("Bootstrap").error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
