// Shared interface kernel: the uniform response envelope.
// Every successful response is `{ success: true, data }`; every error is rendered by
// common/filters/http-exception.filter.ts as `{ success: false, statusCode, … }`.
// Controllers keep returning plain values — the interceptor wraps them.

import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { map, type Observable } from "rxjs";

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
  /** Structured detail of a refusal, when the use case gives one (e.g. the conflicts of a 409). */
  details?: Record<string, unknown>;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Wraps a payload explicitly (outside the HTTP context: tests, jobs, CLI). */
export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(map((data) => ok(data)));
  }
}
