import { describe, expect, it } from "vitest";
import type { BuildOverview, BuildUnit, MergeRequest } from "./api/build";
import { cliCommands, memberLine, reviewable, reviewableUnits, reviewBlocker, reviewLine, unitBlocker } from "./build";

const C1 = "1".repeat(40);
const unit = (patch: Partial<BuildUnit> = {}): BuildUnit => ({ key: "billing/tax", module: "billing", unit: "tax", kind: "screen", designed: true, rules: 3, review: { state: "none" }, ...patch });
const withMr = (patch: Partial<BuildUnit> = {}): BuildUnit => unit({ member: { mr: "https://git.example/pull/1", commit: C1, at: "2026-10-23T10:00:00Z" }, ...patch });

describe("which units can be reviewed", () => {
  it("needs a design and a merge request the member recorded, and no review in flight", () => {
    expect(reviewable(withMr())).toBe(true);
    expect(reviewable(unit())).toBe(false);
    expect(reviewable(withMr({ designed: false }))).toBe(false);
    expect(reviewable(withMr({ review: { state: "running" } }))).toBe(false);
    expect(reviewable(withMr({ review: { state: "in-pr" } }))).toBe(false);
    // A reviewed unit can be reviewed again (the member fixed it).
    expect(reviewable(withMr({ review: { state: "reviewed", blockers: 1 } }))).toBe(true);
  });

  it("says why a unit cannot", () => {
    expect(unitBlocker(withMr())).toBeUndefined();
    expect(unitBlocker(unit({ designed: false }))).toContain("no merged design");
    expect(unitBlocker(unit())).toContain("member command build");
    expect(unitBlocker(withMr({ review: { state: "running" } }))).toContain("running");
    expect(unitBlocker(withMr({ review: { state: "in-pr" } }))).toContain("pull request");
  });

  it("takes from a merge request only the units that can be reviewed now", () => {
    const request: MergeRequest = { url: "https://git.example/pull/1", commit: C1, units: ["billing/tax", "billing/ledger", "billing/gone"], reviewed: false };
    const units = [withMr(), withMr({ key: "billing/ledger", review: { state: "running" } })];
    expect(reviewableUnits(request, units)).toEqual(["billing/tax"]);
  });

  it("needs a target repository the merge request is on", () => {
    const overview = (targets: BuildOverview["targets"]): BuildOverview => ({ ref: { ref: "refs/heads/main", commit: C1 }, targets, units: [], mergeRequests: [] });
    expect(reviewBlocker(overview([]), undefined)).toContain("Link a target repository");
    expect(reviewBlocker(overview([{ repositoryId: "a" }, { repositoryId: "b" }]), undefined)).toContain("Choose the target");
    expect(reviewBlocker(overview([{ repositoryId: "a" }]), { repositoryId: "a" })).toBeUndefined();
  });
});

describe("the words for a record and a review", () => {
  it("reads the member's numbers and the review's findings", () => {
    expect(memberLine(unit())).toBeUndefined();
    expect(memberLine(withMr({ member: { at: "x", mr: "https://git.example/pull/1", commit: C1, cases: 12, failed: 1, canary: "killed" } }))).toBe("12 cases, 1 failed · canary killed");
    expect(memberLine(withMr({ member: { at: "x", cases: 1 } }))).toBe("1 case");
    expect(reviewLine(unit())).toBe("not reviewed");
    expect(reviewLine(unit({ review: { state: "running" } }))).toBe("reviewing");
    expect(reviewLine(unit({ review: { state: "reviewed", blockers: 0, majors: 0, minors: 3 } }))).toBe("no blocker or major");
    expect(reviewLine(unit({ review: { state: "reviewed", blockers: 1, majors: 2 } }))).toBe("1 blocker, 2 majors");
    expect(reviewLine(unit({ review: { state: "reviewed", blockers: 0, majors: 0, stale: true } }))).toBe("no blocker or major (out of date)");
  });
});

describe("the commands of a member", () => {
  it("install, connect, add the plugin, then run the command with the unit and the project", () => {
    const steps = cliCommands({ url: "https://kintsugi.example", projectId: "shop", unit: "billing/tax" });
    expect(steps.map((step) => step.code)).toEqual(["curl -fsSL https://kintsugi.example/api/v1/releases/latest/install.sh | sh", "kintsugi connect claude shop", "kintsugi add modernize", "/kintsugi:build billing/tax shop"]);
    expect(cliCommands({ url: "https://k", projectId: "shop", unit: "a/b", client: "codex" })[1]?.code).toBe("kintsugi connect codex shop");
  });
});
