// Typed fetch wrapper for the API served on the same origin (ADR-0017).
// The API answers with the uniform envelope (apps/api → common/interface/response.ts):
//   success → { success: true, data }
//   error   → { success: false, statusCode, error, message, timestamp, path }
// The session rides an httpOnly cookie (same origin); state-changing requests carry
// the CSRF header the API requires for cookie sessions.

import { expireSession } from "./session";

const CSRF_HEADER = "x-kintsugi-csrf";
const SIGN_IN_PATH = "/api/auth/login";

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(typeof body.message === "string" ? body.message : body.message.join(", "));
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const unsafe = init.method !== undefined && init.method !== "GET";
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(unsafe ? { [CSRF_HEADER]: "1" } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as ApiSuccess<T> | ApiErrorBody | null;

  // A rejected session ends it everywhere (a failed sign-in is not a lost session).
  if (response.status === 401 && path !== SIGN_IN_PATH) expireSession();

  // No content (e.g. 204 on delete) — nothing to unwrap.
  if (body === null) {
    if (!response.ok) throw new ApiError(response.status, failureOf(path, response));
    return undefined as T;
  }
  if ("success" in body && body.success === false) throw new ApiError(response.status, body);
  if (!response.ok) throw new ApiError(response.status, failureOf(path, response));
  return (body as ApiSuccess<T>).data;
}

function failureOf(path: string, response: Response): ApiErrorBody {
  return {
    success: false,
    statusCode: response.status,
    error: response.statusText,
    message: `Request failed: ${path}`,
    timestamp: new Date().toISOString(),
    path,
  };
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, signal === undefined ? {} : { signal });
}

export function apiSend<T>(path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  return request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

export interface HealthResponse {
  status: string;
  service: string;
  at: string;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiGet<HealthResponse>("/api/health", signal);
}
