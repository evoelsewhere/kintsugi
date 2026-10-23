export class CodingAgentClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(input: { code: string; message: string; status?: number; details?: unknown; cause?: unknown }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "CodingAgentClientError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export function cancelledError(): CodingAgentClientError {
  return new CodingAgentClientError({ code: "CANCELLED", message: "Request cancelled" });
}
