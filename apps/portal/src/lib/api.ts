// Typed fetch wrapper for the API served on the same origin (ADR-0017).
// Errors follow the uniform envelope from the API's HttpExceptionFilter.

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(typeof body.message === "string" ? body.message : body.message.join(", "));
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: "application/json" } });
  const body = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) throw new ApiError(response.status, body as ApiErrorBody);
  return body as T;
}

export interface HealthResponse {
  status: string;
  service: string;
  at: string;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiGet<HealthResponse>("/api/health", signal);
}
