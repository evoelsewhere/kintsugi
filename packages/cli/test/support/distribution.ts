// Shared by the tests of the member plugin commands: a CLI with a fake Kintsugi API, a fake client command runner and a
// temporary configuration folder.

import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import type { CliDeps } from "../../src/cli.js";
import { bundleContentHash } from "../../src/commands/plugin-distribution.js";
import { FileProfileStore } from "../../src/profile.js";

export const folders: string[] = [];
export const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function artifactRoot(root: string, harness: string, profileId: string): string {
  const namespace = `profile-${createHash("sha256").update(profileId, "utf8").digest("hex").slice(0, 16)}`;
  return join(root, "Kintsugi config", "plugins", "connector", namespace, harness);
}

export function bundleOf(name: string, version: string, files: Record<string, string>, tamper = false) {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, content, sha256: sha(content) }));
  return {
    schemaVersion: "1", projectId: "shop", name, title: "Modernize", version, description: "d",
    contentHash: bundleContentHash(entries),
    files: tamper ? entries.map((entry, index) => index === 0 ? { ...entry, content: `${entry.content} tampered` } : entry) : entries,
  };
}

export async function createState(responses: Record<string, unknown>, options: { signedUp?: boolean; env?: Record<string, string> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "kintsugi-cli-distribution-"));
  folders.push(root);
  const configPath = join(root, "Kintsugi config", "config.json");
  await mkdir(join(root, "Kintsugi config"), { recursive: true });
  const profiles = options.signedUp === false ? { schemaVersion: "1", profiles: {} } : { schemaVersion: "1", activeProfile: "work", profiles: { work: { id: "work", baseUrl: "https://kintsugi.example", projectId: "shop" } } };
  await writeFile(configPath, JSON.stringify(profiles, null, 2), "utf8");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requested: string[] = [];
  const runClientCommand = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
  const deps = {
    profiles: new FileProfileStore(configPath),
    credentials: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}${url.search}`);
      const data = responses[url.pathname];
      return data === undefined ? Response.json({ success: false, statusCode: 404, error: "Not Found", message: "no" }, { status: 404 }) : Response.json({ success: true, data });
    },
    serveMcp: async () => undefined,
    cwd: root,
    homeDir: root,
    env: { KINTSUGI_CONFIG: configPath, ...(options.env ?? {}) },
    isTTY: false,
    promptSecret: async () => "unused",
    readStdin: async () => "TEST-token",
    stdout: { write: (value: string) => { stdout.push(value); } },
    stderr: { write: (value: string) => { stderr.push(value); } },
    sleep: async () => undefined,
    launcher: { launcherPath: process.execPath, cliEntrypointPath: process.execPath, cliVersion: "0.1.0" },
    getClientVersion: async (target: string) => target === "claude" ? "2.1.278" : "0.163.0-alpha.10.2",
    runClientCommand,
  } as unknown as CliDeps;
  return { root, stdout, stderr, requested, runClientCommand, deps };
}

export async function temp(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "kintsugi-cli-home-"));
  folders.push(folder);
  return folder;
}

export const exists = (path: string) => stat(path).then(() => true, () => false);

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

export const FILES = {
  "skills/build-method/SKILL.md": "---\nname: build-method\ndescription: d\n---\n# Build method\n",
  "commands/build.md": "---\ndescription: Build a unit\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: \"kintsugi activity hook stop --plugin modernize --command build\"\n---\n# Build\n",
  "agents/helper.md": "# helper\n",
};
