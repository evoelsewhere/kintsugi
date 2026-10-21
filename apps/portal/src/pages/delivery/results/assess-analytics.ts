// Figures of the assess inventory for the charts and signals: directory roll-up, size distribution,
// concentration of complexity. The inventory document (ADR-0042) holds these roll-ups already, computed
// over every file of the run; the functions here only shape them for the charts.

import type { Inventory, InventoryFile, Table } from "@/lib/api/documents";

export interface DirectoryStat {
  dir: string;
  files: number;
  sloc: number;
  complexity: number;
}

/** SLOC and complexity per directory, as the inventory rolled them up (deeper while one directory holds most of the code). */
export function directoryRollup(inventory: Inventory): { depth: number; rows: DirectoryStat[] } {
  return { depth: inventory.directoryDepth, rows: inventory.directories.map((entry) => ({ dir: entry.path, files: entry.files, sloc: entry.sloc, complexity: entry.complexity })) };
}

/** Files per SLOC bucket. */
export function sizeDistribution(inventory: Inventory): Array<{ label: string; value: number }> {
  return inventory.sizeDistribution.map((bucket) => ({ label: bucket.label, value: bucket.files }));
}

export interface InventorySignals {
  /** Source files only (those with code), the denominator of the file statistics. */
  codeFiles: number;
  medianSloc: number;
  /** The biggest of the most complex files the inventory lists. */
  largest: InventoryFile | undefined;
  /** How many files hold half of all the complexity. */
  halfComplexityFiles: number;
  /** Share of the complexity in the ten most complex files, 0..1. */
  topTenShare: number;
  /** Files above 1,000 SLOC. */
  oversized: number;
}

export function inventorySignals(inventory: Inventory): InventorySignals {
  return { ...inventory.signals, largest: [...inventory.files].sort((a, b) => b.sloc - a.sloc)[0] };
}

/** Counts of the values in the column of a document table whose header matches (e.g. Priority). */
export function tableColumnCounts(table: Table | null, header: RegExp): Array<{ value: string; count: number }> {
  if (table === null) return [];
  const column = table.header.findIndex((cell) => header.test(cell));
  if (column < 0) return [];
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    const value = (row[column] ?? "").replace(/[*_`]/g, "").trim();
    if (value !== "") counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
}
