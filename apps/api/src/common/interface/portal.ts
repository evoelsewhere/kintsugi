import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * Serves the portal's build from `portalDir`: its files as they are, and its index page for any other page route (the
 * portal routes in the browser), never for `/api`. Register it after the security headers, so the files carry them.
 */
export function configurePortalServing(app: NestExpressApplication, portalDir: string): void {
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
