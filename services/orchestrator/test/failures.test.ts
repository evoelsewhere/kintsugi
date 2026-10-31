// Failures in plain words, and the provider failures an agent step gets one more try for.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explainFailure, isTransientFailure } from "../src/failures.js";
import { StagePlanExecutor, type LeafResult } from "../src/jobs/executor.js";
import { DEFAULT_GATE_DECIDER } from "../src/jobs/model.js";
import type { StagePlan } from "../src/jobs/plan.js";

const BYTE_STRING = "Agent legacy-analyst failed (error): Cannot convert argument to a ByteString because the character at index 103 has a value of 8217 which is greater than 255.";
const EMPTY_REPOSITORY = "git rev-parse --verify --end-of-options HEAD^{commit} failed (exit 128): fatal: Needed a single revision";

describe("known failures", () => {
  it("says a header character the request cannot carry plainly, and keeps the original as the detail", () => {
    const text = explainFailure(BYTE_STRING);
    expect(text).toMatch(/^The model connection has a character that cannot be sent in a request header/);
    expect(text).toContain(` Detail: ${BYTE_STRING}`);
  });

  it("says that a repository without commits has none", () => {
    expect(explainFailure(EMPTY_REPOSITORY)).toBe(`The repository has no commits yet. Push a first commit to its default branch, then sync it again. Detail: ${EMPTY_REPOSITORY}`);
  });

  it("explains a failure once, also when a stage repeats the reason of its step", () => {
    const step = explainFailure(BYTE_STRING);
    expect(explainFailure(step)).toBe(step);
    const stage = explainFailure(`Step synthesis failed: ${step}`);
    expect(stage).toBe(`Step synthesis failed: ${step}`);
  });

  it("leaves any other text as it is", () => {
    expect(explainFailure("Agent x failed (timeout): stalled for 600 s")).toBe("Agent x failed (timeout): stalled for 600 s");
  });
});

describe("transient provider failures", () => {
  it("are a dropped or refused connection, a rate limit, an overload or a server error", () => {
    for (const reason of [
      "Agent legacy-analyst failed (error): Connection error.",
      "Agent x failed (error): read ECONNRESET",
      "Agent x failed (error): 429 Too Many Requests",
      "Agent x failed (error): 503 Service Unavailable",
      "Agent x failed (error): the model is overloaded",
    ]) {
      expect(isTransientFailure(reason), reason).toBe(true);
    }
  });

  it("are not a limit the job hit or a known failure of the settings", () => {
    expect(isTransientFailure("Agent x failed (turns): the job reached its turn limit")).toBe(false);
    expect(isTransientFailure(explainFailure(BYTE_STRING))).toBe(false);
    expect(isTransientFailure(BYTE_STRING)).toBe(false);
  });

  it("give an agent step one more try before the stage fails, and the run's log says so", async () => {
    const root = await mkdtemp(join(tmpdir(), "transient-"));
    try {
      const dirs = { root, in: join(root, "in"), work: join(root, "work"), out: join(root, "out") };
      for (const dir of [dirs.in, dirs.work, dirs.out]) await mkdir(dir, { recursive: true });
      const plan: StagePlan = { id: "demo", message: () => "demo", steps: [{ id: "one", kind: "agent", agent: "legacy-analyst", task: "do one" }] };
      const run = async (reasons: string[]): Promise<{ tries: number; logs: string[]; error?: string }> => {
        let tries = 0;
        const logs: string[] = [];
        const executor = new StagePlanExecutor({
          plan,
          run: { id: "r", projectId: "p" },
          values: { app: "demo", sources: `legacy@${"a".repeat(40)}` },
          dirs,
          limits: { concurrency: 1 },
          gates: DEFAULT_GATE_DECIDER,
          runLeaf: async (): Promise<LeafResult> => {
            const reason = reasons[tries];
            tries += 1;
            return reason === undefined ? { id: "x", ok: true, summary: {}, agents: 1 } : { id: "x", ok: false, reason };
          },
          log: async (line) => {
            logs.push(line);
          },
        });
        try {
          await executor.run();
          return { tries, logs };
        } catch (error) {
          return { tries, logs, error: error instanceof Error ? error.message : String(error) };
        }
      };
      const dropped = await run(["Agent legacy-analyst failed (error): Connection error."]);
      expect(dropped.error).toBeUndefined();
      expect(dropped.tries).toBe(2);
      expect(dropped.logs.some((line) => line.includes("Connection error.") && line.includes("trying once more"))).toBe(true);
      // A failure of the settings is not tried again.
      expect(await run([explainFailure(BYTE_STRING)])).toMatchObject({ tries: 1, error: expect.stringContaining("The model connection has a character") });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
