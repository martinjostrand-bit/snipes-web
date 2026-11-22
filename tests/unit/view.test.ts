import { describe, expect, it } from "vitest";
import { createGrid, type Grid, type Point } from "../../src/core/grid";
import { createGame } from "../../src/core/state";
import {
  CELL_PX,
  VIEW_COLS,
  VIEW_ROWS,
  viewOrigin,
} from "../../src/render/view";

// Spec 2.1, 2.10, 3 and 9.1 WP 07, WP 07b and WP 11b: the maze is larger than the screen, wraps
// around at all four edges, and the view scrolls to keep the player centred. The view shows
// `VIEW_COLS` x `VIEW_ROWS` = 80 x 44 maze cells of `CELL_PX` = 16 x 16 pixels, plus the HUD
// row. `viewOrigin(maze, player)` gives the maze cell (wrapped into the grid) drawn at the
// view's top-left, for the player's position (the top-left cell of its 4 x 4 footprint);
// the view cell (i, j) shows the maze cell at origin + (i, j), wrapped.

const SIZE = 4; // the player's footprint is SIZE x SIZE cells (2.10)

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// Where the player's position appears in the view: its column and row.
function onScreen(maze: Grid, origin: Point, player: Point): Point {
  return {
    x: mod(player.x - origin.x, maze.width),
    y: mod(player.y - origin.y, maze.height),
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

// The size of the maze (2.10), open everywhere: the view does not depend on the cells.
const maze = createGrid(256, 240, () => "open");

describe("3 Presentation: the view is 80 x 44 cells of 16 x 16 pixels", () => {
  it("shows 80 columns and 44 rows of the maze", () => {
    expect(VIEW_COLS).toBe(80);
    expect(VIEW_ROWS).toBe(44);
  });

  it("draws each cell as a 16 x 16 pixel square", () => {
    expect(CELL_PX).toBe(16);
  });

  it("with the HUD row it is 1280 x 720 pixels, which fills a 1280 x 720 window at x1", () => {
    const width = VIEW_COLS * CELL_PX;
    const height = (VIEW_ROWS + 1) * CELL_PX;
    expect([width, height]).toEqual([1280, 720]);
  });
});

describe("2.1 Maze: the view is smaller than the maze", () => {
  it.each([1, 2, 42, 2026])(
    "shows fewer columns and rows than the maze has (seed %d)",
    (seed) => {
      const { maze } = createGame(seed);
      expect(VIEW_COLS).toBeLessThan(maze.width);
      expect(VIEW_ROWS).toBeLessThan(maze.height);
    },
  );
});

describe("3 Presentation: the player's footprint is centred in the view", () => {
  // 80 - 4 = 76 columns: 38 left of the footprint and 38 right of it. 44 - 4 = 40 rows: 20
  // above and 20 below.
  it("has as many columns left of the footprint as right of it, and as many rows above as below", () => {
    const at = onScreen(maze, viewOrigin(maze, { x: 100, y: 100 }), {
      x: 100,
      y: 100,
    });
    expect(at).toEqual({ x: 38, y: 20 });
    expect(VIEW_COLS - SIZE - at.x).toBe(at.x);
    expect(VIEW_ROWS - SIZE - at.y).toBe(at.y);
  });

  it("keeps the footprint on the same view cells wherever the player is in the maze", () => {
    const problems: string[] = [];
    for (const player of everyCell(maze)) {
      const at = onScreen(maze, viewOrigin(maze, player), player);
      if (at.x !== 38 || at.y !== 20) {
        problems.push(
          `player at ${player.x},${player.y} drawn at ${at.x},${at.y}`,
        );
        if (problems.length >= 5) break;
      }
    }
    expect(problems).toEqual([]);
  });

  it("gives an origin inside the grid for every player position", () => {
    const problems: string[] = [];
    for (const player of everyCell(maze)) {
      const { x, y } = viewOrigin(maze, player);
      const inside =
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        x >= 0 &&
        x < maze.width &&
        y >= 0 &&
        y < maze.height;
      if (!inside) {
        problems.push(`player at ${player.x},${player.y}: origin ${x},${y}`);
        if (problems.length >= 5) break;
      }
    }
    expect(problems).toEqual([]);
  });

  it("does not depend on the maze's cells, only on its size", () => {
    const walls = createGrid(256, 240, ({ x, y }) =>
      x % 16 === 0 || y % 12 === 0 ? "wall" : "open",
    );
    for (const player of [
      { x: 0, y: 0 },
      { x: 6, y: 4 },
      { x: 255, y: 239 },
    ]) {
      expect(viewOrigin(walls, player)).toEqual(viewOrigin(maze, player));
    }
  });
});

// Near an edge the view shows the cells across that edge, so the origin wraps to the far side
// of the maze. The maze is 256 x 240; the origin is 38 columns left of and 20 rows above the
// player's position.
describe("2.1 Maze: the view wraps around at all four edges", () => {
  it.each([
    ["the middle", { x: 128, y: 120 }, { x: 90, y: 100 }],
    ["the top-left corner", { x: 0, y: 0 }, { x: 218, y: 220 }],
    ["the top-right corner", { x: 255, y: 0 }, { x: 217, y: 220 }],
    ["the bottom-left corner", { x: 0, y: 239 }, { x: 218, y: 219 }],
    ["the bottom-right corner", { x: 255, y: 239 }, { x: 217, y: 219 }],
    ["the left edge", { x: 10, y: 120 }, { x: 228, y: 100 }],
    ["the right edge", { x: 250, y: 120 }, { x: 212, y: 100 }],
    ["the top edge", { x: 128, y: 5 }, { x: 90, y: 225 }],
    ["the bottom edge", { x: 128, y: 236 }, { x: 90, y: 216 }],
    ["the view's own edge", { x: 38, y: 20 }, { x: 0, y: 0 }],
    [
      "one cell before the view's own edge",
      { x: 37, y: 19 },
      { x: 255, y: 239 },
    ],
  ])("centres a player at %s", (_where, player, origin) => {
    expect(viewOrigin(maze, player)).toEqual(origin);
  });
});
