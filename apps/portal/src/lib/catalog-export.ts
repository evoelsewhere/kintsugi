// Export of the item catalog to an Excel workbook: one row per item of the view (what the filters show), one
// column per fact of the table, plus the facts the table only hints at (every file, the summary, the calls).
// The rows are built here without a browser; the workbook is written by exceljs, loaded when the button is used.

import type { CatalogView } from "./api/catalog";
import { assetClassOf, ASSET_CLASS_LABEL } from "./catalog-batch";
import { ITEM_STATUS, styleOf } from "./status";

export const CATALOG_COLUMNS = [
  { header: "Module", width: 18 },
  { header: "Module name", width: 28 },
  { header: "Item", width: 36 },
  { header: "Name", width: 36 },
  { header: "Kind", width: 14 },
  { header: "Class", width: 12 },
  { header: "Status", width: 16 },
  { header: "Complexity", width: 12 },
  { header: "Files", width: 8 },
  { header: "Code lines", width: 12 },
  { header: "Entry points", width: 12 },
  { header: "Parts", width: 8 },
  { header: "Depends on", width: 32 },
  { header: "Used by", width: 32 },
  { header: "Data stores", width: 28 },
  { header: "Pull request", width: 36 },
  { header: "Summary", width: 60 },
  { header: "Files (paths)", width: 60 },
] as const;

export type CatalogRow = Array<string | number>;

export function catalogRows(view: CatalogView): CatalogRow[] {
  const modules = new Map(view.catalog.modules.map((module) => [module.id, module.name]));
  return view.items.map((item) => [
    item.module,
    modules.get(item.module) ?? item.module,
    item.id,
    item.name,
    item.kind,
    ASSET_CLASS_LABEL[assetClassOf(item)],
    styleOf(ITEM_STATUS, item.status).label,
    item.complexity,
    item.files.length,
    item.loc,
    item.entryPoints.length,
    item.parts.length,
    (item.dependsOn ?? []).map((entry) => entry.item).join(", "),
    (item.usedBy ?? []).join(", "),
    (item.dataStores ?? []).map((store) => store.id).join(", "),
    item.pr?.url ?? item.pr?.branch ?? "",
    item.summary,
    item.files.join("\n"),
  ]);
}

/** The workbook of the catalog as bytes; one sheet, a frozen header row and a filter on every column. */
export async function catalogWorkbook(view: CatalogView): Promise<ArrayBuffer> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Item catalog", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = CATALOG_COLUMNS.map((column) => ({ header: column.header, width: column.width }));
  sheet.addRows(catalogRows(view));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CATALOG_COLUMNS.length } };
  for (const column of [17, 18]) sheet.getColumn(column).alignment = { wrapText: true, vertical: "top" };
  return workbook.xlsx.writeBuffer();
}

/** Saves the catalog as `<name>.xlsx` through the browser. */
export async function downloadCatalog(view: CatalogView, name: string): Promise<void> {
  const bytes = await catalogWorkbook(view);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
