// The design stage end to end (ADR-0049): one set for a selection of units, a designer job per unit, the
// template's checks, one fix round, and one pull request that carries only the units' design documents. The agent is
// scripted (it writes the files a real designer would), the scripts are the real ones of the `design` plugin.

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { designReviewPath } from "@kintsugi/domain";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv, removeTree } from "@kintsugi/runtime/launcher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { designMessage } from "../src/jobs/plans/design.js";
import { DEFAULT_GATE_DECIDER } from "../src/jobs/model.js";
import { JobRunner } from "../src/jobs/runner.js";
import { stageInfo } from "../src/jobs/stages.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { catalogDocuments } from "./support/documents.js";
import { type AgentFiles, LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const FIXTURES = fileURLToPath(new URL("../../../packages/agents/builtin/plugins/modernize/scripts/tests/fixtures/design/", import.meta.url));
const fixture = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), "utf8");

const RULES = "# Rules\n\n### R-001: Total is computed\n**Priority:** P0\n\n### R-002: Rounding\n**Priority:** P1\n\n### R-003: Date format\n**Priority:** P2\n";
const FUNCTIONS_OK = '---\ntemplate: "basic@3"\n---\n# Run period: functions\n\n## Functions\n\n| ID | Function | Priority |\n| --- | --- | --- |\n| F-001 | Compute the total | high |\n| F-002 | Print the report | low |\n';
const OVERVIEW_OK = fixture("designs", "basic-overview-ok.md");
const OVERVIEW_TODO = fixture("designs", "basic-overview-todo.md");

/** A set of the application (ADR-0050): its set.md asks the designer to read the inputs folder, which no stage reads by itself. */
const ARCH_SET = Object.fromEntries(["set.md", "overview.md"].map((name) => [`01-standards/templates/arch/${name}`, readFileSync(join(FIXTURES, "app-sets", "arch", name), "utf8").replace('reads: ["10-applications/{app}/01-legacy/", "02-architecture/"]', 'reads: ["10-applications/{app}/00-inputs/"]')]));
const ARCH_OK = fixture("designs", "arch-ok.md");
const ARCH_BAD = fixture("designs", "arch-bad.md");
const ARCH_PATH = "10-applications/demo/02-modern/_design/arch/overview.md";
const APP_EXTRAS = {
  "10-applications/demo/02-modern/requirements.md": "## REQ-01: Pay\n",
  "02-architecture/common/COM-LOG-01.md": "# Logging\n",
  "02-architecture/common/COM-AUTH-01.md": "# Authentication\n",
  "10-applications/demo/00-inputs/notes.md": "# Notes from the customer\n",
};

const UNITS = ["payroll/run-period", "payroll/close-period"];
const unitFiles = (key: string): Record<string, string> => {
  const [module = "", unit = ""] = key.split("/");
  return {
    [`10-applications/demo/02-modern/${key}/README.md`]: `---\nid: "demo/${key}"\nkind: "screen"\ntitle: "${unit}"\n---\n`,
    [`10-applications/demo/01-legacy/${key}/rules.md`]: RULES,
    [`10-applications/demo/01-legacy/${key}/understanding.md`]: `---\napp: "demo"\nitem: "${module}/${unit}"\nstatus: "understood"\n---\n# ${key}\n`,
  };
};
const BASIC_SET = Object.fromEntries(["set.md", "overview.md", "functions.md"].map((name) => [`01-standards/templates/basic/${name}`, fixture("sets", "basic", name)]));
const BASE = {
  "kintsugi.yaml": "schemaVersion: 1\nunitKinds: [screen, api]\n",
  ...BASIC_SET,
  ...catalogDocuments("demo", [{ id: "payroll", name: "Payroll" }], UNITS.map((id) => ({ id, files: ["src/main.c"] }))),
  ...Object.assign({}, ...UNITS.map(unitFiles)),
};
const designPath = (key: string, file: string): string => `10-applications/demo/02-modern/${key}/basic/${file}`;
const written = (key: string): Record<string, string> => ({ [designPath(key, "overview.md")]: OVERVIEW_OK, [designPath(key, "functions.md")]: FUNCTIONS_OK });
/** The unit a designer job was started for: its task names it. */
const unitOf = (task: string): string => UNITS.find((key) => task.includes(`unit ${key} of application`)) ?? "";

describe("design stage (scripted designer, the plugin's scripts)", () => {
  const repos: Record<string, ReturnType<typeof fixtureRepository>> = {};
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    repos["legacy"] = fixtureRepository({ "src/main.c": "int main(void) { return 0; }\n" });
    repos["docs"] = fixtureRepository(BASE);
    // run-period already has its basic design: it is never generated again.
    repos["half-docs"] = fixtureRepository({ ...BASE, ...written("payroll/run-period") });
    repos["full-docs"] = fixtureRepository({ ...BASE, ...written("payroll/run-period"), ...written("payroll/close-period") });
    repos["app-docs"] = fixtureRepository({ ...BASE, ...ARCH_SET, ...APP_EXTRAS });
    repos["app-done-docs"] = fixtureRepository({ ...BASE, ...ARCH_SET, ...APP_EXTRAS, [ARCH_PATH]: ARCH_OK });
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-design-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    for (const repo of Object.values(repos)) await repo.remove();
    await removeTree(dataDir);
  });

  async function runDesign(options: { docs?: string; files: AgentFiles; units?: string[]; set?: string; regenerate?: boolean }) {
    const store = new MemoryJobStore();
    store.document = options.docs ?? "docs";
    const writes: DocumentWriteRequest[] = [];
    const agents = writingAgentRuntime(options.files);
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
      storage,
      checkouts: new LocalCheckouts(Object.fromEntries(Object.entries(repos).map(([id, repo]) => [id, repo.bare]))),
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      mockOutputs: false,
      requestWrite: async (_repository, request) => {
        writes.push(request);
      },
      log: () => undefined,
    });
    const id = randomUUID();
    await store.create({
      id,
      projectId: "demo",
      applicationId: "demo",
      kind: "stage",
      name: "design",
      sourceRepositoryId: "legacy",
      actor: "alice",
      inputs: { scope: { items: options.units ?? UNITS, files: [], set: options.set ?? "basic", ...(options.regenerate === true ? { regenerate: true } : {}) } },
    });
    const run = await runner.run(id);
    const summary = run?.outputSummary as { steps: Array<{ id: string; status: string; key?: string }> } | undefined;
    const logs = store.events.filter((event) => event.runId === id && event.kind === "log").map((event) => event.message);
    const artifacts = (store.artifacts.get(id) ?? []).map((entry) => entry.path).sort();
    const published = (path: string): string => readFileSync(join(storage.job(id).out, ...path.split("/")), "utf8");
    return { id, run, writes, agents, summary, logs, artifacts, published, steps: summary?.steps.map((step) => [step.id, step.status, step.key ?? null]) ?? [] };
  }

  it("is a runnable stage that needs the catalog", () => {
    expect(stageInfo("demo").find((stage) => stage.id === "design")).toEqual({ id: "design", requires: [{ stage: "assess", path: "10-applications/demo/01-legacy/_catalog/index.md" }] });
    expect(designMessage("demo", { items: UNITS, files: [], set: "basic" })).toBe("Design demo: basic of payroll (2 units)");
    expect(designMessage("demo", { items: ["a/x", "b/y", "b/z"], files: [], set: "detail" })).toBe("Design demo: detail of x, y +1");
    expect(designMessage("demo", { items: UNITS, files: [], set: "basic", regenerate: true })).toBe("Regenerate design demo: basic of payroll (2 units)");
  });

  it("regenerates a set the units already have: the designers run again and the new documents replace the old ones in the pull request", async () => {
    const REGENERATED = `${OVERVIEW_OK}\n`;
    const { run, agents, steps, published, writes } = await runDesign({
      docs: "full-docs",
      regenerate: true,
      files: { designer: (spec) => ({ ...written(unitOf(spec.task)), [designPath(unitOf(spec.task), "overview.md")]: REGENERATED }) },
    });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(steps.filter((step) => step[0] === "design-unit").map((step) => step[2]).sort()).toEqual(UNITS.slice().sort());
    const task = agents.specs.find((spec) => unitOf(spec.task) === "payroll/run-period")!.task;
    expect(task).toContain("This is a regeneration");
    expect(published(designPath("payroll/close-period", "overview.md"))).toBe(REGENERATED);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.message).toBe("Regenerate design demo: basic of payroll (2 units)");
  }, 120_000);

  it("does not mention a regeneration in the task of a first design", async () => {
    const { agents } = await runDesign({ files: { designer: (spec) => written(unitOf(spec.task)) } });
    expect(agents.specs.every((spec) => !spec.task.includes("This is a regeneration"))).toBe(true);
  }, 120_000);

  it("generates the set for each unit: one designer job per unit, the documents published, the skeletons and reports kept as scratch", async () => {
    const { run, agents, steps, artifacts, published, writes } = await runDesign({ files: { designer: (spec) => written(unitOf(spec.task)) } });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(steps.filter((step) => step[0] === "design-unit").map((step) => step[2]).sort()).toEqual(UNITS.slice().sort());
    expect(steps.map((step) => step[0])).toEqual(expect.arrayContaining(["scaffold", "check", "review-unit", "check-review", "fixes", "check-final", "summary"]));
    expect(steps.find((step) => step[0] === "fixes")?.[1]).toBe("skipped");
    expect(agents.specs.filter((spec) => spec.agent.id === "designer")).toHaveLength(2);

    const task = agents.specs.find((spec) => unitOf(spec.task) === "payroll/run-period")!.task;
    expect(task).toContain('design documents of the set "basic" for unit payroll/run-period of application demo');
    expect(task).toContain("01-standards/templates/basic/set.md");
    expect(task).toContain("10-applications/demo/02-modern/payroll/run-period/basic/");
    expect(task).toContain("scratch/demo/design/manifest.json");

    // Only the documents are published, nothing of the scaffold or the checks.
    expect(artifacts).toEqual(UNITS.flatMap((key) => ["functions.md", "overview.md"].map((file) => designPath(key, file))).sort());
    expect(published(designPath("payroll/close-period", "overview.md"))).toBe(OVERVIEW_OK);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.message).toBe("Design demo: basic of payroll (2 units)");
  }, 120_000);

  it("sends a unit the check flagged back once, with the problems, and publishes what it fixed", async () => {
    let calls = 0;
    const { run, agents, steps, published, logs } = await runDesign({
      files: {
        designer: (spec) => {
          const key = unitOf(spec.task);
          if (spec.task.startsWith("Fix the design documents")) return written(key);
          calls += 1;
          // The first generation of close-period leaves a TODO behind.
          return key === "payroll/close-period" ? { ...written(key), [designPath(key, "overview.md")]: OVERVIEW_TODO } : written(key);
        },
      },
    });
    expect(run?.status).toBe("succeeded");
    expect(calls).toBe(2);
    expect(steps.filter((step) => step[0] === "fix-unit")).toEqual([["fix-unit", "succeeded", "payroll/close-period"]]);
    expect(agents.specs.filter((spec) => spec.agent.id === "designer")).toHaveLength(3);
    const fix = agents.specs.find((spec) => spec.task.startsWith("Fix the design documents"))!;
    expect(fix.task).toContain("entry of demo/payroll/close-period");
    expect(fix.task).toContain("scratch/demo/design/report.json");
    expect(published(designPath("payroll/close-period", "overview.md"))).toBe(OVERVIEW_OK);
    expect(logs.some((line) => line.includes("step fixes: 1 job(s)"))).toBe(true);
  }, 120_000);

  describe("the independent review (ADR-0054)", () => {
    const NOTE_HEAD = (key: string): string => `---\nunit: "${key}"\n---\n# Review of ${key}\n\n| Severity | Document | Section | Category | Finding | Suggestion |\n| --- | --- | --- | --- | --- | --- |\n`;
    const note = (key: string, rows: string[] = []): Record<string, string> => ({ [designReviewPath("demo", key)]: NOTE_HEAD(key) + rows.map((row) => `${row}\n`).join("") });

    it("has a reviewer read each unit, sends blockers to the fix round with the findings, and describes the pull request with the review", async () => {
      const { run, agents, steps, artifacts, writes } = await runDesign({
        files: {
          designer: (spec) => written(unitOf(spec.task)),
          "design-reviewer": (spec) => {
            const key = unitOf(spec.task);
            return key === "payroll/close-period"
              ? note(key, ["| blocker | overview.md | Rule coverage | fidelity | RULE-004 is in the specification but no row applies it. | Add a row with the fee formula. |", "| minor | functions.md | Functions | clarity | Say which currency. | Name it. |"])
              : note(key);
          },
        },
      });
      expect(run?.status).toBe("succeeded");
      expect(steps.filter((step) => step[0] === "review-unit").map((step) => step[2]).sort()).toEqual(UNITS.slice().sort());
      expect(steps.find((step) => step[0] === "check-review")?.[1]).toBe("succeeded");
      // The check passes for both units; only the blocker of the review sends close-period to the fix round.
      expect(steps.filter((step) => step[0] === "fix-unit")).toEqual([["fix-unit", "succeeded", "payroll/close-period"]]);
      const review = agents.specs.find((spec) => spec.agent.id === "design-reviewer" && unitOf(spec.task) === "payroll/close-period")!;
      expect(review.task).toContain("You did not write them");
      expect(review.task).toContain("scratch/demo/design/review/payroll/close-period.md");
      expect(review.task).toContain("scratch/demo/design/report.json");
      const fix = agents.specs.find((spec) => spec.task.startsWith("Fix the design documents"))!;
      expect(fix.task).toContain("scratch/demo/design/review-report.json");

      // The notes are scratch; only the documents are published.
      expect(artifacts).toEqual(UNITS.flatMap((key) => ["functions.md", "overview.md"].map((file) => designPath(key, file))).sort());

      const description = writes[0]?.description ?? "";
      expect(description).toContain("2 unit(s): 1 ready, 1 ready with findings, 0 incomplete.");
      expect(description).toContain("| payroll/run-period | screen | ready | 0 | 0 | 0 |");
      expect(description).toContain("| payroll/close-period | screen | ready-with-findings | 1 | 0 | 1 |");
      expect(description).toContain("RULE-004 is in the specification but no row applies it.");
    }, 180_000);

    it("counts a unit whose note does not parse as not reviewed, and does not fix it for that", async () => {
      const { run, steps, writes } = await runDesign({
        files: {
          designer: (spec) => written(unitOf(spec.task)),
          "design-reviewer": (spec) => ({ [designReviewPath("demo", unitOf(spec.task))]: "I looked and it is fine.\n" }),
        },
      });
      expect(run?.status).toBe("succeeded");
      expect(steps.find((step) => step[0] === "fixes")?.[1]).toBe("skipped");
      const description = writes[0]?.description ?? "";
      expect(description).toContain("0 ready, 0 ready with findings, 2 incomplete.");
      expect(description).toContain("Not reviewed: no findings table");
    }, 180_000);
  });

  it("carries a unit that is still wrong after the fix round in the pull request instead of failing the run", async () => {
    const { run, steps, published } = await runDesign({
      files: { designer: (spec) => (unitOf(spec.task) === "payroll/close-period" ? { ...written("payroll/close-period"), [designPath("payroll/close-period", "overview.md")]: OVERVIEW_TODO } : written("payroll/run-period")) },
    });
    expect(run?.status).toBe("succeeded");
    expect(steps.filter((step) => step[0] === "fix-unit")).toHaveLength(1);
    expect(published(designPath("payroll/close-period", "overview.md"))).toBe(OVERVIEW_TODO);
  }, 120_000);

  it("never writes a set a unit already has: only the other unit gets a designer job", async () => {
    const { run, agents, artifacts } = await runDesign({ docs: "half-docs", files: { designer: (spec) => written(unitOf(spec.task)) } });
    expect(run?.status).toBe("succeeded");
    expect(agents.specs.filter((spec) => spec.agent.id === "designer").map((spec) => unitOf(spec.task))).toEqual(["payroll/close-period"]);
    expect(artifacts.every((path) => path.includes("close-period"))).toBe(true);
  }, 120_000);

  it("fails with a clear reason when every selected unit has the set already", async () => {
    const { run, agents } = await runDesign({ docs: "full-docs", files: { designer: (spec) => written(unitOf(spec.task)) } });
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toContain("nothing to generate");
    expect(agents.specs).toHaveLength(0);
  }, 120_000);

  it("fails before any agent runs when the set is unknown", async () => {
    const { run, agents } = await runDesign({ set: "nosuch", files: {} });
    expect(run?.status).toBe("failed");
    expect(agents.specs).toHaveLength(0);
  }, 120_000);

  describe("a set of the application (scope: application)", () => {
    /** Reads what the designer was given from the job's read-only directories. */
    const seen = (spec: { workspace: { readOnly: string[] } }, path: string): boolean => spec.workspace.readOnly.some((dir) => existsSync(join(dir, ...path.split("/"))));

    it("generates the set for the application as one pseudo-unit, with the documents its set.md asks for, and publishes only its folder", async () => {
      const { run, agents, steps, artifacts, published, writes } = await runDesign({
        docs: "app-docs",
        units: ["@app"],
        set: "arch",
        files: { designer: (spec) => ({ [ARCH_PATH]: seen(spec, "10-applications/demo/00-inputs/notes.md") ? ARCH_OK : ARCH_BAD }) },
      });
      expect(run?.failureReason).toBeUndefined();
      expect(run?.status).toBe("succeeded");
      expect(steps.filter((step) => step[0] === "design-unit")).toEqual([["design-unit", "succeeded", "@app"]]);
      expect(steps.find((step) => step[0] === "fixes")?.[1]).toBe("skipped");
      const task = agents.specs.find((spec) => spec.agent.id === "designer")!.task;
      expect(task).toContain('design documents of the set "arch" for application demo as a whole');
      expect(task).toContain("10-applications/demo/02-modern/_design/arch/");
      expect(task).toContain("01-standards/templates/arch/set.md");
      expect(task).not.toContain("/spec.md");
      // Its reads were given to the job, so the notes were there and the good design was written.
      expect(artifacts).toEqual([ARCH_PATH]);
      expect(published(ARCH_PATH)).toBe(ARCH_OK);
      expect(writes[0]?.message).toBe("Design demo: arch of the application");
    }, 120_000);

    it("sends the application design back once when the check flags it", async () => {
      let calls = 0;
      const { run, agents, steps, published } = await runDesign({
        docs: "app-docs",
        units: ["@app"],
        set: "arch",
        files: {
          designer: (spec) => {
            calls += 1;
            return { [ARCH_PATH]: spec.task.startsWith("Fix the design documents") ? ARCH_OK : ARCH_BAD };
          },
        },
      });
      expect(run?.status).toBe("succeeded");
      expect(calls).toBe(2);
      expect(steps.filter((step) => step[0] === "fix-unit")).toEqual([["fix-unit", "succeeded", "@app"]]);
      expect(agents.specs.find((spec) => spec.task.startsWith("Fix the design documents"))!.task).toContain("application demo");
      expect(published(ARCH_PATH)).toBe(ARCH_OK);
    }, 120_000);

    it("does not write the application design again, and a unit set cannot be generated for the application", async () => {
      const done = await runDesign({ docs: "app-done-docs", units: ["@app"], set: "arch", files: { designer: () => ({ [ARCH_PATH]: ARCH_OK }) } });
      expect(done.run?.status).toBe("failed");
      expect(done.run?.failureReason).toContain("nothing to generate");
      expect(done.agents.specs).toHaveLength(0);
      const wrong = await runDesign({ docs: "app-docs", units: ["@app"], set: "basic", files: {} });
      expect(wrong.run?.status).toBe("failed");
      expect(wrong.agents.specs).toHaveLength(0);
    }, 120_000);
  });
});
