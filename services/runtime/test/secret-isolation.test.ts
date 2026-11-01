// Job processes kept away from the worker's secrets (ADR-0093): the job user setting, the spawn options that carry it,
// the workspace handed to it, and provider credentials that never ride in a spawn environment. The probe at the end needs
// a Linux worker that may start processes as another user (the worker image, as root with SETUID/SETGID, and
// KINTSUGI_JOB_UID/GID set): it is skipped elsewhere. In the image: `KINTSUGI_JOB_UID=10002 KINTSUGI_JOB_GID=10002
// pnpm --filter @kintsugi/runtime exec vitest run test/secret-isolation.test.ts`.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyProviderEnvironment, interpretersFromEnv, jobIsolationWarning, jobUser, removeTree, runScript } from "../src/launcher/index.js";
import { spawnOptions } from "../src/launcher/process.js";

const root = mkdtempSync(join(tmpdir(), "kintsugi-isolation-test-"));
afterAll(() => removeTree(root));

describe("the job user (ADR-0093)", () => {
  it("is read from KINTSUGI_JOB_UID and KINTSUGI_JOB_GID, both numeric, never root", () => {
    expect(jobUser({}, "linux")).toBeUndefined();
    expect(jobUser({ KINTSUGI_JOB_UID: "10002", KINTSUGI_JOB_GID: "10002" }, "linux")).toEqual({ uid: 10002, gid: 10002 });
    expect(() => jobUser({ KINTSUGI_JOB_UID: "10002" }, "linux")).toThrow(/both be set/);
    expect(() => jobUser({ KINTSUGI_JOB_UID: "job", KINTSUGI_JOB_GID: "10002" }, "linux")).toThrow(/numeric/);
    expect(() => jobUser({ KINTSUGI_JOB_UID: "0", KINTSUGI_JOB_GID: "0" }, "linux")).toThrow(/root/);
    expect(() => jobUser({ KINTSUGI_JOB_UID: "10002", KINTSUGI_JOB_GID: "10002" }, "win32")).toThrow(/Windows/);
  });

  it("warns a POSIX worker that runs jobs as itself, and nobody else", () => {
    expect(jobIsolationWarning({}, "linux")).toMatch(/not set: job processes run as the worker's user/);
    expect(jobIsolationWarning({ KINTSUGI_JOB_UID: "10002", KINTSUGI_JOB_GID: "10002" }, "linux")).toBeUndefined();
    expect(jobIsolationWarning({}, "win32")).toBeUndefined();
  });

  it("reaches the spawn options of every job process, and only when it is set", () => {
    const base = { cwd: root, env: { PATH: "/usr/bin" } };
    expect(spawnOptions({ ...base, runAs: { uid: 10002, gid: 10003 } })).toMatchObject({ uid: 10002, gid: 10003, env: { PATH: "/usr/bin" }, shell: false });
    const plain = spawnOptions(base);
    expect(plain).not.toHaveProperty("uid");
    expect(plain).not.toHaveProperty("gid");
  });
});

describe("provider credentials of an agent job (ADR-0093)", () => {
  it("are put into the child's own environment after it started", () => {
    const target: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    applyProviderEnvironment({ config: { kind: "custom", id: "p", enabled: true, auth: { type: "env" } }, env: { AWS_REGION: "eu-test-1" } }, target);
    expect(target).toEqual({ PATH: "/usr/bin", AWS_REGION: "eu-test-1" });
    applyProviderEnvironment(undefined, target);
    expect(target).toEqual({ PATH: "/usr/bin", AWS_REGION: "eu-test-1" });
  });
});

const user = process.platform === "linux" ? jobUser() : undefined;
const canSwitch = user !== undefined && typeof process.getuid === "function" && process.getuid() === 0;

describe.skipIf(!canSwitch)("the Linux probe: a script step run as the job user (ADR-0093)", () => {
  it("cannot read the worker's environment, and writes its output as the job user", async () => {
    process.env["KINTSUGI_PROBE_SECRET"] = "probe-secret-value";
    const dir = join(root, "probe");
    const paths = { src: join(dir, "src"), in: join(dir, "in"), out: join(dir, "out"), tmp: join(dir, "tmp") };
    for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
    const script = join(root, "probe.py");
    writeFileSync(
      script,
      `import os, sys
found = []
if 'probe-secret-value' in ''.join(os.environ.values()): found.append('own environment')
try:
    if b'probe-secret-value' in open('/proc/%d/environ' % int(sys.argv[1]), 'rb').read(): found.append('worker environ')
except OSError:
    pass
open(os.path.join(sys.argv[2], 'probe.txt'), 'w').write(','.join(found) + '|%d' % os.getuid())
`,
    );
    const result = await runScript({
      file: script,
      args: [String(process.pid), paths.out],
      workspace: { cwd: dir, readOnly: [paths.src, paths.in], writable: [paths.out, paths.tmp], tmp: paths.tmp, out: paths.out },
      limits: { timeoutSec: 30, maxOutputBytes: 1024 * 1024 },
      interpreters: interpretersFromEnv(),
    });
    delete process.env["KINTSUGI_PROBE_SECRET"];
    expect(result.failure).toBeUndefined();
    expect(readFileSync(join(paths.out, "probe.txt"), "utf8")).toBe(`|${user!.uid}`);
  });
});
