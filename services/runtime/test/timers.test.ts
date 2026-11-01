// Limits longer than a Node timer can hold (T3-014): Node fires such a timer at once, so a process or an agent job
// with a timeout of a month would stop as soon as it started.

import { describe, expect, it } from "vitest";
import { runProcess } from "../src/launcher/index.js";
import { MAX_TIMER_MS } from "../src/launcher/process.js";

describe("timeouts longer than a Node timer", () => {
  it("hold a process to the longest timer instead of stopping it at once", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.stdout.write('done'), 200)"],
      cwd: process.cwd(),
      env: { PATH: process.env["PATH"] ?? "" },
      timeoutMs: 3_000_000 * 1000,
    });
    expect(result.stopped).toBeUndefined();
    expect(result.stdout).toBe("done");
    expect(MAX_TIMER_MS).toBe(2 ** 31 - 1);
  });
});
