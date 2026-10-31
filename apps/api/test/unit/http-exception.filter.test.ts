import { BadRequestException, ForbiddenException, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HttpExceptionFilter } from "#common/filters/http-exception.filter.js";

function run(exception: unknown): { status: number; body: Record<string, unknown> } {
  const result = { status: 0, body: {} as Record<string, unknown> };
  const response = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      result.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ method: "GET", url: "/api/x" }), getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return result;
}

describe("HttpExceptionFilter", () => {
  it("hides the message of non-HTTP errors behind a generic 500", () => {
    const { status, body } = run(new Error("relation core.secret_table does not exist; password=hunter2"));
    expect(status).toBe(500);
    expect(body).toMatchObject({ success: false, statusCode: 500, error: "INTERNAL_SERVER_ERROR", message: "Internal server error", path: "/api/x" });
    expect(JSON.stringify(body)).not.toMatch(/secret_table|hunter2/);
  });

  it("keeps the client-facing message of HTTP exceptions", () => {
    expect(run(new ForbiddenException("Missing permission: x")).body).toMatchObject({ statusCode: 403, message: "Missing permission: x" });
    expect(run(new BadRequestException(["a: required", "b: too long"])).body).toMatchObject({ statusCode: 400, message: ["a: required", "b: too long"] });
  });

  it("answers data the database refuses with 400 and a duplicate with 409, without echoing the input", () => {
    const database = (code: string, message: string) => Object.assign(new Error(message), { code, severity: "ERROR", detail: "Key (id)=(secret-value) already exists." });
    for (const code of ["22021", "22P02", "22001", "22003", "22007"]) {
      const { status, body } = run(database(code, `invalid byte sequence for encoding "UTF8": 0x00 in value adm\u0000in`));
      expect(status, code).toBe(400);
      expect(body, code).toMatchObject({ success: false, statusCode: 400, error: "BAD_REQUEST", message: "Invalid input" });
    }
    const duplicate = run(database("23505", 'duplicate key value violates unique constraint "role_pkey"'));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ statusCode: 409, error: "CONFLICT", message: "Already exists" });
    expect(JSON.stringify(duplicate.body)).not.toMatch(/role_pkey|secret-value/);
    // A wrapped database error is read through its cause; any other database error stays a 500.
    expect(run(new Error("query failed", { cause: database("22021", "x") })).status).toBe(400);
    expect(run(database("42P01", "relation does not exist")).status).toBe(500);
    // A Node error code is not a SQLSTATE.
    expect(run(Object.assign(new Error("spawn x ENOENT"), { code: "22021" })).status).toBe(500);
  });

  it("answers body-parser errors with their status and a plain message", () => {
    const parser = (type: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`raw ${type} detail`), { type, expose: true, ...extra });
    expect(run(parser("entity.too.large", { status: 413, limit: 4 * 1024 * 1024, length: 5_000_000 }))).toMatchObject({ status: 413, body: { statusCode: 413, message: "The request body exceeds the 4 MB limit" } });
    expect(run(parser("entity.parse.failed", { status: 400, body: '{"a":' }))).toMatchObject({ status: 400, body: { message: "The request body is not valid JSON" } });
    expect(run(parser("encoding.unsupported", { status: 415 }))).toMatchObject({ status: 415, body: { message: "Unsupported content encoding" } });
    expect(run(parser("charset.unsupported", { status: 415 }))).toMatchObject({ status: 415, body: { message: "Unsupported charset" } });
  });

  it("answers with the uniform error envelope", () => {
    const { body } = run(new ForbiddenException());
    expect(Object.keys(body).sort()).toEqual(["error", "message", "path", "statusCode", "success", "timestamp"]);
  });
});
