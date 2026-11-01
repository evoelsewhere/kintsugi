// `kintsugi-app` REST + OpenAPI surface (ADR-0016: NestJS 12, ESM).
// The portal's static build and the Harness Hub MCP endpoint are served by the
// same container; this process owns the /api routes.

import "reflect-metadata";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Logger, StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { AuthService } from "#modules/core/auth/index.js";
import { loadEnv, debugMcpEnabled } from "./common/config/env.js";
import { ensureSchema, getPool } from "./common/db/pool.js";
import { captureLogs, pgDebugLogSink } from "@kintsugi/domain";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.js";
import { ResponseInterceptor } from "./common/interface/response.js";
import { configureApiBodyParser } from "./common/interface/body-parser.js";
import { configureSecurityHeaders } from "./common/interface/security-headers.js";
import { configureApiDocs } from "./common/interface/api-docs.js";

/** Local development configuration lives in .env (gitignored); the compose package passes env directly. */
if (existsSync(".env")) process.loadEnvFile(".env");

async function bootstrap(): Promise<void> {
  // A development installation mirrors what the API prints to the database for the debug MCP server (ADR-0056).
  if (debugMcpEnabled()) {
    const capture = captureLogs({ service: "api", sink: pgDebugLogSink({ query: (text, values) => getPool().query(text, values) }), stdout: process.stdout, stderr: process.stderr });
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void capture.stop().finally(() => process.exit(0)));
  }
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: [env.logLevel], bodyParser: false });
  // Agent packages (Agent Builder import, ADR-0026) are larger than the 100 kB default.
  configureApiBodyParser(app);
  // Before the portal's static files, so they carry the headers too.
  configureSecurityHeaders(app);

  const portalDir = process.env["KINTSUGI_PORTAL_DIR"];
  if (portalDir !== undefined && portalDir.length > 0) {
    const indexFile = join(portalDir, "index.html");
    if (!existsSync(indexFile)) throw new Error(`Portal build is missing: ${indexFile}`);
    app.useStaticAssets(portalDir, { index: false });
    app.use((request: Request, response: Response, next: NextFunction) => {
      const isApiPath = request.path === "/api" || request.path.startsWith("/api/");
      if (request.method === "GET" && !isApiPath && request.accepts("html")) {
        response.sendFile(indexFile);
        return;
      }
      next();
    });
  }

  // Never serve on a partly migrated schema: a failed migration stops startup.
  await ensureSchema();

  app.setGlobalPrefix("api");
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  // The OpenAPI document and Swagger UI are for signed-in sessions only.
  const auth = app.get(AuthService);
  configureApiDocs(app, (token) => auth.authenticate(token));

  await app.listen(env.port);
}

bootstrap().catch((error: unknown) => {
  new Logger("Bootstrap").error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
