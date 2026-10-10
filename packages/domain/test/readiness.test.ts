// Capability maturity and readiness (docs/reference/rulebook.md §6, ADR-0013).

import { describe, expect, it } from "vitest";
import { checkReadiness, resolveMaturity, type CapabilityDecl, type CapabilityName, type CapabilityProvider, type UnitScope, type Waiver } from "../src/index.js";

const TODAY = "2026-10-10";
const unit: UnitScope = { id: "U-001", kind: "screen", application: "billing" };
const pilot: UnitScope = { ...unit, id: "U-002", pilot: true };

// checkReadiness types `providers` as a full Record over CapabilityName although it reads
// it as partial (`?? []`); real callers only know the capabilities a rulebook provides.
const providers = (map: Record<string, CapabilityProvider[]>) => map as Record<CapabilityName, CapabilityProvider[]>;

const provider = (layer: string, maturity: CapabilityDecl["maturity"]): CapabilityProvider => ({ layer, decl: { maturity, uses: [] } });
const waiver = (overrides: Partial<Waiver> = {}): Waiver => ({
  id: "W-001",
  capability: "compare",
  scope: {},
  reason: "test",
  approvedBy: ["architect"],
  expires: TODAY,
  ...overrides,
});

describe("resolveMaturity", () => {
  it("returns a plain value as is", () => {
    expect(resolveMaturity("ready", unit)).toBe("ready");
  });

  it("resolves the most specific scope: byApplication > byKind > default", () => {
    const scoped = { default: "template", byKind: { screen: "draft" }, byApplication: { billing: "ready" } } as const;
    expect(resolveMaturity(scoped, unit)).toBe("ready");
    expect(resolveMaturity(scoped, { kind: "screen", application: "other" })).toBe("draft");
    expect(resolveMaturity(scoped, { kind: "batch", application: "other" })).toBe("template");
  });
});

describe("checkReadiness", () => {
  const check = (list: CapabilityProvider[], target: UnitScope = unit, waivers: Waiver[] = []) =>
    checkReadiness(providers({ compare: list }), ["compare"], target, waivers, TODAY);

  it("reports a capability without provider as missing", () => {
    const result = checkReadiness(providers({}), ["compare"], unit, [], TODAY);
    expect(result).toEqual({ ok: false, missing: [{ capability: "compare" }], waived: [] });
  });

  it("passes with nothing required", () => {
    expect(checkReadiness(providers({}), [], unit, [], TODAY).ok).toBe(true);
  });

  it("allows ready for every unit", () => {
    expect(check([provider("packs/p", "ready")]).ok).toBe(true);
  });

  it("allows draft only for pilot units", () => {
    expect(check([provider("packs/p", "draft")], pilot).ok).toBe(true);
    expect(check([provider("packs/p", "draft")], unit)).toMatchObject({ ok: false, missing: [{ capability: "compare", layer: "packs/p", maturity: "draft" }] });
  });

  it("blocks template and suspended, also for pilot units", () => {
    expect(check([provider("packs/p", "template")], pilot).ok).toBe(false);
    expect(check([provider("packs/p", "suspended")], pilot).ok).toBe(false);
  });

  it("requires every providing layer to allow the capability", () => {
    const result = check([provider("vendor/base@1.0.0", "ready"), provider("packs/p", "draft")]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([{ capability: "compare", layer: "packs/p", maturity: "draft" }]);
  });

  it("uses scoped maturity per unit", () => {
    const scoped = provider("packs/p", { default: "draft", byKind: { screen: "ready" } });
    expect(check([scoped], unit).ok).toBe(true);
    expect(check([scoped], { ...unit, kind: "batch" }).ok).toBe(false);
  });

  it("checks every required capability", () => {
    const result = checkReadiness(providers({ compare: [provider("packs/p", "ready")], deploy: [provider("packs/q", "template")] }), ["compare", "deploy"], unit, [], TODAY);
    expect(result.ok).toBe(false);
    expect(result.missing.map((entry) => entry.capability)).toEqual(["deploy"]);
  });

  describe("waivers", () => {
    it("cover a blocked layer and are reported", () => {
      const result = check([provider("packs/p", "draft")], unit, [waiver()]);
      expect(result).toEqual({ ok: true, missing: [], waived: [{ capability: "compare", layer: "packs/p", waiver: "W-001" }] });
    });

    // docs/reference/rulebook.md §6.3 does not say whether template can be waived; the code allows it.
    it("can cover template", () => {
      expect(check([provider("packs/p", "template")], unit, [waiver()]).ok).toBe(true);
    });

    // Not stated in docs/reference/rulebook.md §6.3; stated in the checkReadiness doc comment.
    it("never cover suspended", () => {
      expect(check([provider("packs/p", "suspended")], unit, [waiver()])).toMatchObject({ ok: false, waived: [] });
    });

    it("must name the capability", () => {
      expect(check([provider("packs/p", "draft")], unit, [waiver({ capability: "deploy" })]).ok).toBe(false);
    });

    it("are valid through their expiry date, inclusive", () => {
      expect(check([provider("packs/p", "draft")], unit, [waiver({ expires: TODAY })]).ok).toBe(true);
      expect(check([provider("packs/p", "draft")], unit, [waiver({ expires: "2026-10-09" })]).ok).toBe(false);
    });

    it("restricted to packs match the layer by name or path suffix", () => {
      const scoped = waiver({ packs: ["webforms"] });
      expect(check([provider("webforms", "draft")], unit, [scoped]).ok).toBe(true);
      expect(check([provider("packs/webforms", "draft")], unit, [scoped]).ok).toBe(true);
      expect(check([provider("packs/other-webforms", "draft")], unit, [scoped]).ok).toBe(false);
      expect(check([provider("packs/webforms-x", "draft")], unit, [scoped]).ok).toBe(false);
    });

    it("cover only the layers they name when restricted to packs", () => {
      const result = check([provider("packs/webforms", "draft"), provider("packs/other", "draft")], unit, [waiver({ packs: ["webforms"] })]);
      expect(result.ok).toBe(false);
      expect(result.waived).toEqual([{ capability: "compare", layer: "packs/webforms", waiver: "W-001" }]);
      expect(result.missing).toEqual([{ capability: "compare", layer: "packs/other", maturity: "draft" }]);
    });

    it("scoped to units match only those units, ignoring kinds and applications", () => {
      const byUnit = waiver({ scope: { units: ["U-001"], kinds: ["batch"], applications: ["other"] } });
      expect(check([provider("packs/p", "draft")], unit, [byUnit]).ok).toBe(true);
      expect(check([provider("packs/p", "draft")], { ...unit, id: "U-009" }, [byUnit]).ok).toBe(false);
    });

    it("scoped to applications and kinds must match both", () => {
      const both = waiver({ scope: { applications: ["billing"], kinds: ["screen"] } });
      expect(check([provider("packs/p", "draft")], unit, [both]).ok).toBe(true);
      expect(check([provider("packs/p", "draft")], { ...unit, kind: "batch" }, [both]).ok).toBe(false);
      expect(check([provider("packs/p", "draft")], { ...unit, application: "crm" }, [both]).ok).toBe(false);
    });

    it("with an empty scope cover every unit (docs: empty = all units)", () => {
      expect(check([provider("packs/p", "draft")], unit, [waiver({ scope: { kinds: [], units: [] } })]).ok).toBe(true);
    });

    it("use the first matching waiver", () => {
      const result = check([provider("packs/p", "draft")], unit, [waiver({ id: "W-001", expires: "2020-01-01" }), waiver({ id: "W-002" }), waiver({ id: "W-003" })]);
      expect(result.waived).toEqual([{ capability: "compare", layer: "packs/p", waiver: "W-002" }]);
    });
  });

  it("defaults today to the current date", () => {
    const expired = waiver({ expires: "2000-01-01" });
    expect(checkReadiness(providers({ compare: [provider("packs/p", "draft")] }), ["compare"], unit, [expired]).ok).toBe(false);
  });
});
