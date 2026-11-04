import { describe, expect, it, vi } from "vitest";
import { DefaultBranchObservers } from "../../src/modules/admin/git/application/default-branch-observers.js";

const actor = { id: "u1", permissions: [] };

describe("DefaultBranchObservers", () => {
  it("tells every observer, in order, what changed and who changed it", async () => {
    const observers = new DefaultBranchObservers();
    const seen: string[] = [];
    observers.register(async (change) => void seen.push(`a:${change.repositoryId}:${change.branch}`));
    observers.register(async (_change, who) => void seen.push(`b:${who.id}`));
    await observers.notify({ repositoryId: "docs", branch: "release" }, actor);
    expect(seen).toEqual(["a:docs:release", "b:u1"]);
  });

  it("goes on after an observer fails, and never fails the change", async () => {
    const observers = new DefaultBranchObservers();
    const after = vi.fn(async () => undefined);
    observers.register(async () => Promise.reject(new Error("boom")));
    observers.register(after);
    await expect(observers.notify({ repositoryId: "docs", branch: "release" }, actor)).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
