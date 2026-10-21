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
});
