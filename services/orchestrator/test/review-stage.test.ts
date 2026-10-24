// The review stage end to end (ADR-0071): a member built a unit in their own repository and recorded the merge request; the
// runtime reads the target repository at the head commit of that merge request (mounted read-only), a scripted reviewer writes
// its findings, and only documents come out: the runtime writes no code. The scripts are the real ones of the `modernize` plugin.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CheckoutStorage } from "@kintsugi/git";
import { interpretersFromEnv } from "@kintsugi/runtime/launcher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinAgents } from "../src/jobs/agents.js";
import { DEFAULT_GATE_DECIDER } from "../src/jobs/model.js";
import type { StageContext } from "../src/jobs/plan.js";
import { mergeRequestOf, reviewMessage } from "../src/jobs/plans/review.js";
import { JobRunner } from "../src/jobs/runner.js";
import { stageInfo } from "../src/jobs/stages.js";
import type { DocumentWriteRequest } from "../src/queues.js";
import { catalogDocuments } from "./support/documents.js";
import { type AgentFiles, LocalCheckouts, MemoryJobStore, fixtureRepository, writingAgentRuntime } from "./support/jobs.js";

const KEY = "pay/run";
const RULES = "# Rules\n\n| ID | Name | Status |\n| --- | --- | --- |\n| RULE-001 | Total is computed | active |\n| RULE-002 | Total is rounded to cents | active |\n";
const CALC = "# RULE-001: the total is price times quantity\ndef total(price, quantity):\n    # RULE-002: rounded to two decimals\n    return round(price * quantity, 2)\n";
const TEST_CALC = "import calc\n\n\ndef test_rule001_total():  # RULE-001\n    assert calc.total(2, 3) == 6\n";
const HEAD = "| Severity | File | Where | Category | Finding | Suggestion |\n| --- | --- | --- | --- | --- | --- |\n";
const BUILD = `10-applications/demo/02-modern/${KEY}/_build`;
const MR_URL = "https://git.example/org/api/pull/7";

const BASE: Record<string, string> = {
  "kintsugi.yaml": "schemaVersion: 1\nunitKinds: [api]\n",
  ...catalogDocuments("demo", [{ id: "pay", name: "Pay" }], [{ id: KEY, files: ["src/main.c"] }]),
  [`10-applications/demo/02-modern/${KEY}/README.md`]: `---\nid: "demo/${KEY}"\nkind: "api"\ntitle: "run"\n---\n`,
  [`10-applications/demo/01-legacy/${KEY}/rules.md`]: RULES,
  [`10-applications/demo/01-legacy/${KEY}/understanding.md`]: `---\napp: "demo"\nitem: "${KEY}"\nstatus: "understood"\n---\n# ${KEY}\n`,
  [`10-applications/demo/02-modern/${KEY}/detail/logic.md`]: "# Logic\n\nThe total is price times quantity, rounded to cents.\n",
};

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });

/** A target repository: `main` has a README, the branch `feature` (the member's merge request) adds the unit's code and test. */
function targetRepository(): { bare: string; head: string; remove(): Promise<void> } {
  const root = mkdtempSync(join(tmpdir(), "kintsugi-target-repo-"));
  const work = join(root, "work");
  mkdirSync(work);
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  };
  git(work, "init", "-q", "-b", "main");
  put("README.md", "# api\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "base");
  git(work, "checkout", "-q", "-b", "feature");
  put("src/calc.py", CALC);
  put("tests/test_calc.py", TEST_CALC);
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "pay/run");
  const head = git(work, "rev-parse", "HEAD").trim();
  git(work, "checkout", "-q", "main");
  const bare = join(root, "repo.git");
  git(root, "clone", "-q", "--bare", work, bare);
  git(bare, "fetch", "-q", work, "feature:feature");
  return { bare, head, remove: () => rm(root, { recursive: true, force: true }) };
}

describe("review stage (scripted reviewer, the plugin's scripts, a member's merge request)", () => {
  const repos: Record<string, ReturnType<typeof fixtureRepository>> = {};
  let target: ReturnType<typeof targetRepository>;
  let dataDir: string;
  let storage: CheckoutStorage;

  beforeAll(async () => {
    repos["legacy"] = fixtureRepository({ "src/main.c": "int main(void) { return 0; }\n" });
    repos["docs"] = fixtureRepository(BASE);
    target = targetRepository();
    dataDir = mkdtempSync(join(tmpdir(), "kintsugi-review-data-"));
    storage = new CheckoutStorage(dataDir);
    await storage.prepare();
  });
  afterAll(async () => {
    for (const repo of Object.values(repos)) await repo.remove();
    await target.remove();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function runReview(options: { files: AgentFiles; scope?: Record<string, unknown>; noMr?: boolean }) {
    const store = new MemoryJobStore();
    store.document = "docs";
    const agents = writingAgentRuntime(options.files);
    const writes: DocumentWriteRequest[] = [];
    const runner = new JobRunner({
      store,
      gates: DEFAULT_GATE_DECIDER,
      storage,
      checkouts: new LocalCheckouts({ legacy: repos["legacy"]!.bare, docs: repos["docs"]!.bare, api: target.bare }),
      agents,
      agentDefinitions: builtinAgents(),
      interpreters: interpretersFromEnv(),
      mockOutputs: false,
      requestWrite: async (_queue, request) => {
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
      name: "review",
      sourceRepositoryId: "legacy",
      sources: [
        { repositoryId: "legacy", role: "legacy" },
        { repositoryId: "api", role: "target", commit: target.head },
      ],
      actor: "alice",
      inputs: { scope: { items: [KEY], files: [], target: "api", ...(options.noMr === true ? {} : { mr: { url: MR_URL, commit: target.head, branch: "feature" } }), ...options.scope } },
    });
    const run = await runner.run(id);
    const summary = run?.outputSummary as { steps: Array<{ id: string; status: string; key?: string }> } | undefined;
    const published = (path: string): string => readFileSync(join(storage.job(id).out, ...path.split("/")), "utf8");
    const artifacts = (store.artifacts.get(id) ?? []).map((entry) => entry.path).sort();
    return { id, run, agents, writes, artifacts, published, steps: summary?.steps.map((step) => [step.id, step.status]) ?? [] };
  }

  const note = (rows: string[] = []): string => `---\nunit: "${KEY}"\n---\n# Review\n\n${HEAD}${rows.map((row) => `${row}\n`).join("")}`;
  const reviewer = (text: string): AgentFiles => ({ "code-reviewer": () => ({ [`scratch/demo/build/review/${KEY}.md`]: text }) });

  it("is a runnable stage that needs the design, and names the units of the merge request", () => {
    expect(stageInfo("demo").find((stage) => stage.id === "review")).toEqual({ id: "review", requires: [{ stage: "design", path: "10-applications/demo/01-legacy/_catalog/index.md" }] });
    expect(reviewMessage("demo", { items: ["pay/run", "pay/close"], files: [] })).toBe("Review demo: pay (2 units)");
    expect(reviewMessage("demo", { items: ["a/x", "b/y", "b/z"], files: [] })).toBe("Review demo: x, y +1");
    const context = (scope: object): StageContext => ({ scope: { items: [KEY], files: [], ...scope } }) as unknown as StageContext;
    expect(mergeRequestOf(context({ target: "api", mr: { url: MR_URL, commit: target.head, branch: "feature" } }))).toEqual({ target: "api", url: MR_URL, commit: target.head, branch: "feature" });
    expect(() => mergeRequestOf(context({ target: "api" }))).toThrow("merge request");
    expect(() => mergeRequestOf(context({ mr: { url: MR_URL, commit: target.head } }))).toThrow("target repository");
  });

  it("reads the code at the head commit of the merge request and publishes the findings as documents only", async () => {
    const { run, steps, agents, writes, artifacts, published } = await runReview({
      files: reviewer(note(["| blocker | `src/calc.py` | total | fidelity | Rounds half even. | Round half up. |", "| minor | `tests/test_calc.py` | test_rule001_total | tests | One case. | Add the boundary. |"])),
    });
    expect(run?.failureReason).toBeUndefined();
    expect(run?.status).toBe("succeeded");
    expect(steps.map((step) => step[0])).toEqual(["prepare", "changes", "review-unit", "check", "summary"]);

    // The reviewer reads the repository at the merge request, which the main branch does not have.
    const spec = agents.specs[0]!;
    expect(spec.task).toContain(`Review unit ${KEY} of application demo: its code and its tests in the merge request ${MR_URL}`);
    expect(spec.task).toContain("scratch/demo/build/changes.json");
    expect(spec.workspace.readOnly.some((path) => path.endsWith("to-be"))).toBe(true);
    // The files the merge request changes against main are counted in the description of the pull request.
    expect(writes[0]?.description).toContain("2 file(s) changed by the merge request");

    // One write, to the document repository: the review of the unit. The runtime wrote no code and no note outside _build.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ message: "Review demo: pay (1 unit)", reviewAll: true });
    expect(writes[0]?.description).toContain(MR_URL);
    expect(artifacts).toEqual([`${BUILD}/review.md`]);
    const document = published(`${BUILD}/review.md`);
    expect(document).toContain('reviewed: "true"');
    expect(document).toContain("blockers: 1");
    expect(document).toContain(`mr: "${MR_URL}"`);
    expect(document).toContain("| blocker | src/calc.py | total | fidelity | Rounds half even. | Round half up. |");
  }, 180_000);

  it("never shows a unit as clean when the reviewer wrote no readable note", async () => {
    const { run, published } = await runReview({ files: {} });
    expect(run?.status).toBe("succeeded");
    expect(published(`${BUILD}/review.md`)).toContain('reviewed: "false"');
    expect(published(`${BUILD}/review.md`)).toContain("Not reviewed");
  }, 180_000);

  it("leaves out a unit that cannot be reviewed, and fails with the reason when none can", async () => {
    const { run } = await runReview({ files: {}, scope: { items: ["pay/missing"] } });
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toContain("nothing to review");
  }, 120_000);

  it("fails with a clear reason when the run names no merge request", async () => {
    const { run } = await runReview({ files: {}, noMr: true });
    expect(run?.status).toBe("failed");
    expect(run?.failureReason).toContain("merge request");
  }, 120_000);
});
