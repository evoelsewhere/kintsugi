import { describe, expect, it } from "vitest";
import { takenName, uniqueId } from "./ids";

describe("takenName", () => {
  it("finds a name already used, whatever its case and surrounding spaces", () => {
    expect(takenName("Billing", ["Billing", "Payroll"])).toBe("Billing");
    expect(takenName(" billing ", ["Billing"])).toBe("Billing");
  });

  it("lets a new name, or an empty one, through", () => {
    expect(takenName("Billing web", ["Billing"])).toBeUndefined();
    expect(takenName("  ", ["Billing"])).toBeUndefined();
  });
});

describe("uniqueId", () => {
  it("still derives an id from a new name", () => {
    expect(uniqueId("Billing web", ["billing"])).toBe("billing-web");
    expect(uniqueId("Billing", ["billing"])).toBe("billing-2");
  });
});
