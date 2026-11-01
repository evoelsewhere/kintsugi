// What a failed query says about its cause: the SQLSTATE of a Postgres error, and whether the database is out of
// reach (a request may be retried) rather than refusing the request's data or failing on a bug.

/** The SQLSTATE of a Postgres error, also when another error wraps it; undefined for anything else (a Node `code` is not one). */
export function sqlStateOf(exception: unknown): string | undefined {
  for (let error = exception, depth = 0; typeof error === "object" && error !== null && depth < 3; error = (error as { cause?: unknown }).cause, depth++) {
    const { code, severity } = error as { code?: unknown; severity?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && typeof severity === "string") return code;
  }
  return undefined;
}

/** Node's codes for a connection that could not be made or was lost. */
const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

/**
 * True when the database could not be reached or stopped serving: a connection refused, lost or timed out (the pool's
 * own messages included), SQLSTATE class 08 (connection exception) or 53 (insufficient resources), or the server
 * shutting down or starting (57P01–57P03). Data the database refuses (class 22) and bugs are not.
 */
export function isDatabaseUnavailable(exception: unknown): boolean {
  const state = sqlStateOf(exception);
  if (state !== undefined) return state.startsWith("08") || state.startsWith("53") || state === "57P01" || state === "57P02" || state === "57P03";
  for (let error = exception, depth = 0; typeof error === "object" && error !== null && depth < 3; error = (error as { cause?: unknown }).cause, depth++) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
    if (typeof message === "string" && /connection terminated|timeout exceeded when trying to connect|connection timeout/i.test(message)) return true;
  }
  return false;
}
