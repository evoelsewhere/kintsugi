import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * The API's JSON body limit: agent packages (Agent Builder import, ADR-0026) are larger than the 100 kB default. A body
 * over the limit, or one the parser cannot read, is answered by HttpExceptionFilter (413, 400 or 415).
 */
export function configureApiBodyParser(app: NestExpressApplication): void {
  app.useBodyParser("json", { limit: "4mb" });
}
