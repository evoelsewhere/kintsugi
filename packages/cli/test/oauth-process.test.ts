import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./fixtures/oauth-process.mjs", import.meta.url));
const children: ChildProcess[] = [];
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const child of children.splice(0)) { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  for (const action of cleanup.splice(0).reverse()) await action();
});

type Message = { event: string; success?: boolean; code?: string };

async function environment(handle: (request: IncomingMessage, response: ServerResponse, body: Record<string, string>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "kintsugi-oauth-process-"));
  cleanup.push(async () => rm(directory, { recursive: true, force: true }));
  const api = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      await handle(request, response, JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>);
    })().catch(() => { response.writeHead(500).end(); });
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  cleanup.push(async () => { await new Promise<void>((resolve) => { api.close(() => resolve()); api.closeAllConnections(); }); });
  const address = api.address();
  if (address === null || typeof address === "string") throw new Error("Missing test API address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const file = join(directory, "synthetic-keyring");
  const id = `test-${randomUUID()}`;
  const envelope = { version: 1, baseUrl, refreshToken: "knt_crt_0", connectionId: "synthetic", projectIds: ["shop"] };
  await writeFile(file, JSON.stringify(envelope));

  const worker = async (mode: string) => {
    const child = fork(fixture, [], { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"], env: {
      ...process.env, KINTSUGI_TEST_PROFILE_ID: id, KINTSUGI_TEST_BASE_URL: baseUrl,
      KINTSUGI_TEST_CREDENTIAL_FILE: file, KINTSUGI_TEST_MODE: mode,
    } });
    children.push(child);
    const messages: Message[] = [];
    child.on("message", (message: Message) => { messages.push(message); });
    const wait = async (event: string): Promise<Message> => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const found = messages.find((message) => message.event === event);
        if (found !== undefined) return found;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Synthetic worker exited before ${event}`);
        await delay(10);
      }
      throw new Error(`Synthetic worker timed out before ${event}`);
    };
    await wait("ready");
    return { child, wait, messages, start: () => child.send({ event: "start" }) };
  };
  return { worker, file, envelope };
}

function issue(response: ServerResponse, generation: number): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ success: true, data: { accessToken: `knt_caw_${generation}`, refreshToken: `knt_crt_${generation}`, expiresIn: 300, connectionId: "synthetic", projectIds: ["shop"] } }));
}

describe("cross-process OAuth serialization", () => {
  it("rotates one shared keyring in two real processes without refresh replay", async () => {
    const seen: string[] = [];
    let generation = 0;
    let replay = false;
    const env = await environment(async (_request, response, body) => {
      seen.push(body.refreshToken!);
      if (body.refreshToken !== `knt_crt_${generation}`) { replay = true; response.writeHead(401).end(); return; }
      const next = ++generation;
      await delay(100);
      issue(response, next);
    });
    const [first, second] = await Promise.all([env.worker("refresh"), env.worker("refresh")]);
    first.start(); second.start();
    expect(await first.wait("done")).toMatchObject({ success: true });
    expect(await second.wait("done")).toMatchObject({ success: true });
    expect(replay).toBe(false);
    expect(seen).toEqual(["knt_crt_0", "knt_crt_1"]);
    expect(JSON.parse(await readFile(env.file, "utf8")).refreshToken).toBe("knt_crt_2");
  });

  it("serializes logout after refresh and revokes the newly rotated credential", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let requested!: () => void;
    const received = new Promise<void>((resolve) => { requested = resolve; });
    const revoked: string[] = [];
    const env = await environment(async (request, response, body) => {
      if (request.url?.endsWith("/token")) { requested(); await gate; issue(response, 1); }
      else { revoked.push(body.refreshToken!); response.writeHead(204).end(); }
    });
    const [refresh, logout] = await Promise.all([env.worker("refresh"), env.worker("logout")]);
    refresh.start(); await received;
    logout.start(); await delay(100);
    expect(revoked).toEqual([]);
    release();
    expect(await refresh.wait("done")).toMatchObject({ success: true });
    expect(await logout.wait("done")).toMatchObject({ success: true });
    expect(revoked).toEqual(["knt_crt_1"]);
    await expect(readFile(env.file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reuses consent completed by another waiting first-use process", async () => {
    const grants: string[] = [];
    let generation = 0;
    const env = await environment(async (_request, response, body) => { grants.push(body.grantType!); issue(response, ++generation); });
    await rm(env.file);
    const [first, second] = await Promise.all([env.worker("login"), env.worker("login")]);
    first.start(); second.start();
    expect(await first.wait("done")).toMatchObject({ success: true });
    expect(await second.wait("done")).toMatchObject({ success: true });
    expect([...first.messages, ...second.messages].filter((message) => message.event === "browser")).toHaveLength(1);
    expect(grants).toEqual(["authorization_code", "refresh_token"]);
  });

  it("recovers the OS lock after an ungracefully killed holder", async () => {
    let requests = 0;
    const env = await environment(async (_request, response) => { requests++; issue(response, 1); });
    const holder = await env.worker("hold");
    holder.start(); await holder.wait("locked");
    const next = await env.worker("refresh");
    next.start(); await delay(100);
    expect(requests).toBe(0);
    const exited = once(holder.child, "exit");
    holder.child.kill("SIGKILL"); await exited;
    expect(await next.wait("done")).toMatchObject({ success: true });
    expect(requests).toBe(1);
  });

  it("never replays after a process dies during an uncertain refresh exchange", async () => {
    let received!: () => void;
    const consumed = new Promise<void>((resolve) => { received = resolve; });
    let refreshes = 0;
    let revocations = 0;
    const env = await environment(async (request, response) => {
      if (request.url?.endsWith("/token")) { refreshes++; received(); /* Simulate a consumed token with no delivered response. */ }
      else { revocations++; response.writeHead(204).end(); }
    });
    const first = await env.worker("refresh");
    first.start(); await consumed;
    expect(JSON.parse(await readFile(env.file, "utf8")).refreshPending).toBe(true);
    const exited = once(first.child, "exit");
    first.child.kill("SIGKILL"); await exited;
    const next = await env.worker("refresh");
    next.start();
    expect(await next.wait("done")).toMatchObject({ success: false, code: "REAUTHENTICATION_REQUIRED" });
    expect(refreshes).toBe(1);
    expect(revocations).toBe(1);
    await expect(readFile(env.file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
