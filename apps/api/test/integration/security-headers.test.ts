// Every response carries the hardening headers and does not name the framework; the public health check does not name
// the Node.js version.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { startTestApp, type TestApp } from "../support/app.js";

describe.skipIf(!hasDatabase)("security headers (integration)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("sets nosniff, no framing and no referrer, and hides Express", async () => {
    for (const path of ["/health", "/auth/me", "/no-such-route"]) {
      const response = await fetch(`${app.baseUrl}${path}`);
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("referrer-policy"), path).toBe("no-referrer");
      expect(response.headers.get("x-powered-by"), path).toBeNull();
    }
  });

  it("keeps the Node.js version out of the public health check", async () => {
    const body = (await (await fetch(`${app.baseUrl}/health`)).json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ status: "ok", service: "kintsugi-api" });
    expect(Object.keys(body.data).sort()).toEqual(["at", "build", "service", "status", "uptimeSeconds"]);
    expect(JSON.stringify(body)).not.toContain(process.version);
  });
});
