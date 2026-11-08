import { afterEach, describe, expect, it, vi } from "vitest";
import { cellAt, type Grid, type Point } from "../../src/core/grid";
import { generateMaze } from "../../src/core/maze";
import { createRng, nextFloat } from "../../src/core/rng";

// Spec 2.1, 6.2 and 9.1 WP 05: a maze generated randomly from a seed. The same seed always
// gives the same maze, and every open cell is reachable from every other open cell.
// The final maze size is still open (spec 10), so the size is a parameter here and the
// tests use several non-square sizes, so swapped width and height are caught.
const W = 64;
const H = 40;
const SEED_COUNT = 1000;

// "1,000 random seeds" (spec 9, M1), drawn from the seeded PRNG so the run is repeatable,
// plus the smallest and largest 32-bit seeds.
function randomSeeds(count: number): number[] {
  const seeds = [0, 2 ** 32 - 1];
  let rng = createRng(20261108);
  while (seeds.length < count) {
    const [value, next] = nextFloat(rng);
    seeds.push(Math.floor(value * 2 ** 32));
    rng = next;
  }
  return seeds;
}

let mazes: { seed: number; maze: Grid }[] | undefined;
function manyMazes(): { seed: number; maze: Grid }[] {
  mazes ??= randomSeeds(SEED_COUNT).map((seed) => ({
    seed,
    maze: generateMaze(seed, W, H),
  }));
  return mazes;
}

function openCells(maze: Grid): Point[] {
  const open: Point[] = [];
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      if (cellAt(maze, { x, y }) === "open") open.push({ x, y });
    }
  }
  return open;
}

// Counts the open cells reachable from `start` in steps of one cell up, down, left or
// right, wrapping at all four edges. Orthogonal steps only: a cell that can only be
// reached by squeezing diagonally between two walls does not count as reachable.
function reachableFrom(maze: Grid, start: Point): number {
  const seen = new Set<number>([start.y * maze.width + start.x]);
  const queue: Point[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = (x + dx + maze.width) % maze.width;
      const ny = (y + dy + maze.height) % maze.height;
      const key = ny * maze.width + nx;
      if (!seen.has(key) && cellAt(maze, { x: nx, y: ny }) === "open") {
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen.size;
}

function allReachable(maze: Grid): boolean {
  const open = openCells(maze);
  return open.length > 0 && reachableFrom(maze, open[0]) === open.length;
}

function serialise(maze: Grid): string {
  return `${maze.width}x${maze.height}:${maze.cells.map((c) => (c === "open" ? "." : "#")).join("")}`;
}

describe("2.1 Maze: generated from a seed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [64, 40],
    [40, 64],
    [80, 50],
    [24, 16],
  ])("is a %i x %i grid of open cells and walls", (width, height) => {
    const maze = generateMaze(42, width, height);

    expect(maze.width).toBe(width);
    expect(maze.height).toBe(height);
    expect(maze.cells).toHaveLength(width * height);
    for (const cell of maze.cells) {
      expect(["open", "wall"]).toContain(cell);
    }
  });

  it.each([0, 1, 42, 123456789, 2 ** 31, 2 ** 32 - 1])(
    "gives the same maze for the same seed (%d)",
    (seed) => {
      expect(generateMaze(seed, W, H)).toEqual(generateMaze(seed, W, H));
    },
  );

  it("gives the same maze for a seed whatever was generated before it", () => {
    const first = generateMaze(7, W, H);
    generateMaze(8, W, H);
    generateMaze(9, 40, 24);
    expect(generateMaze(7, W, H)).toEqual(first);
  });

  it("gives different mazes for different seeds", () => {
    expect(serialise(generateMaze(1, W, H))).not.toBe(
      serialise(generateMaze(2, W, H)),
    );
    expect(serialise(generateMaze(0, W, H))).not.toBe(
      serialise(generateMaze(1, W, H)),
    );

    const distinct = new Set(manyMazes().map(({ maze }) => serialise(maze)));
    expect(distinct.size).toBeGreaterThan(SEED_COUNT - 10);
  });

  it("takes its randomness from the seed, not from Math.random", () => {
    const random = vi.spyOn(Math, "random");
    generateMaze(5, W, H);
    expect(random).not.toHaveBeenCalled();
  });

  // Guards against a trivially connected "maze": an open field, or a grid that is all wall.
  it("is a maze: at least a tenth of the cells are walls and at least a tenth are open", () => {
    const failing = manyMazes()
      .filter(({ maze }) => {
        const open = maze.cells.filter((c) => c === "open").length;
        const walls = maze.cells.length - open;
        return open < maze.cells.length / 10 || walls < maze.cells.length / 10;
      })
      .map(({ seed }) => seed);
    expect(failing).toEqual([]);
  });

  it("is plain data that can be copied", () => {
    const maze = generateMaze(3, W, H);
    expect(structuredClone(maze)).toEqual(maze);
  });

  it.each([
    [0, H],
    [W, 0],
    [-1, H],
    [W, -4],
    [10.5, H],
    [W, 2.5],
    [Number.NaN, H],
    [W, Number.POSITIVE_INFINITY],
  ])("rejects a %s x %s maze", (width, height) => {
    expect(() => generateMaze(1, width, height)).toThrow(RangeError);
  });
});

describe("2.1 Maze: every open cell is reachable (6.2)", () => {
  it(`holds for ${SEED_COUNT} random seeds`, () => {
    const unreachable = manyMazes()
      .filter(({ maze }) => !allReachable(maze))
      .map(({ seed }) => seed);
    expect(unreachable).toEqual([]);
  });

  it.each([
    [40, 64],
    [80, 50],
    [24, 16],
  ])("holds at size %i x %i", (width, height) => {
    const unreachable = randomSeeds(100).filter(
      (seed) => !allReachable(generateMaze(seed, width, height)),
    );
    expect(unreachable).toEqual([]);
  });
});

describe("2.1 Maze: wraps around at all four edges", () => {
  // A maze sealed by a wall along an edge would never let anything wrap. There must be an
  // open passage across the left/right edge and across the top/bottom edge.
  function crossesLeftRight(maze: Grid): boolean {
    for (let y = 0; y < maze.height; y++) {
      if (
        cellAt(maze, { x: 0, y }) === "open" &&
        cellAt(maze, { x: maze.width - 1, y }) === "open"
      ) {
        return true;
      }
    }
    return false;
  }

  function crossesTopBottom(maze: Grid): boolean {
    for (let x = 0; x < maze.width; x++) {
      if (
        cellAt(maze, { x, y: 0 }) === "open" &&
        cellAt(maze, { x, y: maze.height - 1 }) === "open"
      ) {
        return true;
      }
    }
    return false;
  }

  it(`has an open passage across the left and right edges for ${SEED_COUNT} seeds`, () => {
    const sealed = manyMazes()
      .filter(({ maze }) => !crossesLeftRight(maze))
      .map(({ seed }) => seed);
    expect(sealed).toEqual([]);
  });

  it(`has an open passage across the top and bottom edges for ${SEED_COUNT} seeds`, () => {
    const sealed = manyMazes()
      .filter(({ maze }) => !crossesTopBottom(maze))
      .map(({ seed }) => seed);
    expect(sealed).toEqual([]);
  });
});
