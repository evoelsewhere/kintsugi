import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({ expireSession: () => undefined }));

const { apiGet, apiSend, isApiUnreachable, API_DID_NOT_ANSWER_MESSAGE } = await import("./api");

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
    expect((error as Error).message).toBe(API_DID_NOT_ANSWER_MESSAGE);
  });

  it("names a proxy's gateway error page as an unreachable API", async () => {
    answer(502, "<html>Bad Gateway</html>", "Bad Gateway");
    const error = await apiSend("/api/auth/login", "POST", {}).catch((caught: unknown) => caught);
    expect(isApiUnreachable(error)).toBe(true);
  });

  it("says the API did not answer, without the request's path, for any request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const status of [502, 503, 504]) {
      answer(status, "<html>gateway</html>", "Gateway");
      const error = await apiSend("/api/projects/billing-qa/applications/billing/stages/assess/run", "POST", {}).catch((caught: unknown) => caught);
      expect((error as Error).message).toBe("Kintsugi's API did not answer. Try again in a moment.");
      expect((error as Error).message).not.toContain("/api/");
    }
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
