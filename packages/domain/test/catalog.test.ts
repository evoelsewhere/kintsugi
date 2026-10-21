import { describe, expect, it } from "vitest";
import { CATALOG_ITEM_ID_PATTERN, ITEM_SEGMENT_PATTERN, catalogPath, classifyItem, itemUnderstandingPath, workItemIdOf } from "../src/index.js";

describe("item catalog vocabulary", () => {
  it("accepts <module>/<item> ids of kebab-case segments only", () => {
    for (const id of ["invoicing/invoice-entry", "core/a", "m1/x-2"]) expect(CATALOG_ITEM_ID_PATTERN.test(id)).toBe(true);
    for (const id of ["invoicing", "Invoicing/entry", "a/b/c", "-a/b", "a/", "../a", `a/${"x".repeat(64)}`]) expect(CATALOG_ITEM_ID_PATTERN.test(id)).toBe(false);
    expect(ITEM_SEGMENT_PATTERN.test("billing")).toBe(true);
    expect(ITEM_SEGMENT_PATTERN.test("bill/ing")).toBe(false);
  });

  it("names the work item and the document-repo paths of an item", () => {
    expect(workItemIdOf("billing", "invoicing/invoice-entry")).toBe("billing/invoicing/invoice-entry");
    expect(catalogPath("billing")).toBe("applications/billing/assessment/catalog/index.md");
    expect(itemUnderstandingPath("billing", "invoicing/invoice-entry")).toBe("applications/billing/units/invoicing/invoice-entry/understanding/understanding.md");
  });
});

describe("item asset class", () => {
  it("calls an item a test or generated only when every file is", () => {
    expect(classifyItem(["src/test/java/org/OrganizationRegisterConsumerTest.java", "src/test/resources/x.json"])).toBe("test");
    expect(classifyItem(["web/app.test.ts", "web/util.spec.ts"])).toBe("test");
    expect(classifyItem(["pkg/a_test.go"])).toBe("test");
    expect(classifyItem(["src/main/java/Invoice.java", "src/test/java/InvoiceTest.java"])).toBe("code");
    expect(classifyItem(["build/gen/Api.java", "src/generated/Model.java"])).toBe("generated");
    expect(classifyItem(["static/app.min.js"])).toBe("generated");
    expect(classifyItem(["src/main/java/Invoice.java"])).toBe("code");
    expect(classifyItem([])).toBe("code");
  });
});
