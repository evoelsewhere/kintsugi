import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createFetchWithPrivateCa } from "../src/tls.js";

let directory: string | undefined;
afterEach(async () => { if (directory !== undefined) await rm(directory, { recursive: true, force: true }); directory = undefined; });

const openssl = process.platform === "win32" ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "openssl.exe") : "openssl";
const opensslAvailable = spawnSync(openssl, ["version"], { stdio: "ignore", windowsHide: true }).status === 0;

describe("private CA transport", () => {
  it.skipIf(!opensslAvailable)("trusts a registered private CA while retaining hostname and TLS verification", async () => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-private-ca-"));
    const keyFile = join(directory, "server.key");
    const certFile = join(directory, "server.crt");
    const generated = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyFile, "-out", certFile, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore", windowsHide: true });
    expect(generated.status).toBe(0);
    const key = await readFile(keyFile);
    const cert = await readFile(certFile, "utf8");
    const server = createServer({ key, cert }, (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ trusted: true }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("No local TLS port");
      const fetchWithCa = await createFetchWithPrivateCa(certFile);
      const response = await fetchWithCa(`https://127.0.0.1:${address.port}/health`);
      await expect(response.json()).resolves.toEqual({ trusted: true });
      await expect(fetch(`https://127.0.0.1:${address.port}/health`)).rejects.toThrow();
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it.skipIf(!opensslAvailable)("returns streaming responses before the server finishes sending an event stream", async () => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-private-ca-stream-"));
    const keyFile = join(directory, "server.key");
    const certFile = join(directory, "server.crt");
    const generated = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyFile, "-out", certFile, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore", windowsHide: true });
    expect(generated.status).toBe(0);
    const key = await readFile(keyFile);
    let markStarted!: () => void;
    let releaseResponse!: () => void;
    const responseStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const finishResponse = new Promise<void>((resolve) => { releaseResponse = resolve; });
    const server = createServer({ key, cert: await readFile(certFile) }, (_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      markStarted();
      void finishResponse.then(() => response.end("data: second\n\n"));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let responsePromise: Promise<Response> | undefined;
    let response: Response | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("No local TLS port");
      const fetchWithCa = await createFetchWithPrivateCa(certFile);
      responsePromise = fetchWithCa(`https://127.0.0.1:${address.port}/events`);
      await responseStarted;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutTimer = setTimeout(() => reject(new Error("private-CA fetch waited for the full response body")), 1_000);
      });
      response = await Promise.race([responsePromise, timeout]);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
    } finally {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      releaseResponse();
      if (response === undefined) response = await responsePromise?.catch(() => undefined);
      await response?.text();
      server.close();
      await once(server, "close");
    }
  });
});
