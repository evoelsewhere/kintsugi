// Mirror operations on one repository run one at a time (the git-sync queue, job checkouts and
// the document writer share mirrors); different repositories still run in parallel.

import { describe, expect, it } from "vitest";
import { withMirrorLock } from "../src/git-sync/sync.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("withMirrorLock", () => {
  it("serializes operations on the same repository, even after a failure", async () => {
    const order: string[] = [];
    const run = (name: string, fail = false) =>
      withMirrorLock("repo-a", async () => {
        order.push(`${name}:start`);
        await tick();
        order.push(`${name}:end`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([run("one", true), run("two"), run("three")]);
    expect(order).toEqual(["one:start", "one:end", "two:start", "two:end", "three:start", "three:end"]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  });

  it("lets different repositories run at the same time", async () => {
    const order: string[] = [];
    const run = (repository: string) =>
      withMirrorLock(repository, async () => {
        order.push(`${repository}:start`);
        await tick();
        order.push(`${repository}:end`);
      });
    await Promise.all([run("repo-b"), run("repo-c")]);
    expect(order.slice(0, 2)).toEqual(["repo-b:start", "repo-c:start"]);
  });
});
