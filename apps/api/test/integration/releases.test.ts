// The CLI download (ADR-0070): the manifest, the installers and the packages, public and served from the releases folder.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDatabase } from "../support/database.js";
import { Client, startTestApp, type TestApp } from "../support/app.js";

/** A plain request: installers and packages are not JSON. */
async function plain(app: TestApp, path: string): Promise<{ status: number; raw: string; type: string }> {
  const response = await fetch(`${app.baseUrl}${path}`);
  return { status: response.status, raw: await response.text(), type: response.headers.get("content-type") ?? "" };
}

const PACKAGE = "package bytes of the linux build";
const sha = createHash("sha256").update(PACKAGE).digest("hex");

async function release(dir: string, version: string): Promise<void> {
  await mkdir(join(dir, version), { recursive: true });
  await writeFile(join(dir, version, `kintsugi-${version}-linux-x64.tar.gz`), PACKAGE);
  await writeFile(join(dir, version, "manifest.json"), JSON.stringify({
    schemaVersion: "1", version, builtAt: "2026-10-23T00:00:00.000Z", minNode: "22.19.0",
    assets: [{ platform: "linux-x64", file: `kintsugi-${version}-linux-x64.tar.gz`, sha256: sha, size: PACKAGE.length }],
  }));
}

describe.skipIf(!hasDatabase)("CLI releases (integration)", () => {
  let dir: string;
  let app: TestApp;
  let previous: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kintsugi-releases-"));
    await release(dir, "0.2.0");
    await release(dir, "0.10.0");
    await mkdir(join(dir, "not-a-version"));
    previous = process.env["KINTSUGI_RELEASES_DIR"];
    process.env["KINTSUGI_RELEASES_DIR"] = dir;
    app = await startTestApp();
  });
  afterAll(async () => {
    await app?.close();
    if (previous === undefined) delete process.env["KINTSUGI_RELEASES_DIR"];
    else process.env["KINTSUGI_RELEASES_DIR"] = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it("describes the highest version without a session", async () => {
    const response = await new Client(app).request<{ version: string; baseUrl: string; assets: Array<{ platform: string; url: string; sha256: string }>; installers: { sh: string; ps1: string } }>("GET", "/v1/releases/latest");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ version: "0.10.0", assets: [{ platform: "linux-x64", sha256: sha }] });
    expect(response.body.data!.assets[0]!.url).toBe(`${response.body.data!.baseUrl}/api/v1/releases/0.10.0/kintsugi-0.10.0-linux-x64.tar.gz`);
    expect(response.body.data!.installers.sh).toBe(`${response.body.data!.baseUrl}/api/v1/releases/latest/install.sh`);
  });

  it("serves the installers as plain scripts, not as an envelope", async () => {
    const sh = await plain(app, "/v1/releases/latest/install.sh");
    expect(sh.status).toBe(200);
    expect(sh.raw.startsWith("#!/bin/sh")).toBe(true);
    expect(sh.raw).toContain(`sha256='${sha}'`);
    expect(sh.raw).toContain("VERSION='0.10.0'");
    const ps1 = await plain(app, "/v1/releases/latest/install.ps1");
    expect(ps1.status).toBe(200);
    expect(ps1.raw).toContain("$ErrorActionPreference = 'Stop'");
    expect(ps1.raw).toContain("$Version = '0.10.0'");
  });

  it("serves a listed package by version or as latest, and nothing else", async () => {
    const pinned = await plain(app, "/v1/releases/0.2.0/kintsugi-0.2.0-linux-x64.tar.gz");
    expect(pinned.status).toBe(200);
    expect(pinned.raw).toBe(PACKAGE);
    expect((await plain(app, "/v1/releases/latest/kintsugi-0.10.0-linux-x64.tar.gz")).raw).toBe(PACKAGE);
    expect((await plain(app, "/v1/releases/0.2.0/manifest.json")).status).toBe(404);
    expect((await plain(app, "/v1/releases/0.2.0/kintsugi-0.10.0-linux-x64.tar.gz")).status).toBe(404);
    expect((await plain(app, "/v1/releases/not-a-version/manifest.json")).status).toBe(404);
    expect((await plain(app, "/v1/releases/0.2.0/..%2Fmanifest.json")).status).toBe(404);
  });
});

describe.skipIf(!hasDatabase)("CLI releases without a release (integration)", () => {
  let dir: string;
  let app: TestApp;
  let previous: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kintsugi-no-releases-"));
    previous = process.env["KINTSUGI_RELEASES_DIR"];
    process.env["KINTSUGI_RELEASES_DIR"] = dir;
    app = await startTestApp();
  });
  afterAll(async () => {
    await app?.close();
    if (previous === undefined) delete process.env["KINTSUGI_RELEASES_DIR"];
    else process.env["KINTSUGI_RELEASES_DIR"] = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it("answers 404 with a reason instead of a broken installer", async () => {
    for (const path of ["/v1/releases/latest", "/v1/releases/latest/install.sh", "/v1/releases/latest/install.ps1"]) {
      const response = await plain(app, path);
      expect(response.status, path).toBe(404);
      expect(response.raw).toContain("no CLI release");
    }
  });
});
