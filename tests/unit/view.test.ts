import { describe, expect, it } from "vitest";
import { createGrid, type Grid, type Point } from "../../src/core/grid";
import { createGame } from "../../src/core/state";
import { VIEW_COLS, VIEW_ROWS, viewOrigin } from "../../src/render/view";

// Spec 2.1 and 9.1 WP 07: the maze is larger than the screen, wraps around at all four edges,
// and the view scrolls to keep the player centred. The view is `VIEW_COLS` x `VIEW_ROWS`
// cells. `viewOrigin(maze, centre, cols, rows)` gives the maze cell (wrapped into the grid)
// drawn at the top-left of a view `cols` x `rows` cells centred on `centre`; the view cell
// (i, j) shows the maze cell at origin + (i, j), wrapped.

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// Where `centre` appears in the view: its column and row.
function onScreen(maze: Grid, origin: Point, centre: Point): Point {
  return {
    x: mod(centre.x - origin.x, maze.width),
    y: mod(centre.y - origin.y, maze.height),
  };
}

function everyCell(maze: Grid): Point[] {
  const cells: Point[] = [];
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

const maze = createGrid(20, 16, () => "open");

describe("2.1 Maze: the view is smaller than the maze", () => {
  it("is a positive whole number of cells in each direction", () => {
    expect(Number.isInteger(VIEW_COLS)).toBe(true);
    expect(Number.isInteger(VIEW_ROWS)).toBe(true);
    expect(VIEW_COLS).toBeGreaterThan(0);
    expect(VIEW_ROWS).toBeGreaterThan(0);
  });

  it.each([1, 2, 42, 2026])(
    "shows fewer columns and rows than the maze has (seed %d)",
    (seed) => {
      const { maze } = createGame(seed);
      expect(VIEW_COLS).toBeLessThan(maze.width);
      expect(VIEW_ROWS).toBeLessThan(maze.height);
    },
  );
});

describe("2.1 Maze: the view scrolls to keep the player centred", () => {
  // Centred: the columns left and right of the player differ by at most one, and so do the
  // rows above and below it.
  it.each([
    [VIEW_COLS, VIEW_ROWS],
    [9, 7],
    [10, 6],
    [3, 3],
  ])("puts the player in the middle of a %d x %d view", (cols, rows) => {
    const big = createGrid(
      Math.max(64, cols + 1),
      Math.max(48, rows + 1),
      () => "open",
    );
    const centre = { x: 30, y: 20 };
    const at = onScreen(big, viewOrigin(big, centre, cols, rows), centre);

    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x).toBeLessThan(cols);
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(at.y).toBeLessThan(rows);
    expect(Math.abs(at.x - (cols - 1 - at.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(at.y - (rows - 1 - at.y))).toBeLessThanOrEqual(1);
  });

  it.each([
    [9, 7],
    [10, 6],
  ])(
    "keeps the player on the same view cell wherever it is in the maze (%d x %d view)",
    (cols, rows) => {
      const first = onScreen(
        maze,
        viewOrigin(maze, { x: 0, y: 0 }, cols, rows),
        { x: 0, y: 0 },
      );
      const problems: string[] = [];
      for (const centre of everyCell(maze)) {
        const origin = viewOrigin(maze, centre, cols, rows);
        const at = onScreen(maze, origin, centre);
        if (at.x !== first.x || at.y !== first.y) {
          problems.push(
            `player at ${centre.x},${centre.y} drawn at ${at.x},${at.y}`,
          );
        }
      }
      expect(problems).toEqual([]);
    },
  );

  it("gives an origin inside the grid for every player cell", () => {
    const problems: string[] = [];
    for (const centre of everyCell(maze)) {
      const { x, y } = viewOrigin(maze, centre, 9, 7);
      const inside =
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        x >= 0 &&
        x < maze.width &&
        y >= 0 &&
        y < maze.height;
      if (!inside) {
        problems.push(`player at ${centre.x},${centre.y}: origin ${x},${y}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("does not depend on the maze's cells, only on its size", () => {
    const walls = createGrid(20, 16, ({ x, y }) =>
      x % 2 === 1 && y % 2 === 1 ? "wall" : "open",
    );
    for (const centre of [
      { x: 0, y: 0 },
      { x: 7, y: 3 },
      { x: 19, y: 15 },
    ]) {
      expect(viewOrigin(walls, centre, 9, 7)).toEqual(
        viewOrigin(maze, centre, 9, 7),
      );
    }
  });
});

// A 9 x 7 view has exactly one middle cell: column 4, row 3. Near an edge the view shows the
// cells across that edge, so the origin wraps to the far side of the maze.
describe("2.1 Maze: the view wraps around at all four edges", () => {
  it.each([
    ["the middle", { x: 10, y: 8 }, { x: 6, y: 5 }],
    ["the top-left corner", { x: 0, y: 0 }, { x: 16, y: 13 }],
    ["the top-right corner", { x: 19, y: 0 }, { x: 15, y: 13 }],
    ["the bottom-left corner", { x: 0, y: 15 }, { x: 16, y: 12 }],
    ["the bottom-right corner", { x: 19, y: 15 }, { x: 15, y: 12 }],
    ["the left edge", { x: 2, y: 8 }, { x: 18, y: 5 }],
    ["the right edge", { x: 17, y: 8 }, { x: 13, y: 5 }],
    ["the top edge", { x: 10, y: 1 }, { x: 6, y: 14 }],
    ["the bottom edge", { x: 10, y: 14 }, { x: 6, y: 11 }],
  ])("centres a player at %s", (_where, centre, origin) => {
    expect(viewOrigin(maze, centre, 9, 7)).toEqual(origin);
  });
});
