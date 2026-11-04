import type { NestExpressApplication } from "@nestjs/platform-express";
import { json } from "express";

/** A page is at most 5 MiB of text and JSON escaping can nearly double it, so the routes that carry one take more than the rest. */
const WIKI_TEXT_BODY_LIMIT = "12mb";
/** `PUT /api/projects/:id/wiki/draft` and `POST /api/projects/:id/wiki/publish`. */
const WIKI_TEXT_ROUTE = /^\/api\/projects\/[^/]+\/wiki\/(?:draft|publish)\/?$/;
/** A file of 5 MiB is a little over 6.6 MiB as base64: `POST /api/projects/:id/wiki/draft/attachments`. */
const WIKI_ATTACHMENT_BODY_LIMIT = "8mb";
const WIKI_ATTACHMENT_ROUTE = /^\/api\/projects\/[^/]+\/wiki\/draft\/attachments\/?$/;

/**
 * The API's JSON body limit: agent packages (Agent Builder import, ADR-0026) are larger than the 100 kB default, and
 * the routes that carry a wiki page take more (see above). A body over the limit, or one the parser cannot read, is answered by HttpExceptionFilter (413, 400 or 415).
 */
export function configureApiBodyParser(app: NestExpressApplication): void {
  // A body is parsed once: the larger parser comes first for the page routes and the general one skips what it parsed.
  const wikiText = json({ limit: WIKI_TEXT_BODY_LIMIT });
  const wikiAttachment = json({ limit: WIKI_ATTACHMENT_BODY_LIMIT });
  app.use((request: { method: string; path: string }, response: never, next: (error?: unknown) => void) => {
    if ((request.method === "PUT" || request.method === "POST") && WIKI_TEXT_ROUTE.test(request.path)) wikiText(request as never, response, next);
    else if (request.method === "POST" && WIKI_ATTACHMENT_ROUTE.test(request.path)) wikiAttachment(request as never, response, next);
    else next();
  });
  app.useBodyParser("json", { limit: "4mb" });
}
