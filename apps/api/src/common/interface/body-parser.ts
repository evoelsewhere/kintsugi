import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from "@nestjs/common";
import { raw, type NextFunction, type Request, type Response } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";

/** Captures signed GitHub delivery bytes before JSON parsing and keeps the general API body limit. */
export function configureApiBodyParser(app: NestExpressApplication): void {
  app.use("/api/webhooks/github", raw({ type: "*/*", limit: "1mb", inflate: false }));
  app.use("/api/webhooks/github", (error: unknown, _request: Request, _response: Response, next: NextFunction) => {
    const type = typeof error === "object" && error !== null && "type" in error
      ? (error as { type: unknown }).type
      : undefined;
    if (type === "encoding.unsupported") {
      next(new UnsupportedMediaTypeException("GitHub webhook requests must not use content encoding"));
    } else if (type === "entity.too.large") {
      next(new PayloadTooLargeException("GitHub webhook payload exceeds 1 MiB"));
    } else {
      next(new BadRequestException("GitHub webhook request body could not be captured"));
    }
  });
  app.useBodyParser("json", { limit: "4mb" });
}
