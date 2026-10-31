import { describe, expect, it } from "vitest";
import { type FlowSize, packRows, rowCentres, rowHeight, rowLink } from "./flow-layout";

const box = (width: number, height = 40, arrow = 26): FlowSize => ({ width, height, arrow });

describe("packing a line of boxes into rows", () => {
  it("keeps everything on one row when it fits, counting the arrows between boxes only", () => {
    expect(packRows([box(100, 40, 0), box(100), box(100)], 352)).toEqual([[0, 1, 2]]);
  });

  it("starts a new row with the box that does not fit, without its arrow", () => {
    expect(packRows([box(100, 40, 0), box(100), box(100)], 351)).toEqual([[0, 1], [2]]);
  });

  it("gives a box wider than the lane a row of its own instead of overflowing the one before", () => {
    expect(packRows([box(100, 40, 0), box(500), box(100)], 300)).toEqual([[0], [1], [2]]);
  });

  it("never drops a box, whatever the width", () => {
    expect(packRows([box(10, 40, 0), box(10), box(10)], 0).flat()).toEqual([0, 1, 2]);
    expect(packRows([], 100)).toEqual([]);
  });
});

describe("the link between two rows", () => {
  const sizes = [box(100, 40, 0), box(120, 60), box(80, 20)];

  it("measures a row by its tallest box and places each box's centre after the arrows before it", () => {
    expect(rowHeight([0, 1], sizes)).toBe(60);
    expect(rowCentres([0, 1], sizes)).toEqual([50, 100 + 26 + 60]);
  });

  it("leaves the bottom of the last box of a row and enters the top of the first box of the next", () => {
    // Row [0, 1] is 60 high and box 1 fills it; row [2] is 20 high and box 2 fills it.
    const link = rowLink([0, 1], [2], sizes, 28);
    expect(link?.path).toBe("M 186 0 V 14 H 40 V 28");
    expect(link?.head).toBe("M 36 23 L 40 28 L 44 23");
  });

  it("starts below a box shorter than its row and ends inside a taller next row at the box's top", () => {
    // Box 0 (40 high, after box 1 and no arrow) sits centred in row [1, 0] (60 high): its bottom is 10 above the row's bottom.
    const link = rowLink([1, 0], [1, 2], sizes, 28);
    expect(link?.path).toBe("M 170 -10 V 14 H 60 V 28");
  });
});
