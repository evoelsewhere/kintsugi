import type { NextFunction, Request, Response } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * Hardening headers on every response, the portal's static files and `/api` alike: no MIME sniffing, no framing by
 * another site, no referrer; Express is not named. Register it before the static assets. A full CSP is not set yet.
 */
export function configureSecurityHeaders(app: NestExpressApplication): void {
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
}
