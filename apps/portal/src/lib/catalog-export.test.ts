import { beforeAll, describe, expect, it } from "vitest";
import type { CatalogItem, CatalogView } from "./api/catalog";
import { CATALOG_COLUMNS, catalogRows, catalogWorkbook } from "./catalog-export";

const item: CatalogItem = {
  id: "billing/invoice",
  module: "billing",
  kind: "screen",
  name: "Invoice",
  summary: "Prints an invoice",
  files: ["a.cbl", "b.cbl"],
  leaves: [],
  entryPoints: ["MAIN"],
  loc: 120,
  complexity: "high",
  digest: "d",
  status: "understood",
  aliases: [],
  parts: [{ name: "print" }],
  usedBy: ["billing/ledger"],
  pr: { runId: "r1", branch: "kintsugi/r1", url: "https://example.test/pr/7" },
};
const view = { items: [item], catalog: { modules: [{ id: "billing", name: "Billing", summary: "" }] } } as unknown as CatalogView;

describe("the catalog export", () => {
  // exceljs is large and loaded on first use: cold, on a busy machine, that alone can pass the default 5 s.
  beforeAll(async () => {
    await import("exceljs");
  }, 60_000);

  it("has a row per item with a cell for every column", () => {
    const [row] = catalogRows(view);
    expect(row).toHaveLength(CATALOG_COLUMNS.length);
    expect(row?.slice(0, 4)).toEqual(["billing", "Billing", "billing/invoice", "Invoice"]);
    expect(row).toContain("https://example.test/pr/7");
    expect(row?.at(-1)).toBe("a.cbl\nb.cbl");
  });

  it("writes an xlsx workbook", async () => {
    const bytes = await catalogWorkbook(view);
    expect(new Uint8Array(bytes).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  }, 30_000);
});
