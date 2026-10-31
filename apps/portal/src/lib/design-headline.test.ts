import { describe, expect, it } from "vitest";
import type { UnitDesignRow, UnitSetSummary } from "./api/design";
import { attentionShort, designHeadline } from "./design-headline";

const summary = (state: UnitSetSummary["state"]): UnitSetSummary => ({ set: "x", version: 1, state, files: { total: 1, conformant: 0, problems: 0, missing: 0, stale: 0, waived: 0 }, ready: false });
const unit = (key: string, kind: string, sets: Record<string, UnitSetSummary["state"]>): UnitDesignRow => ({
  key,
  module: key.split("/")[0]!,
  unit: key.split("/")[1]!,
  kind,
  sets: Object.fromEntries(Object.entries(sets).map(([id, state]) => [id, summary(state)])),
  rules: { total: 0, uncovered: null },
});

describe("designHeadline", () => {
  it("lists the declared unit kinds, not the template folders, with the units whose designs are written", () => {
    const headline = designHeadline({
      unitKinds: ["screen", "api", "module"],
      units: [
        unit("billing/invoice", "screen", { screen: "conformant", test: "stale", api: "not-applicable" }),
        unit("billing/search", "screen", { screen: "missing", test: "conformant" }),
        unit("billing/tax", "api", { api: "waived", test: "conformant" }),
        unit("billing/ledger", "ledger-close", { test: "problems" }),
      ],
      attention: [],
    });
    expect(headline).toEqual(["screen 1/2", "api 1/1", "module 0/0", "ledger-close 0/1"]);
  });

  it("names what needs a person instead of counting it", () => {
    expect(designHeadline({ unitKinds: ["screen"], units: [], attention: [{ kind: "template-error", count: 1, label: "" }, { kind: "stale", count: 2, label: "" }] })).toEqual([
      "screen 0/0",
      "1 template problem",
      "2 units with a stale design",
    ]);
    expect(attentionShort({ kind: "unresolved-component", count: 3 })).toBe("3 unknown common components");
    expect(attentionShort({ kind: "uncovered-rules", count: 1 })).toBe("1 unit with uncovered rules");
  });
});
