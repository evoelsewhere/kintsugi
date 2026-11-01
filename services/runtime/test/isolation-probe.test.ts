// The job-isolation probe operators run on their host (deploy/compose/probe-job-isolation.sh, ADR-0093): when it can
// run, how it reads what its children report, and its verdict. Running it needs the Linux worker image as root with the
// job user set; on any other host it says why it cannot, which these tests check too.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PROBE_SECRET, judge, parseReport, probeJobIsolation, probeUnsupported } from "../src/launcher/isolation-probe.js";
import { interpretersFromEnv } from "../src/launcher/script.js";

const READY = { KINTSUGI_JOB_UID: "10002", KINTSUGI_JOB_GID: "10002", [PROBE_SECRET]: "marker" };
const USER = { uid: 10002, gid: 10002 };

describe("when the probe can run", () => {
  it("needs the Linux image, the job user, a root worker and the marker secret", () => {
    expect(probeUnsupported(READY, "linux", 0)).toBeUndefined();
    expect(probeUnsupported(READY, "win32", 0)).toMatch(/only on the Linux worker image/);
    expect(probeUnsupported({ [PROBE_SECRET]: "marker" }, "linux", 0)).toMatch(/KINTSUGI_JOB_UID and KINTSUGI_JOB_GID are not set/);
    expect(probeUnsupported({ ...READY, KINTSUGI_JOB_GID: "" }, "linux", 0)).toMatch(/must both be set/);
    expect(probeUnsupported(READY, "linux", 10001)).toMatch(/not root/);
    expect(probeUnsupported({ KINTSUGI_JOB_UID: "10002", KINTSUGI_JOB_GID: "10002" }, "linux", 0)).toMatch(/KINTSUGI_PROBE_SECRET is not in the environment/);
    // The control runs as the worker's own (non-root) user without the job user: it needs Linux and the marker only.
    expect(probeUnsupported({ [PROBE_SECRET]: "marker" }, "linux", 10001, true)).toBeUndefined();
    expect(probeUnsupported({}, "linux", 10001, true)).toMatch(/KINTSUGI_PROBE_SECRET is not in the environment/);
    expect(probeUnsupported({ [PROBE_SECRET]: "marker" }, "win32", 0, true)).toMatch(/only on the Linux worker image/);
  });

  it("says it cannot run here instead of passing", async () => {
    if (process.platform === "linux" && process.getuid?.() === 0) return;
    const result = await probeJobIsolation({ env: READY, interpreters: interpretersFromEnv() });
    expect(result.status).toBe("unsupported");
    expect(result.lines).toHaveLength(1);
  });
});

describe("the verdict", () => {
  const isolated = "environ=denied\nuid=10002\nPATH\nHOME\nTMPDIR\n";

  it("reads a child's report: the worker's environ, its uid and its variable names, never a value", () => {
    expect(parseReport("shell child", isolated)).toEqual({ label: "shell child", workerEnviron: "denied", uid: 10002, names: ["PATH", "HOME", "TMPDIR"] });
    expect(parseReport("x", "garbage=1\n")).toMatchObject({ workerEnviron: "unknown", uid: undefined, names: [] });
  });

  it("is isolated only when every child ran as the job user, was denied the worker's environ and saw no worker secret", () => {
    const good = [parseReport("script step", isolated), parseReport("shell child", isolated)];
    expect(judge(good, USER).status).toBe("isolated");
    const cases: Array<[string, string]> = [
      ["environ=readable\nuid=10002\nPATH\n", "the worker's /proc environ was readable"],
      ["environ=denied\nuid=10001\nPATH\n", "ran as uid 10001, not the job user 10002"],
      ["environ=denied\nuid=10002\nPATH\nDATABASE_URL\n", "its own environment holds DATABASE_URL"],
      [`environ=denied\nuid=10002\n${PROBE_SECRET}\n`, `its own environment holds ${PROBE_SECRET}`],
      ["", "the worker's /proc environ was not checked"],
    ];
    for (const [stdout, reason] of cases) {
      const result = judge([parseReport("script step", isolated), parseReport("shell child", stdout)], USER);
      expect(result.status, stdout).toBe("exposed");
      expect(result.lines.join("\n"), stdout).toContain(reason);
    }
    expect(judge([], USER).status).toBe("exposed");
  });
});

// The wrapper an operator runs (deploy/compose/probe-job-isolation.sh), with a fake docker that answers for the probe:
// the isolated run's verdict, then the control's (P-037). Needs sh (Git for Windows has one).
const WRAPPER = fileURLToPath(new URL("../../../deploy/compose/probe-job-isolation.sh", import.meta.url));
const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;

describe.skipIf(!hasSh)("the probe wrapper and its control run (P-037)", () => {
  const fake = mkdtempSync(join(tmpdir(), "kintsugi-fake-docker-"));
  writeFileSync(
    join(fake, "docker"),
    [
      "#!/bin/sh",
      '[ "$1 $2" = "compose version" ] && exit 0',
      'case "$*" in *isolated.yml*) verdict="$FAKE_MAIN" ;; *) verdict="$FAKE_CONTROL" ;; esac',
      'echo "probe: script step: checked"',
      'echo "probe: $verdict"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  afterAll(() => rmSync(fake, { recursive: true, force: true }));

  const run = (main: string, control: string) => {
    const result = spawnSync("sh", [WRAPPER], { env: { ...process.env, PATH: `${fake}${delimiter}${process.env["PATH"] ?? ""}`, FAKE_MAIN: main, FAKE_CONTROL: control }, encoding: "utf8" });
    return { code: result.status, text: `${result.stdout}${result.stderr}` };
  };

  it("passes only when the isolated run is isolated and the control without the override is exposed", () => {
    const passed = run("isolated", "exposed");
    expect(passed.code, passed.text).toBe(0);
    expect(passed.text).toContain("probe: PASSED");
    expect(passed.text).toContain("control without the override: probe: exposed");
  });

  it("is not verified when the control sees no exposure: a probe that cannot fail proves nothing", () => {
    const blind = run("isolated", "isolated");
    expect(blind.code, blind.text).toBe(3);
    expect(blind.text).toContain("cannot detect exposure on this host");
  });

  it("fails when the isolated run is exposed, without a control", () => {
    const exposed = run("exposed", "exposed");
    expect(exposed.code, exposed.text).toBe(1);
    expect(exposed.text).not.toContain("2/2");
  });
});
