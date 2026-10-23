import {
  documentPageSchema,
  documentQuerySchema,
  documentSearchQuerySchema,
  documentSearchResultSchema,
  projectListResultSchema,
  projectQuerySchema,
  reviewQuerySchema,
  reviewReportSchema,
  taskBriefQuerySchema,
  taskBriefSchema,
  taskListResultSchema,
  taskQuerySchema,
  taskStatusQuerySchema,
  taskStatusSchema,
  taskEventQuerySchema,
  taskEventSchema,
} from "@kintsugi/harness-sdk";
import type {
  CodingAgentWorkflowPort,
  DocumentQuery,
  DocumentSearchQuery,
  ListResult,
  ProjectQuery,
  ProjectSummary,
  ReviewQuery,
  ReviewReport,
  SourceHit,
  TaskBrief,
  TaskBriefQuery,
  TaskEvent,
  TaskEventQuery,
  TaskIdentity,
  TaskQuery,
  TaskStatus,
  TaskSummary,
} from "@kintsugi/harness-sdk";
import { cancelledError, CodingAgentClientError, isAbortError } from "./errors.js";

import { readSseFrames } from "./sse.js";

const API_PREFIX = "/api/member/v1";
const DEFAULT_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 5_000;
const SNAPSHOT_WAIT_MS = 30_000;

type TokenProvider = () => string | undefined | Promise<string | undefined>;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface CodingAgentWorkflowClientOptions {
  baseUrl: string;
  tokenProvider: TokenProvider;
  fetch?: typeof globalThis.fetch;
  sleep?: Sleep;
  signal?: AbortSignal;
  signalProvider?: () => AbortSignal | undefined;
  maxRetries?: number;
  maxSnapshotWaitMs?: number;
  now?: () => number;
}

interface ErrorEnvelope {
  success?: unknown;
  statusCode?: unknown;
  error?: unknown;
  message?: unknown;
  details?: unknown;
}

function validateBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Installation URL is invalid");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("Installation URL must use HTTPS (HTTP is allowed only for loopback)");
  }
  if (url.username || url.password || url.search || url.hash) throw new TypeError("Installation URL cannot contain credentials, query, or fragment");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    url.searchParams.set(key, String(value));
  }
}

function retryAfterMilliseconds(response: Response, now: number): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - now;
  if (!Number.isFinite(delay)) return undefined;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, delay));
}

function makeSleep(): Sleep {
  return (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(cancelledError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal !== undefined) {
      void Promise.resolve().then(() => {
        if (signal.aborted) abort();
      });
    }
  });
}

function errorFromEnvelope(status: number, body: unknown, secret?: string): CodingAgentClientError {
  const envelope = body !== null && typeof body === "object" ? body as ErrorEnvelope : {};
  const nested = envelope.details !== null && typeof envelope.details === "object" ? envelope.details as Record<string, unknown> : undefined;
  const code = typeof nested?.code === "string" ? redactText(nested.code, secret) : typeof envelope.error === "string" ? redactText(envelope.error, secret).toUpperCase().replace(/[^A-Z0-9_]+/g, "_") : `HTTP_${status}`;
  let message = typeof envelope.message === "string" ? envelope.message : `Kintsugi request failed (${status})`;
  if (secret) message = message.split(secret).join("[redacted]");
  return new CodingAgentClientError({ code, status, message, details: redactSecret(envelope.details, secret) });
}

function redactText(value: string, secret?: string): string {
  if (secret === undefined || secret.length === 0) return value;
  return value.split(secret).join("[redacted]");
}

function redactSecret(value: unknown, secret?: string): unknown {
  if (typeof value === "string") return redactText(value, secret);
  if (secret === undefined || secret.length === 0) return value;
  if (Array.isArray(value)) return value.map((item) => redactSecret(item, secret));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecret(item, secret)]));
  return value;
}

function parseBody<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown, secret?: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Kintsugi returned data that does not match the supported response schema" });
  if (secret !== undefined && JSON.stringify(parsed.data).includes(secret)) {
    throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Kintsugi response contained unexpected credential data" });
  }
  return parsed.data;
}

export function createCodingAgentWorkflowClient(options: CodingAgentWorkflowClientOptions): CodingAgentWorkflowPort {
  const baseUrl = validateBaseUrl(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? makeSleep();
  const maxRetries = Math.max(0, Math.min(5, options.maxRetries ?? DEFAULT_RETRIES));
  const now = options.now ?? Date.now;

  async function request<T>(
    endpoint: string,
    query: Record<string, unknown>,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    signalOverride?: AbortSignal,
    prepareSnapshot = false,
  ): Promise<T> {
    let signal = signalOverride ?? options.signal;
    let signalResolved = signal !== undefined;
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    const url = new URL(`${basePath}${API_PREFIX}/${endpoint}`, baseUrl.origin);
    const urlQuery = { ...query };
    delete urlQuery.schemaVersion;
    appendQuery(url, urlQuery);
    let snapshotStarted: number | undefined;
    let snapshotWaited = 0;
    let snapshotId = typeof query.snapshotId === "string" ? query.snapshotId : undefined;
    let retries = 0;

    while (true) {
      if (signal?.aborted) throw cancelledError();
      const token = await options.tokenProvider();
      if (signal?.aborted) throw cancelledError();
      // Browser sign-in can outlast the HTTP request budget, so start it after token acquisition.
      if (!signalResolved) {
        signal = options.signalProvider?.() ?? options.signal;
        signalResolved = true;
      }
      if (signal?.aborted) throw cancelledError();
      if (token === undefined || token.length === 0) throw new CodingAgentClientError({ code: "UNAUTHENTICATED", status: 401, message: "No Kintsugi credential is configured for this profile" });
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "GET",
          headers: { accept: "application/json", authorization: `Bearer ${token}` },
          redirect: "manual",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw cancelledError();
        if (retries < maxRetries) {
          retries += 1;
          await sleep(Math.min(250 * 2 ** (retries - 1), MAX_RETRY_DELAY_MS), signal);
          continue;
        }
        throw new CodingAgentClientError({ code: "NETWORK_ERROR", message: "Could not reach the Kintsugi installation" });
      }

      if (response.status >= 300 && response.status < 400) {
        throw new CodingAgentClientError({ code: "REDIRECT_BLOCKED", status: response.status, message: "Kintsugi redirected the request; credentials were not forwarded" });
      }
      let body: unknown;
      try {
        body = await response.json() as unknown;
      } catch {
        throw new CodingAgentClientError({ code: "INVALID_RESPONSE", status: response.status, message: "Kintsugi returned an unreadable response" });
      }

      if (!response.ok) {
        const apiError = errorFromEnvelope(response.status, body, token);
        if (prepareSnapshot && apiError.code === "SNAPSHOT_PREPARING") {
          const detail = apiError.details !== null && typeof apiError.details === "object" ? apiError.details as Record<string, unknown> : {};
          const returnedId = typeof detail.snapshotId === "string" ? detail.snapshotId : snapshotId;
          if (returnedId === undefined) throw apiError;
          snapshotId = returnedId;
          query.snapshotId = returnedId;
          url.searchParams.set("snapshotId", returnedId);
          const asked = typeof detail.retryAfterMs === "number" ? Math.max(0, detail.retryAfterMs) : 1_000;
          const delay = Math.min(asked, Math.max(0, (options.maxSnapshotWaitMs ?? SNAPSHOT_WAIT_MS) - snapshotWaited));
          if (delay <= 0) throw new CodingAgentClientError({ code: "SNAPSHOT_TIMEOUT", status: response.status, message: "Task context did not finish preparing within 30 seconds", details: { snapshotId: returnedId } });
          snapshotStarted ??= now();
          snapshotWaited = Math.max(snapshotWaited + delay, now() - snapshotStarted);
          await sleep(delay, signal);
          if (snapshotWaited >= (options.maxSnapshotWaitMs ?? SNAPSHOT_WAIT_MS)) {
            throw new CodingAgentClientError({ code: "SNAPSHOT_TIMEOUT", status: response.status, message: "Task context did not finish preparing within 30 seconds", details: { snapshotId: returnedId } });
          }
          retries = 0;
          continue;
        }
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (retryable && retries < maxRetries) {
          retries += 1;
          await sleep(retryAfterMilliseconds(response, now()) ?? Math.min(250 * 2 ** (retries - 1), MAX_RETRY_DELAY_MS), signal);
          continue;
        }
        throw apiError;
      }
      if (body === null || typeof body !== "object" || (body as { success?: unknown }).success !== true || !("data" in body)) {
        throw new CodingAgentClientError({ code: "INVALID_RESPONSE", status: response.status, message: "Kintsugi returned an unsupported response envelope" });
      }
      return parseBody(schema, (body as { data: unknown }).data, token);
    }
  }

  async function* watchTask(query: TaskEventQuery, signal: AbortSignal): AsyncGenerator<TaskEvent> {
    const parsed = taskEventQuerySchema.parse(query);
    let cursor = parsed.afterEventId;
    let delivered = 0;
    let retries = 0;
    while (parsed.limit === undefined || delivered < parsed.limit) {
      if (signal.aborted) throw cancelledError();
      const token = await options.tokenProvider();
      if (!token) throw new CodingAgentClientError({ code: "UNAUTHENTICATED", status: 401, message: "No Kintsugi credential is configured for this profile" });
      const url = new URL(`${baseUrl.pathname.replace(/\/+$/, "")}${API_PREFIX}/task-events`, baseUrl.origin);
      appendQuery(url, { projectId: parsed.projectId, unitId: parsed.unitId, afterEventId: cursor,
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit - delivered }) });
      let delay: number | undefined;
      try {
        const response = await fetcher(url, {
          method: "GET", redirect: "manual", signal,
          headers: { accept: "text/event-stream", authorization: `Bearer ${token}`, ...(cursor === undefined ? {} : { "Last-Event-ID": cursor }) },
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new CodingAgentClientError({ code: "REDIRECT_BLOCKED", status: response.status, message: "Kintsugi redirected the request; credentials were not forwarded" });
        }
        if (!response.ok) {
          let body: unknown;
          try { body = await response.json(); } catch { throw new CodingAgentClientError({ code: "INVALID_RESPONSE", status: response.status, message: "Kintsugi returned an unreadable response" }); }
          const error = errorFromEnvelope(response.status, body, token);
          if (![429, 502, 503, 504].includes(response.status)) throw error;
          delay = retryAfterMilliseconds(response, now());
          if (retries >= maxRetries) throw error;
        } else {
          if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "text/event-stream" || response.body === null) {
            await response.body?.cancel();
            throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Kintsugi did not return a task event stream" });
          }
          for await (const frame of readSseFrames(response.body, signal)) {
            if (frame.event !== "task-event" && frame.event !== "error") continue;
            let data: unknown;
            try { data = JSON.parse(frame.data); } catch { throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Kintsugi returned an unreadable task event" }); }
            if (frame.event === "error") {
              if (data === null || typeof data !== "object" || !("code" in data) || typeof data.code !== "string" || !("message" in data) || typeof data.message !== "string") {
                throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Kintsugi returned an invalid stream error" });
              }
              const code = data.code.split(token).join("[redacted]");
              const status = code === "FORBIDDEN" || code === "MEMBER_EVENT_ACCESS_REVOKED" ? 403
                : code === "UNAUTHENTICATED" || code === "MEMBER_EVENT_UNAUTHENTICATED" ? 401
                : undefined;
              throw new CodingAgentClientError({ code, message: data.message.split(token).join("[redacted]"),
                ...(status === undefined ? {} : { status }) });
            }
            const value = parseBody(taskEventSchema, data, token);
            if (frame.id !== value.id || value.projectId !== parsed.projectId || value.unitId !== parsed.unitId) {
              throw new CodingAgentClientError({ code: "INVALID_RESPONSE", message: "Task event identity does not match the subscription" });
            }
            if (value.id === cursor) continue;
            cursor = value.id;
            delivered += 1;
            retries = 0;
            yield value;
            if (parsed.limit !== undefined && delivered >= parsed.limit) return;
          }
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw cancelledError();
        if (error instanceof CodingAgentClientError) throw error;
        // Fetch/read failures can interrupt a frame; resume only after the last complete delivered event.
      }
      if (retries >= maxRetries) throw new CodingAgentClientError({ code: "NETWORK_ERROR", message: "Task event stream disconnected; resume from the last delivered event", ...(cursor === undefined ? {} : { details: { afterEventId: cursor } }) });
      retries += 1;
      await sleep(delay ?? Math.min(250 * 2 ** (retries - 1), MAX_RETRY_DELAY_MS), signal);
    }
  }
  return {
    listProjects: (query: ProjectQuery): Promise<ListResult<ProjectSummary>> => {
      const parsed = projectQuerySchema.parse(query);
      return request("projects", parsed, projectListResultSchema);
    },
    listTasks: (query: TaskQuery): Promise<ListResult<TaskSummary>> => {
      const parsed = taskQuerySchema.parse(query);
      return request("tasks", parsed, taskListResultSchema);
    },
    briefTask: async (query: TaskBriefQuery): Promise<TaskBrief> => {
      const parsed = taskBriefQuerySchema.parse(query);
      return request("task-brief", parsed, taskBriefSchema, undefined, true);
    },
    getDocument: (query: DocumentQuery) => {
      const parsed = documentQuerySchema.parse(query);
      return request("documents", parsed, documentPageSchema);
    },
    searchDocuments: (query: DocumentSearchQuery): Promise<ListResult<SourceHit>> => {
      const parsed = documentSearchQuerySchema.parse(query);
      return request("search", parsed, documentSearchResultSchema);
    },
    getReview: async (query: ReviewQuery): Promise<ReviewReport> => {
      const parsed = reviewQuerySchema.parse(query);
      return request(`reviews/${encodeURIComponent(parsed.reviewId)}`, { projectId: parsed.projectId, schemaVersion: parsed.schemaVersion }, reviewReportSchema);
    },
    taskStatus: (query: TaskIdentity): Promise<TaskStatus> => {
      const parsed = taskStatusQuerySchema.parse(query);
      return request("task-status", parsed, taskStatusSchema);
    },
    watchTask,
  };
}
