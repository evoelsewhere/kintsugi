import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

let directory: string | undefined;
afterEach(async () => { if (directory !== undefined) await rm(directory, { recursive: true, force: true }); directory = undefined; });

function runNode(args: string[], env: NodeJS.ProcessEnv, input = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, { env, cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); }, 3_500);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = { code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (code === null) reject(new Error(`CLI child timed out; stdout=${result.stdout}; stderr=${result.stderr}`));
      else resolveResult(result);
    });
    child.stdin.end(input);
  });
}

describe("compiled CLI process", () => {
  it("runs on a supported Node version and keeps JSON failures on stderr", async () => {
    const [major, minor] = process.versions.node.split(".").map(Number);
    expect((major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 19)).toBe(true);
    directory = await mkdtemp(join(tmpdir(), "kintsugi-cli-process-"));
    const entrypoint = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/main.js");
    const env = { ...process.env, KINTSUGI_CONFIG: join(directory, "config.json") };
    const result = await runNode([entrypoint, "--json", "project", "list"], env);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ success: false, error: { code: "PROFILE_REQUIRED" } });

    const help = await runNode([entrypoint, "--help"], env);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: kintsugi");
    expect(help.stdout.includes(String.fromCharCode(27))).toBe(false);
  });

  it("runs a complete JSON read in the compiled process with an ephemeral stdin token", async () => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-cli-process-success-"));
    let requestCount = 0;
    let sawExpectedToken = false;
    const server = createServer((request, response) => {
      requestCount += 1;
      sawExpectedToken = request.headers.authorization === "Bearer TEST-process-token";
      expect(request.url).toMatch(/^\/api\/member\/v1\/projects\?/);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { schemaVersion: "1", items: [], limit: 25 } }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("No local HTTP port");
      const configPath = join(directory, "config.json");
      await writeFile(configPath, JSON.stringify({ schemaVersion: "1", activeProfile: "test", profiles: {
        test: { id: "test", baseUrl: `http://127.0.0.1:${address.port}` },
      } }));
      const entrypoint = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/main.js");
      const env = { ...process.env, KINTSUGI_CONFIG: configPath };
      let result: Awaited<ReturnType<typeof runNode>>;
      try { result = await runNode([entrypoint, "--token-stdin", "--json", "project", "list"], env, "TEST-process-token"); }
      catch (error) { throw new Error(`${String(error)}; requests=${requestCount}; sawExpectedToken=${sawExpectedToken}`, { cause: error }); }
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: "1", items: [] });
      expect(result.stderr).toBe("");
      expect(result.stdout + result.stderr).not.toContain("TEST-process-token");
    } finally {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }
  });
});

describe("compiled task watch", () => {
  it.each([false, true])("streams NDJSON, resumes server EOF if needed, and closes at its limit; reconnect: %s", async (reconnect) => {
    directory = await mkdtemp(join(tmpdir(), "kintsugi-cli-watch-"));
    const event = (id: string) => ({ schemaVersion: "1", projectId: "shop", unitId: "web/core/invoice", id,
      kind: "task.activity-ready", occurredAt: "2026-10-21T00:00:00Z", metadata: { activity: "verification" } });
    let subscriptions = 0;
    let closeSubscription!: () => void;
    const subscriptionClosed = new Promise<void>((resolveClosed) => { closeSubscription = resolveClosed; });
    const server = createServer((request, response) => {
      subscriptions += 1;
      const isReplay = subscriptions === 2;
      expect(request.url).toBe(`/api/member/v1/task-events?projectId=shop&unitId=web%2Fcore%2Finvoice&afterEventId=${isReplay ? "evt_1" : "evt_0"}&limit=${isReplay ? "1" : "2"}`);
      expect(request.headers["last-event-id"]).toBe(isReplay ? "evt_1" : "evt_0");
      expect(request.headers.authorization).toBe("Bearer TEST-watch-token");
      if (!reconnect || isReplay) response.on("close", closeSubscription);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": heartbeat\n\n");
      const ids = reconnect ? [isReplay ? "evt_2" : "evt_1"] : ["evt_1", "evt_2"];
      for (const id of ids) response.write(`event: task-event\nid: ${id}\ndata: ${JSON.stringify(event(id))}\n\n`);
      if (reconnect && !isReplay) response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("No local HTTP port");
      const configPath = join(directory, "config.json");
      await writeFile(configPath, JSON.stringify({ schemaVersion: "1", activeProfile: "test", profiles: {
        test: { id: "test", baseUrl: `http://127.0.0.1:${address.port}`, projectId: "shop" },
      } }));
      const entrypoint = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/main.js");
      const result = await runNode([entrypoint, "task", "watch", "web/core/invoice", "--after-event-id", "evt_0", "--limit", "2", "--token-stdin", "--json"],
        { ...process.env, KINTSUGI_CONFIG: configPath }, "TEST-watch-token");
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim().split("\n").map((line) => JSON.parse(line))).toEqual([event("evt_1"), event("evt_2")]);
      expect(subscriptions).toBe(reconnect ? 2 : 1);
      await subscriptionClosed;
    } finally { server.closeAllConnections(); await new Promise<void>((resolveClosed) => server.close(() => resolveClosed())); }
  });
});
