// Shared interface kernel: Server-Sent Events. Streams are the one exception to the uniform
// envelope: each event's `data` is a JSON payload of its own. Errors before the stream opens
// (404, 403…) still go through the exception filter as envelopes, so check access and existence
// first, then open the stream. Authentication is the normal session: EventSource sends the
// session cookie on same-origin GET requests (no CSRF header needed for safe methods). The
// session is checked again on every heartbeat: signing out, a password reset or disabling the
// member ends the stream.

import type { Request, Response } from "express";
import { recheckOf } from "../auth/recheck.js";

/** The heartbeat of every stream, and how often its session is checked again (tests shorten it). */
export const SSE_DEFAULTS = { heartbeatMs: 15_000 };

export interface EventStreamWriter {
  /** Aborted when the client disconnects or the stream is closed. */
  readonly signal: AbortSignal;
  /** Sends one event; `id` lets the client resume with Last-Event-ID. */
  send(event: string, data: unknown, id?: string): void;
  close(): void;
}

/**
 * Opens an SSE response: headers, a heartbeat comment, and close handling. On each heartbeat the request's credentials
 * are checked again (`stillAllowed`, by default what the authentication guard recorded); the stream ends when they no
 * longer hold. A check that fails (the database is down) keeps the stream: it is tried again on the next heartbeat.
 */
export function openEventStream(
  request: Request,
  response: Response,
  options: { heartbeatMs?: number; retryMs?: number; stillAllowed?: () => Promise<boolean> } = {},
): EventStreamWriter {
  const stillAllowed = options.stillAllowed ?? recheckOf(request);
  const closed = new AbortController();
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  // Reverse proxies (nginx) must not buffer the stream.
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  response.write(`retry: ${options.retryMs ?? 3000}\n\n`);

  let checking = false;
  const heartbeat = setInterval(() => {
    if (closed.signal.aborted) return;
    response.write(": keep-alive\n\n");
    if (stillAllowed === undefined || checking) return;
    checking = true;
    stillAllowed()
      .then((allowed) => {
        if (!allowed) close();
      })
      .catch(() => undefined)
      .finally(() => {
        checking = false;
      });
  }, options.heartbeatMs ?? SSE_DEFAULTS.heartbeatMs);
  const close = (): void => {
    if (closed.signal.aborted) return;
    clearInterval(heartbeat);
    closed.abort();
    response.end();
  };
  request.on("close", close);

  return {
    signal: closed.signal,
    send(event, data, id) {
      if (closed.signal.aborted) return;
      // JSON never contains a raw newline, so one data line per event.
      response.write(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close,
  };
}
