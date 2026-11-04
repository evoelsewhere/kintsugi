// The portal as the API serves it (SP-001): its index page and files carry a Content-Security-Policy that keeps scripts
// to the portal's own and images local, `/api` does not (the Swagger UI there needs inline script), and the portal's
// routes still get the index page. An express app stands in for the Nest one: only the methods the setup calls.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configurePortalServing } from "../../src/common/interface/portal.js";
import { PORTAL_CONTENT_SECURITY_POLICY, configureSecurityHeaders } from "../../src/common/interface/security-headers.js";

const INDEX = '<!doctype html><html><head><title>Kintsugi</title></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>';

describe("the portal's Content-Security-Policy", () => {
  let dir: string;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kintsugi-portal-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), INDEX);
    await writeFile(join(dir, "assets", "main.js"), "console.log('portal');\n");
    const instance = express();
    const shim = {
      getHttpAdapter: () => ({ getInstance: () => instance }),
      use: (...handlers: Parameters<typeof instance.use>) => instance.use(...handlers),
      useStaticAssets: (path: string, options: object) => instance.use(express.static(path, options)),
    } as unknown as NestExpressApplication;
    configureSecurityHeaders(shim);
    configurePortalServing(shim, dir);
    instance.get("/api/health", (_request, response) => response.json({ ok: true }));
    instance.get("/api/docs", (_request, response) => response.type("html").send("<script>swagger()</script>"));
    server = instance.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  const directives = (policy: string): Map<string, string[]> => new Map(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name!, values]));

  it("sets scripts to the portal's own, no plug-ins, no <base>, no framing and no remote images on the index page", async () => {
    const response = await fetch(`${origin}/`, { headers: { accept: "text/html" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
    const policy = response.headers.get("content-security-policy");
    expect(policy).toBe(PORTAL_CONTENT_SECURITY_POLICY);
    const rules = directives(policy!);
    expect(rules.get("script-src")).toEqual(["'self'"]);
    expect(rules.get("object-src")).toEqual(["'none'"]);
    expect(rules.get("base-uri")).toEqual(["'self'"]);
    expect(rules.get("frame-ancestors")).toEqual(["'none'"]);
    expect(rules.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(rules.get("default-src")).toEqual(["'self'"]);
    expect(rules.get("connect-src")).toEqual(["'self'"]);
    // Nothing in the policy lets a script run from elsewhere or inline, or an image come from another site.
    for (const name of ["script-src", "default-src", "img-src"]) expect(rules.get(name)!.join(" ")).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("carries it on a portal route that is answered with the index page, and on the portal's files", async () => {
    const route = await fetch(`${origin}/projects/shop/wiki/guide`, { headers: { accept: "text/html" } });
    expect(await route.text()).toBe(INDEX);
    expect(route.headers.get("content-security-policy")).toBe(PORTAL_CONTENT_SECURITY_POLICY);
    const script = await fetch(`${origin}/assets/main.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-security-policy")).toBe(PORTAL_CONTENT_SECURITY_POLICY);
  });

  it("leaves /api alone: the API's answers and its Swagger UI are not the portal", async () => {
    for (const path of ["/api/health", "/api/docs"]) {
      const response = await fetch(`${origin}${path}`, { headers: { accept: "text/html" } });
      expect(response.headers.get("content-security-policy"), path).toBeNull();
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
    }
  });

  it("refuses to serve a portal that was not built", () => {
    const shim = { useStaticAssets: () => undefined, use: () => undefined } as unknown as NestExpressApplication;
    expect(() => configurePortalServing(shim, join(dir, "missing"))).toThrow(/Portal build is missing/);
  });
});
