import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { sqlStateOf } from "../db/errors.js";
import type { ApiFailure } from "../interface/response.js";

const MEBIBYTE = 1024 * 1024;

/**
 * Errors that are the client's fault though no HttpException says so, with a message that never echoes the input:
 * data the database refuses (SQLSTATE class 22: a NUL byte, a value out of range or malformed), a duplicate key a
 * concurrent create lost on (23505), and the body parser's errors.
 */
export function clientErrorOf(exception: unknown): { status: number; message: string } | undefined {
  const state = sqlStateOf(exception);
  if (state?.startsWith("22") === true) return { status: HttpStatus.BAD_REQUEST, message: "Invalid input" };
  if (state === "23505") return { status: HttpStatus.CONFLICT, message: "Already exists" };
  const { type, limit } = (typeof exception === "object" && exception !== null ? exception : {}) as { type?: unknown; limit?: unknown };
  switch (type) {
    case "entity.too.large":
      return { status: HttpStatus.PAYLOAD_TOO_LARGE, message: typeof limit === "number" ? `The request body exceeds the ${Math.round(limit / MEBIBYTE)} MB limit` : "The request body is too large" };
    case "entity.parse.failed":
      return { status: HttpStatus.BAD_REQUEST, message: "The request body is not valid JSON" };
    case "encoding.unsupported":
      return { status: HttpStatus.UNSUPPORTED_MEDIA_TYPE, message: "Unsupported content encoding" };
    case "charset.unsupported":
      return { status: HttpStatus.UNSUPPORTED_MEDIA_TYPE, message: "Unsupported charset" };
    default:
      return undefined;
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  readonly #logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const client = exception instanceof HttpException ? undefined : clientErrorOf(exception);
    const status = exception instanceof HttpException ? exception.getStatus() : (client?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    // Only HttpExceptions carry client-facing messages; a client error above gets a fixed one; anything else (driver
    // errors, missing configuration…) is logged below and answered generically.
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? (body as { message: string | string[] }).message
        : exception instanceof HttpException
          ? exception.message
          : (client?.message ?? "Internal server error");

    if (status >= 500) {
      this.#logger.error(`${request.method} ${request.url} → ${status}`, exception instanceof Error ? exception.stack : undefined);
    }

    const details =
      typeof body === "object" && body !== null && "details" in body && typeof (body as { details: unknown }).details === "object" && (body as { details: unknown }).details !== null
        ? (body as { details: Record<string, unknown> }).details
        : undefined;

    // Uniform error envelope (pair of the success envelope in common/interface/response.ts).
    const errorBody: ApiFailure = {
      success: false,
      statusCode: status,
      error: HttpStatus[status] ?? "Error",
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(details === undefined ? {} : { details }),
    };
    response.status(status).json(errorBody);
  }
}
