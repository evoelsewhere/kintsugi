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

  it("answers with the uniform error envelope", () => {
    const { body } = run(new ForbiddenException());
    expect(Object.keys(body).sort()).toEqual(["error", "message", "path", "statusCode", "success", "timestamp"]);
  });
});
