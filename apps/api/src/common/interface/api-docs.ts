import type { NextFunction, Request, Response } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { sessionToken } from "../auth/session-cookie.js";

/** Swagger UI and the OpenAPI document (`/api/docs`, `/api/docs-json`, `/api/docs-yaml`). */
const isDocsPath = (path: string): boolean => path === "/api/docs" || path.startsWith("/api/docs/") || path.startsWith("/api/docs-");

/**
 * Serves the OpenAPI document and Swagger UI to a signed-in session only. Swagger mounts plain Express routes outside
 * the global guards, so without this they would hand anyone the map of every route; without a session they answer 401
 * in the uniform envelope. Call after the global prefix and the routes are set.
 */
export function configureApiDocs(app: NestExpressApplication, authenticate: (token: string) => Promise<unknown>): void {
  app.use(async (request: Request, response: Response, next: NextFunction) => {
    if (!isDocsPath(request.path)) return next();
    const token = sessionToken(request);
    try {
      if (token !== undefined && (await authenticate(token)) !== undefined) return next();
    } catch (error) {
      return next(error);
    }
    response.status(401).json({ success: false, statusCode: 401, error: "Unauthorized", message: "Sign in to read the API documentation", timestamp: new Date().toISOString(), path: request.url });
  });
  const openApi = new DocumentBuilder()
    .setTitle("Kintsugi API")
    .setDescription("REST API of the Kintsugi migration & modernization portal.")
    .setVersion("0.0.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, openApi));
}
