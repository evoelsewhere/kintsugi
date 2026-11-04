import type { NextFunction, Request, Response } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * The Content-Security-Policy of the portal's pages and static files: its own scripts only (nothing inline, nothing from
 * another site, no plug-ins), its own origin for requests, images that are its own, inline or generated in the page (no
 * remote images), no `<base>`, no framing. It is the second line behind the Markdown renderer, which already drops raw
 * HTML: a later mistake in the reader must not become script running with a viewer's session.
 *
 * `style-src` allows inline styles: the portal sets `style` attributes, and Mermaid adds a `<style>` to the diagrams it
 * draws. Styles cannot run script; scripts stay strict.
 */
export const PORTAL_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** `/api` and what is under it: JSON, the OpenAPI document and its Swagger UI (which needs inline script), not the portal. */
const isApiPath = (path: string): boolean => path === "/api" || path.startsWith("/api/");

/**
 * Hardening headers on every response, the portal's static files and `/api` alike: no MIME sniffing, no framing by
 * another site, no referrer; Express is not named. The portal's pages and files also carry a Content-Security-Policy.
 * Register it before the static assets.
 */
export function configureSecurityHeaders(app: NestExpressApplication): void {
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (!isApiPath(request.path)) response.setHeader("Content-Security-Policy", PORTAL_CONTENT_SECURITY_POLICY);
    next();
  });
}
