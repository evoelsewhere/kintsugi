// Figures derived from the assess inventory for the charts and signals: directory roll-up, size
// distribution, concentration of complexity. Pure functions over inventory.json's file list.

import type { Inventory, InventoryFile, Table } from "@/lib/api/documents";

export interface DirectoryStat {
  dir: string;
  files: number;
  sloc: number;
  complexity: number;
}

const directoryOf = (path: string, depth: number): string => {
  const parts = path.split("/").slice(0, -1);
  return parts.length === 0 ? "(root)" : parts.slice(0, depth).join("/");
};

/** SLOC and complexity per directory; goes deeper while one directory holds most of the code. */
export function directoryRollup(files: readonly InventoryFile[]): { depth: number; rows: DirectoryStat[] } {
  const total = files.reduce((sum, file) => sum + file.sloc, 0);
  let depth = 1;
  let rows: DirectoryStat[] = [];
  for (; depth <= 4; depth++) {
    const groups = new Map<string, DirectoryStat>();
    for (const file of files) {
      const dir = directoryOf(file.path, depth);
      const stat = groups.get(dir) ?? { dir, files: 0, sloc: 0, complexity: 0 };
      stat.files += 1;
      stat.sloc += file.sloc;
      stat.complexity += file.complexity;
      groups.set(dir, stat);
    }
    rows = [...groups.values()].sort((a, b) => b.sloc - a.sloc);
    if (total === 0 || (rows[0]?.sloc ?? 0) / total < 0.6 || rows.length > 40) break;
  }
  return { depth: Math.min(depth, 4), rows };
}

const SIZE_BUCKETS: Array<{ label: string; below: number }> = [
  { label: "<50", below: 50 },
  { label: "50–99", below: 100 },
  { label: "100–249", below: 250 },
  { label: "250–499", below: 500 },
  { label: "500–999", below: 1000 },
  { label: "1k–2.5k", below: 2500 },
  { label: "2.5k+", below: Number.POSITIVE_INFINITY },
];

/** Files per SLOC bucket. */
export function sizeDistribution(files: readonly InventoryFile[]): Array<{ label: string; value: number }> {
  const counts = SIZE_BUCKETS.map(() => 0);
  for (const file of files) {
    const index = SIZE_BUCKETS.findIndex((bucket) => file.sloc < bucket.below);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return SIZE_BUCKETS.map((bucket, index) => ({ label: bucket.label, value: counts[index] ?? 0 }));
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export interface InventorySignals {
  /** Source files only (those with code), the denominator of the file statistics. */
  codeFiles: number;
  medianSloc: number;
  largest: InventoryFile | undefined;
  /** How many files hold half of all the complexity. */
  halfComplexityFiles: number;
  /** Share of the complexity in the ten most complex files, 0..1. */
  topTenShare: number;
  /** Files above 1,000 SLOC. */
  oversized: number;
}

export function inventorySignals(inventory: Inventory): InventorySignals {
  const code = inventory.files.filter((file) => file.sloc > 0);
  const byComplexity = [...code].sort((a, b) => b.complexity - a.complexity);
  const total = byComplexity.reduce((sum, file) => sum + file.complexity, 0);
  let running = 0;
  let halfComplexityFiles = 0;
  for (const file of byComplexity) {
    running += file.complexity;
    halfComplexityFiles += 1;
    if (running >= total / 2) break;
  }
  const topTen = byComplexity.slice(0, 10).reduce((sum, file) => sum + file.complexity, 0);
  return {
    codeFiles: code.length,
    medianSloc: median(code.map((file) => file.sloc)),
    largest: [...code].sort((a, b) => b.sloc - a.sloc)[0],
    halfComplexityFiles: total === 0 ? 0 : halfComplexityFiles,
    topTenShare: total === 0 ? 0 : topTen / total,
    oversized: code.filter((file) => file.sloc >= 1000).length,
  };
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
