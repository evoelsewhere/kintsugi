import { describe, expect, it } from "vitest";
import { CATALOG_ITEM_ID_PATTERN, ITEM_SEGMENT_PATTERN, catalogPath, itemMetaPath, workItemIdOf } from "../src/index.js";

describe("item catalog vocabulary", () => {
  it("accepts <module>/<item> ids of kebab-case segments only", () => {
    for (const id of ["invoicing/invoice-entry", "core/a", "m1/x-2"]) expect(CATALOG_ITEM_ID_PATTERN.test(id)).toBe(true);
    for (const id of ["invoicing", "Invoicing/entry", "a/b/c", "-a/b", "a/", "../a", `a/${"x".repeat(64)}`]) expect(CATALOG_ITEM_ID_PATTERN.test(id)).toBe(false);
    expect(ITEM_SEGMENT_PATTERN.test("billing")).toBe(true);
    expect(ITEM_SEGMENT_PATTERN.test("bill/ing")).toBe(false);
  });

  it("names the work item and the document-repo paths of an item", () => {
    expect(workItemIdOf("billing", "invoicing/invoice-entry")).toBe("billing/invoicing/invoice-entry");
    expect(catalogPath("billing")).toBe("applications/billing/assessment/catalog.json");
    expect(itemMetaPath("billing", "invoicing/invoice-entry")).toBe("applications/billing/units/invoicing/invoice-entry/meta.json");
  });
});
