import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({ expireSession: () => undefined }));

const { apiGet, apiSend, isApiUnreachable, API_UNREACHABLE_MESSAGE } = await import("./api");

function answer(status: number, body: unknown, statusText = ""): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, statusText })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isApiUnreachable", () => {
  it("names a network error as an unreachable API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = await apiSend("/api/auth/login", "POST", {}).catch((caught: unknown) => caught);
    expect(isApiUnreachable(error)).toBe(true);
    expect((error as Error).message).toBe(API_UNREACHABLE_MESSAGE);
  });

  it("names a proxy's gateway error page as an unreachable API", async () => {
    answer(502, "<html>Bad Gateway</html>", "Bad Gateway");
    const error = await apiSend("/api/auth/login", "POST", {}).catch((caught: unknown) => caught);
    expect(isApiUnreachable(error)).toBe(true);
  });

  it("keeps an answer of the API itself, even a 503", async () => {
    answer(503, { success: false, statusCode: 503, error: "Service Unavailable", message: "Database is down", timestamp: "", path: "/x" });
    const error = await apiGet("/x").catch((caught: unknown) => caught);
    expect(isApiUnreachable(error)).toBe(false);
    expect((error as Error).message).toBe("Database is down");
  });

  it("keeps a refused sign-in", async () => {
    answer(401, { success: false, statusCode: 401, error: "Unauthorized", message: "Invalid credentials", timestamp: "", path: "/api/auth/login" });
    const error = await apiSend("/api/auth/login", "POST", {}).catch((caught: unknown) => caught);
    expect(isApiUnreachable(error)).toBe(false);
    expect((error as Error).message).toBe("Invalid credentials");
  });
});
