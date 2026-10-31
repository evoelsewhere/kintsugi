// The layout of a row of boxes that may not fit its lane: pure arithmetic over measured sizes, so the drawing never
// depends on where the browser happened to put things. A box's size is its own (it does not change with the row it
// lands in), so measuring once and packing gives the same picture every time, and the links between rows are drawn
// from the same numbers instead of being read back from the page.

/** The measured size of one box, and of the arrow drawn before it (0 for the first box). */
export interface FlowSize {
  width: number;
  height: number;
  arrow: number;
}

/** Rows of box indexes, left to right; a row never starts with an arrow. */
export function packRows(sizes: readonly FlowSize[], available: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  sizes.forEach((size, index) => {
    const need = row.length === 0 ? size.width : size.arrow + size.width;
    if (row.length > 0 && used + need > available) {
      rows.push(row);
      row = [];
      used = 0;
    }
    used += row.length === 0 ? size.width : need;
    row.push(index);
  });
  if (row.length > 0) rows.push(row);
  return rows;
}

/** The height of a row: its tallest box or arrow. */
export const rowHeight = (row: readonly number[], sizes: readonly FlowSize[]): number => Math.max(0, ...row.map((index) => sizes[index]?.height ?? 0));

/** Where the centre of each box of a row sits, from the row's left edge. */
export function rowCentres(row: readonly number[], sizes: readonly FlowSize[]): number[] {
  let x = 0;
  return row.map((index, position) => {
    const size = sizes[index];
    if (size === undefined) return x;
    if (position > 0) x += size.arrow;
    const centre = x + size.width / 2;
    x += size.width;
    return centre;
  });
}

/**
 * The link from the last box of one row to the first box of the next, in a strip of height `gap` between the rows:
 * down out of the box's bottom edge, along the middle of the strip, down into the next box's top edge. Boxes are
 * centred in their row, so a box shorter than its row starts lower or ends higher than the strip's edge.
 */
export function rowLink(upper: readonly number[], lower: readonly number[], sizes: readonly FlowSize[], gap: number): { path: string; head: string; x: number; y: number } | undefined {
  const last = upper.at(-1);
  const first = lower[0];
  if (last === undefined || first === undefined) return undefined;
  const from = sizes[last];
  const to = sizes[first];
  if (from === undefined || to === undefined) return undefined;
  const x1 = rowCentres(upper, sizes).at(-1) ?? 0;
  const x2 = to.width / 2;
  const y1 = -(rowHeight(upper, sizes) - from.height) / 2;
  const y2 = gap + (rowHeight(lower, sizes) - to.height) / 2;
  const mid = gap / 2;
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    path: `M ${round(x1)} ${round(y1)} V ${mid} H ${round(x2)} V ${round(y2)}`,
    head: `M ${round(x2 - 4)} ${round(y2 - 5)} L ${round(x2)} ${round(y2)} L ${round(x2 + 4)} ${round(y2 - 5)}`,
    x: round((x1 + x2) / 2),
    y: mid,
  };
}
