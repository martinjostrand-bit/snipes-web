import { afterEach, describe, expect, it, vi } from "vitest";
import type { Grid } from "../../src/core/grid";
import { generateMaze } from "../../src/core/maze";
import { createRng, nextFloat } from "../../src/core/rng";
import { createGame } from "../../src/core/state";

// Spec 2.1, 2.10, 6.2 and 9.1 WP 05 and WP 07b: a maze generated randomly from a seed, on a
// grid of square character cells. `generateMaze(seed)` gives the 256 x 240 maze for a seed:
// 16 x 20 blocks of 16 x 12 cells, each 15 x 11 open cells with a 1-cell wall on its left and
// top side where the maze has one. The same seed always gives the same maze, and every
// position where the player's 4 x 4 footprint fits is reachable from every other.
//
// Where the block grid starts is not fixed by the spec, so the tests find it: the column and
// row (modulo 16 and 12) of the vertical and horizontal wall lines, called the lattice here.

const WIDTH = 256;
const HEIGHT = 240;
const BLOCK_W = 16;
const BLOCK_H = 12;
const BLOCKS_X = WIDTH / BLOCK_W; // 16
const BLOCKS_Y = HEIGHT / BLOCK_H; // 20
const PLAYER = 4; // the player's footprint is 4 x 4 cells
const SEED_COUNT = 1000;
// Generating and checking 1,000 full-size mazes takes a few seconds.
const SLOW = 120_000;

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

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// 1 for a wall cell, 0 for an open one, row-major like the grid.
function wallsOf(maze: Grid): Uint8Array {
  const walls = new Uint8Array(maze.width * maze.height);
  for (let i = 0; i < walls.length; i++) {
    walls[i] = maze.cells[i] === "wall" ? 1 : 0;
  }
  return walls;
}

interface Lattice {
  /** Column of the vertical wall lines, modulo 16. */
  readonly ox: number;
  /** Row of the horizontal wall lines, modulo 12. */
  readonly oy: number;
}

interface Shape {
  /** The block grid, if the maze has the shape in 2.10. */
  readonly lattice: Lattice | undefined;
  /** What is wrong with the shape; empty if nothing is. */
  readonly problems: string[];
  /** Wall segments (15 cells across or 11 down between two crossings) that are walls. */
  readonly wallSegments: number;
}

const SEGMENTS = 2 * BLOCKS_X * BLOCKS_Y;

// Checks the 2.10 shape against one lattice: every wall cell lies on a wall line (so every
// block has 15 x 11 open cells and walls are 1 thick), each segment between two crossings is
// all wall or all open, and a crossing next to a wall segment is a wall. Lines are taken
// modulo the maze size, so the rules hold across the edges too.
function latticeProblems(
  walls: Uint8Array,
  { ox, oy }: Lattice,
): { problems: string[]; wallSegments: number } {
  const problems: string[] = [];
  const wall = (x: number, y: number): boolean =>
    walls[mod(y, HEIGHT) * WIDTH + mod(x, WIDTH)] === 1;
  const report = (problem: string): void => {
    if (problems.length < 5) problems.push(problem);
  };

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (
        wall(x, y) &&
        mod(x - ox, BLOCK_W) !== 0 &&
        mod(y - oy, BLOCK_H) !== 0
      ) {
        report(`wall inside a block at ${x},${y}`);
      }
    }
  }

  // across[by][bx]: the segment along the top of block (bx, by); down[by][bx]: along its left.
  const across: boolean[][] = [];
  const down: boolean[][] = [];
  let wallSegments = 0;
  for (let by = 0; by < BLOCKS_Y; by++) {
    across.push([]);
    down.push([]);
    for (let bx = 0; bx < BLOCKS_X; bx++) {
      const left = ox + bx * BLOCK_W;
      const top = oy + by * BLOCK_H;
      let acrossWalls = 0;
      for (let i = 1; i < BLOCK_W; i++) if (wall(left + i, top)) acrossWalls++;
      let downWalls = 0;
      for (let i = 1; i < BLOCK_H; i++) if (wall(left, top + i)) downWalls++;
      if (acrossWalls !== 0 && acrossWalls !== BLOCK_W - 1) {
        report(
          `horizontal segment right of ${mod(left, WIDTH)},${mod(top, HEIGHT)} is ${acrossWalls} of ${BLOCK_W - 1} cells wall`,
        );
      }
      if (downWalls !== 0 && downWalls !== BLOCK_H - 1) {
        report(
          `vertical segment below ${mod(left, WIDTH)},${mod(top, HEIGHT)} is ${downWalls} of ${BLOCK_H - 1} cells wall`,
        );
      }
      across[by].push(acrossWalls === BLOCK_W - 1);
      down[by].push(downWalls === BLOCK_H - 1);
      if (acrossWalls === BLOCK_W - 1) wallSegments++;
      if (downWalls === BLOCK_H - 1) wallSegments++;
    }
  }

  for (let by = 0; by < BLOCKS_Y; by++) {
    for (let bx = 0; bx < BLOCKS_X; bx++) {
      const x = ox + bx * BLOCK_W;
      const y = oy + by * BLOCK_H;
      const touchesWall =
        across[by][bx] ||
        across[by][mod(bx - 1, BLOCKS_X)] ||
        down[by][bx] ||
        down[mod(by - 1, BLOCKS_Y)][bx];
      if (touchesWall && !wall(x, y)) {
        report(
          `crossing at ${mod(x, WIDTH)},${mod(y, HEIGHT)} is open next to a wall`,
        );
      }
    }
  }
  return { problems, wallSegments };
}

function shapeOf(maze: Grid): Shape {
  if (maze.width !== WIDTH || maze.height !== HEIGHT) {
    return {
      lattice: undefined,
      problems: [`size ${maze.width} x ${maze.height}`],
      wallSegments: 0,
    };
  }
  const walls = wallsOf(maze);
  // Which (column mod 16, row mod 12) pairs hold a wall cell. A lattice must put every such
  // pair on one of its lines.
  const seen = new Uint8Array(BLOCK_W * BLOCK_H);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (walls[y * WIDTH + x] === 1)
        seen[(y % BLOCK_H) * BLOCK_W + (x % BLOCK_W)] = 1;
    }
  }
  let first: Shape | undefined;
  for (let oy = 0; oy < BLOCK_H; oy++) {
    for (let ox = 0; ox < BLOCK_W; ox++) {
      let fits = true;
      for (let i = 0; i < seen.length && fits; i++) {
        if (
          seen[i] === 1 &&
          i % BLOCK_W !== ox &&
          Math.floor(i / BLOCK_W) !== oy
        ) {
          fits = false;
        }
      }
      if (!fits) continue;
      const lattice = { ox, oy };
      const { problems, wallSegments } = latticeProblems(walls, lattice);
      if (problems.length === 0) return { lattice, problems, wallSegments };
      first ??= { lattice: undefined, problems, wallSegments };
    }
  }
  return (
    first ?? {
      lattice: undefined,
      problems: ["the walls do not lie on lines 16 columns and 12 rows apart"],
      wallSegments: 0,
    }
  );
}

// fit[y * WIDTH + x] is 1 when the 4 x 4 footprint with its top-left cell at (x, y) covers
// only open cells, with wrap-around (2.10).
function footprintFits(walls: Uint8Array): Uint8Array {
  const run = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let open = 1;
      for (let k = 0; k < PLAYER; k++) {
        if (walls[y * WIDTH + ((x + k) % WIDTH)] === 1) open = 0;
      }
      run[y * WIDTH + x] = open;
    }
  }
  const fit = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let open = 1;
      for (let k = 0; k < PLAYER; k++) {
        if (run[((y + k) % HEIGHT) * WIDTH + x] === 0) open = 0;
      }
      fit[y * WIDTH + x] = open;
    }
  }
  return fit;
}

// How many footprint positions there are, and how many of them are reachable from the first
// by straight steps of one cell (up, down, left, right, with wrap-around), every position on
// the way fitting too.
function reachability(fit: Uint8Array): { fits: number; reached: number } {
  let fits = 0;
  let start = -1;
  for (let i = 0; i < fit.length; i++) {
    if (fit[i] === 1) {
      fits++;
      if (start === -1) start = i;
    }
  }
  if (start === -1) return { fits: 0, reached: 0 };
  const seen = new Uint8Array(fit.length);
  const queue = new Int32Array(fit.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  const visit = (n: number): void => {
    if (fit[n] === 1 && seen[n] === 0) {
      seen[n] = 1;
      queue[tail++] = n;
    }
  };
  while (head < tail) {
    const i = queue[head++];
    const x = i % WIDTH;
    const y = (i - x) / WIDTH;
    visit(y * WIDTH + ((x + 1) % WIDTH));
    visit(y * WIDTH + ((x + WIDTH - 1) % WIDTH));
    visit(((y + 1) % HEIGHT) * WIDTH + x);
    visit(((y + HEIGHT - 1) % HEIGHT) * WIDTH + x);
  }
  return { fits, reached: tail };
}

function hashOf(walls: Uint8Array): number {
  let h = 2166136261;
  for (const cell of walls) h = Math.imul(h ^ cell, 16777619);
  return h >>> 0;
}

interface Analysis {
  readonly seed: number;
  readonly shape: Shape;
  readonly fits: number;
  readonly reached: number;
  /** A footprint position covers cells on both sides of the left/right edge. */
  readonly crossesLeftRight: boolean;
  /** A footprint position covers cells on both sides of the top/bottom edge. */
  readonly crossesTopBottom: boolean;
  readonly hash: number;
}

function analyse(seed: number, maze: Grid): Analysis {
  const shape = shapeOf(maze);
  if (maze.width !== WIDTH || maze.height !== HEIGHT) {
    return {
      seed,
      shape,
      fits: 0,
      reached: 0,
      crossesLeftRight: false,
      crossesTopBottom: false,
      hash: 0,
    };
  }
  const walls = wallsOf(maze);
  const fit = footprintFits(walls);
  let crossesLeftRight = false;
  let crossesTopBottom = false;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (fit[y * WIDTH + x] !== 1) continue;
      if (x > WIDTH - PLAYER) crossesLeftRight = true;
      if (y > HEIGHT - PLAYER) crossesTopBottom = true;
    }
  }
  return {
    seed,
    shape,
    ...reachability(fit),
    crossesLeftRight,
    crossesTopBottom,
    hash: hashOf(walls),
  };
}

// Mazes are large, so only what the tests need is kept of each.
let analyses: Analysis[] | undefined;
function manyMazes(): Analysis[] {
  analyses ??= randomSeeds(SEED_COUNT).map((seed) =>
    analyse(seed, generateMaze(seed)),
  );
  return analyses;
}

function serialise(maze: Grid): string {
  return `${maze.width}x${maze.height}:${maze.cells.map((c) => (c === "open" ? "." : "#")).join("")}`;
}

describe("2.1 Maze: generated from a seed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([0, 1, 42, 2 ** 32 - 1])(
    "is a 256 x 240 grid of open cells and walls (seed %d)",
    (seed) => {
      const maze = generateMaze(seed);

      expect(maze.width).toBe(WIDTH);
      expect(maze.height).toBe(HEIGHT);
      expect(maze.cells).toHaveLength(WIDTH * HEIGHT);
      expect(maze.cells.every((c) => c === "open" || c === "wall")).toBe(true);
    },
  );

  it.each([0, 1, 42, 123456789, 2 ** 31, 2 ** 32 - 1])(
    "gives the same maze for the same seed (%d)",
    (seed) => {
      expect(generateMaze(seed)).toEqual(generateMaze(seed));
    },
  );

  it("gives the same maze for a seed whatever was generated before it", () => {
    const first = serialise(generateMaze(7));
    generateMaze(8);
    generateMaze(9);
    expect(serialise(generateMaze(7))).toBe(first);
  });

  it(
    "gives different mazes for different seeds",
    () => {
      expect(serialise(generateMaze(1))).not.toBe(serialise(generateMaze(2)));
      expect(serialise(generateMaze(0))).not.toBe(serialise(generateMaze(1)));

      const distinct = new Set(manyMazes().map(({ hash }) => hash));
      expect(distinct.size).toBeGreaterThan(SEED_COUNT - 10);
    },
    SLOW,
  );

  it("takes its randomness from the seed, not from Math.random", () => {
    const random = vi.spyOn(Math, "random");
    generateMaze(5);
    expect(random).not.toHaveBeenCalled();
  });

  it("is plain data that can be copied", () => {
    const maze = generateMaze(3);
    expect(structuredClone(maze)).toEqual(maze);
  });
});

describe("2.10 Sizes: 15 x 11 corridors and 1-thick walls (6.2)", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "is 16 x 20 blocks of 15 x 11 open cells, walled only on block lines (seed %d)",
    (seed) => {
      const shape = shapeOf(generateMaze(seed));
      expect(shape.problems).toEqual([]);
      expect(shape.lattice).toBeDefined();
    },
  );

  it(
    `holds for ${SEED_COUNT} random seeds`,
    () => {
      const failing = manyMazes()
        .filter(({ shape }) => shape.problems.length > 0)
        .map(({ seed, shape }) => `${seed}: ${shape.problems.join("; ")}`);
      expect(failing).toEqual([]);
    },
    SLOW,
  );

  // Guards against an open field, which has the shape above but no maze in it.
  it(
    `is a maze: at least a tenth of the wall segments are walls, for ${SEED_COUNT} seeds`,
    () => {
      const open = manyMazes()
        .filter(({ shape }) => shape.wallSegments < SEGMENTS / 10)
        .map(({ seed, shape }) => `${seed}: ${shape.wallSegments}`);
      expect(open).toEqual([]);
    },
    SLOW,
  );

  it.each([0, 1, 42])(
    "a new game's maze has the same shape (seed %d)",
    (seed) => {
      const { maze } = createGame(seed);
      expect(maze.width).toBe(WIDTH);
      expect(maze.height).toBe(HEIGHT);
      expect(shapeOf(maze).problems).toEqual([]);
    },
  );
});

describe("2.10 Sizes: every footprint position is reachable (2.1, 6.2)", () => {
  it(
    `holds for ${SEED_COUNT} random seeds`,
    () => {
      const unreachable = manyMazes()
        .filter(({ fits, reached }) => fits === 0 || reached !== fits)
        .map(
          ({ seed, fits, reached }) =>
            `${seed}: ${reached} of ${fits} positions reached`,
        );
      expect(unreachable).toEqual([]);
    },
    SLOW,
  );

  it(
    "has room for the player's footprint in every block",
    () => {
      // 15 x 11 open cells hold the 4 x 4 footprint at 12 x 8 positions, in all 320 blocks.
      const cramped = manyMazes()
        .filter(({ fits }) => fits < BLOCKS_X * BLOCKS_Y * 12 * 8)
        .map(({ seed, fits }) => `${seed}: ${fits}`);
      expect(cramped).toEqual([]);
    },
    SLOW,
  );
});

describe("2.1 Maze: wraps around at all four edges", () => {
  // A maze sealed by a wall along an edge would never let anything wrap. The player's
  // footprint must fit somewhere across the left/right edge and across the top/bottom edge.
  it(
    `has a passage for the player across the left and right edges for ${SEED_COUNT} seeds`,
    () => {
      const sealed = manyMazes()
        .filter(({ crossesLeftRight }) => !crossesLeftRight)
        .map(({ seed }) => seed);
      expect(sealed).toEqual([]);
    },
    SLOW,
  );

  it(
    `has a passage for the player across the top and bottom edges for ${SEED_COUNT} seeds`,
    () => {
      const sealed = manyMazes()
        .filter(({ crossesTopBottom }) => !crossesTopBottom)
        .map(({ seed }) => seed);
      expect(sealed).toEqual([]);
    },
    SLOW,
  );
});

describe("2.10 Sizes: the player starts near the middle of a block", () => {
  // 5 open cells between the footprint and the block's left wall line and 3 above it; so 6 on
  // the right and 4 below.
  it.each([0, 1, 42, 123456789, 2 ** 31, 2 ** 32 - 1])(
    "starts 5 cells from the left wall and 3 from the top wall (seed %d)",
    (seed) => {
      const { maze, player } = createGame(seed);
      const { lattice } = shapeOf(maze);
      expect(lattice).toBeDefined();
      if (!lattice) return;
      const fromLeft = mod(player.x - lattice.ox, BLOCK_W) - 1;
      const fromTop = mod(player.y - lattice.oy, BLOCK_H) - 1;
      expect({ fromLeft, fromTop }).toEqual({ fromLeft: 5, fromTop: 3 });
    },
  );
});
