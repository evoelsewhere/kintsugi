import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiFailure } from "../interface/response.js";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  readonly #logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    // Only HttpExceptions carry client-facing messages; anything else (driver errors,
    // missing configuration…) is logged below and answered generically.
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? (body as { message: string | string[] }).message
        : exception instanceof HttpException
          ? exception.message
          : "Internal server error";

    if (status >= 500) {
      this.#logger.error(`${request.method} ${request.url} → ${status}`, exception instanceof Error ? exception.stack : undefined);
    }

    // Uniform error envelope (pair of the success envelope in common/interface/response.ts).
    const errorBody: ApiFailure = {
      success: false,
      statusCode: status,
      error: HttpStatus[status] ?? "Error",
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    response.status(status).json(errorBody);
  }
}
