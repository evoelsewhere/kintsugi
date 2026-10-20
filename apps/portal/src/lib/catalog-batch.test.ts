import { describe, expect, it } from "vitest";
import type { CatalogItem } from "./api/catalog";
import type { JobRunView } from "./api/job-runs";
import { assetClassOf, estimateRun, formatEstimate, recommendBatch } from "./catalog-batch";

const item = (id: string, over: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id, module: id.split("/")[0], kind: "module", name: id, summary: "", files: [`src/main/${id}.java`], leaves: [], entryPoints: [], loc: 100, complexity: "medium", digest: "", status: "not-analysed", aliases: [], parts: [], ...over }) as CatalogItem;

const run = (over: Partial<JobRunView>): JobRunView => ({ id: "r", status: "succeeded", startedAt: "2026-10-20T10:00:00Z", finishedAt: "2026-10-20T10:10:00Z", scope: { items: ["a/x", "a/y"] }, ...over }) as JobRunView;

describe("assetClassOf", () => {
  it("prefers the server's class, else derives it from the files", () => {
    expect(assetClassOf({ files: ["src/test/FooTest.java"] })).toBe("test");
    expect(assetClassOf({ files: ["src/test/FooTest.java"], assetClass: "code" })).toBe("code");
  });
});

describe("recommendBatch", () => {
  it("takes the most complex then largest open code items, skipping tests, understood and blocked ones", () => {
    const batch = recommendBatch([
      item("m/small-high", { complexity: "high", loc: 50 }),
      item("m/big-high", { complexity: "high", loc: 900 }),
      item("m/medium", { complexity: "medium", loc: 2000 }),
      item("m/test", { complexity: "high", loc: 9000, files: ["src/test/AllTests.java"] }),
      item("m/done", { complexity: "high", loc: 9000, status: "understood" }),
      item("m/in-pr", { complexity: "high", loc: 9000, status: "in-pr" }),
      item("m/running", { complexity: "high", loc: 9000, status: "running" }),
    ]);
    expect(batch.ids).toEqual(["m/big-high", "m/small-high", "m/medium"]);
    expect(batch.high).toBe(2);
    expect(batch.loc).toBe(2950);
    expect(batch.budgetHit).toBe(false);
  });

  it("stops at the item cap and the lines budget but always takes the first item", () => {
    const many = Array.from({ length: 10 }, (_, index) => item(`m/u${index}`, { loc: 100 }));
    expect(recommendBatch(many).ids).toHaveLength(5);
    const huge = recommendBatch([item("m/a", { complexity: "high", loc: 20000 }), item("m/b", { complexity: "high", loc: 10 })], { maxLoc: 8000 });
    expect(huge.ids).toEqual(["m/a"]);
    expect(huge.budgetHit).toBe(true);
    // A small item after the one that did not fit is not used to fill the budget.
    const ordered = recommendBatch([item("m/a", { complexity: "high", loc: 5000 }), item("m/b", { complexity: "high", loc: 4000 }), item("m/c", { complexity: "low", loc: 10 })], { maxLoc: 8000 });
    expect(ordered.ids).toEqual(["m/a"]);
  });

  it("is empty when nothing is left to understand", () => {
    expect(recommendBatch([item("m/a", { status: "understood" })]).ids).toEqual([]);
  });
});

describe("estimateRun", () => {
  it("uses the median run time per item of the successful runs", () => {
    // 10 min for 2 items = 5 min each; 30 min for 3 items = 10 min each; the median of two is 7.5 min.
    const estimate = estimateRun(4, [run({}), run({ finishedAt: "2026-10-20T10:30:00Z", scope: { items: ["a", "b", "c"] } }), run({ status: "failed" })]);
    expect(estimate).toEqual({ perItemMs: 7.5 * 60000, totalMs: 30 * 60000, basis: 2 });
  });

  it("is undefined without history or items", () => {
    expect(estimateRun(3, [run({ status: "cancelled" })])).toBeUndefined();
    expect(estimateRun(0, [run({})])).toBeUndefined();
  });
});

describe("formatEstimate", () => {
  it("reads seconds, minutes and hours", () => {
    expect(formatEstimate(20_000)).toBe("20 s");
    expect(formatEstimate(12 * 60000)).toBe("12 min");
    expect(formatEstimate(80 * 60000)).toBe("1 h 20 min");
    expect(formatEstimate(120 * 60000)).toBe("2 h");
  });
});
