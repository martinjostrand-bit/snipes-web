import { describe, expect, it } from "vitest";
import {
  cellAt,
  createGrid,
  wrap,
  type Cell,
  type Point,
} from "../../src/core/grid";

// Spec 2.1 and 9.1 WP 04: a rectangular grid of cells that wraps around at all four edges.
// The grid is deliberately not square, so swapped width and height are caught.
const W = 7;
const H = 4;
const grid = createGrid(W, H, () => "open");

function pattern({ x, y }: Point): Cell {
  return (x * 3 + y) % 4 === 0 ? "wall" : "open";
}

describe("2.1 Maze: cell grid", () => {
  it("has the width and height it was created with", () => {
    expect(grid.width).toBe(W);
    expect(grid.height).toBe(H);
  });

  it("stores the cell for every position, without swapping x and y", () => {
    const patterned = createGrid(W, H, pattern);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(cellAt(patterned, { x, y })).toBe(pattern({ x, y }));
      }
    }
  });

  it("asks for each cell exactly once, only inside the grid", () => {
    const asked: Point[] = [];
    createGrid(W, H, (p) => {
      asked.push({ x: p.x, y: p.y });
      return "open";
    });

    expect(asked).toHaveLength(W * H);
    const keys = new Set(asked.map(({ x, y }) => `${x},${y}`));
    expect(keys.size).toBe(W * H);
    for (const { x, y } of asked) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(H);
    }
  });

  it("can be all walls or all open", () => {
    const walls = createGrid(3, 2, () => "wall");
    const open = createGrid(3, 2, () => "open");
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        expect(cellAt(walls, { x, y })).toBe("wall");
        expect(cellAt(open, { x, y })).toBe("open");
      }
    }
  });

  it.each([
    [0, 4],
    [7, 0],
    [-1, 4],
    [7, -2],
    [2.5, 4],
    [7, 1.5],
    [Number.NaN, 4],
    [7, Number.POSITIVE_INFINITY],
  ])("rejects a %s x %s grid", (width, height) => {
    expect(() => createGrid(width, height, () => "open")).toThrow(RangeError);
  });
});

describe("2.1 Maze: wrap-around coordinates", () => {
  it("leaves every position inside the grid unchanged", () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(wrap(grid, { x, y })).toEqual({ x, y });
      }
    }
  });

  it.each([
    ["left", { x: -1, y: 2 }, { x: W - 1, y: 2 }],
    ["right", { x: W, y: 2 }, { x: 0, y: 2 }],
    ["top", { x: 3, y: -1 }, { x: 3, y: H - 1 }],
    ["bottom", { x: 3, y: H }, { x: 3, y: 0 }],
  ])("wraps across the %s edge", (_edge, from, to) => {
    expect(wrap(grid, from)).toEqual(to);
  });

  it.each([
    ["top-left", { x: -1, y: -1 }, { x: W - 1, y: H - 1 }],
    ["top-right", { x: W, y: -1 }, { x: 0, y: H - 1 }],
    ["bottom-left", { x: -1, y: H }, { x: W - 1, y: 0 }],
    ["bottom-right", { x: W, y: H }, { x: 0, y: 0 }],
  ])("wraps across the %s corner", (_corner, from, to) => {
    expect(wrap(grid, from)).toEqual(to);
  });

  it.each([
    [
      { x: -W, y: 0 },
      { x: 0, y: 0 },
    ],
    [
      { x: 0, y: -H },
      { x: 0, y: 0 },
    ],
    [
      { x: -W - 1, y: -H - 1 },
      { x: W - 1, y: H - 1 },
    ],
    [
      { x: 2 * W + 3, y: 3 * H + 1 },
      { x: 3, y: 1 },
    ],
    [
      { x: -3 * W + 2, y: -5 * H + 3 },
      { x: 2, y: 3 },
    ],
  ])("wraps %o, more than one grid away, to %o", (from, to) => {
    expect(wrap(grid, from)).toEqual(to);
  });

  it("maps every position on a 1 x 1 grid to the only cell", () => {
    const tiny = createGrid(1, 1, () => "open");
    for (const p of [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 5, y: -9 },
    ]) {
      expect(wrap(tiny, p)).toEqual({ x: 0, y: 0 });
    }
  });

  it("does not change the point it is given", () => {
    const p = { x: -1, y: H };
    wrap(grid, p);
    expect(p).toEqual({ x: -1, y: H });
  });

  it("reads cells across all four edges", () => {
    // One wall in the top-right corner; everything else is open.
    const corner = createGrid(W, H, ({ x, y }) =>
      x === W - 1 && y === 0 ? "wall" : "open",
    );

    expect(cellAt(corner, { x: W - 1, y: 0 })).toBe("wall");
    expect(cellAt(corner, { x: -1, y: 0 })).toBe("wall"); // across the left edge
    expect(cellAt(corner, { x: W - 1, y: H })).toBe("wall"); // across the bottom edge
    expect(cellAt(corner, { x: -1, y: H })).toBe("wall"); // across both
    expect(cellAt(corner, { x: 2 * W - 1, y: -2 * H })).toBe("wall");

    // The neighbours across the right and top edges of the wall are open.
    expect(cellAt(corner, { x: W, y: 0 })).toBe("open");
    expect(cellAt(corner, { x: W - 1, y: -1 })).toBe("open");
    expect(cellAt(corner, { x: 0, y: 0 })).toBe("open");
  });
});
