import { describe, expect, it } from "vitest";
import { cellAt, createGrid, type Grid, type Point } from "../../src/core/grid";
import {
  createGame,
  NO_INPUT,
  type GameState,
  type InputState,
} from "../../src/core/state";
// Spec 2.7 (WP 13): these tests go on after a level is cleared; see play-on.ts.
import { playOn as step } from "../play-on";

// Spec 2.1, 2.2, 2.10, 4.3 and 9.1 WP 06 and WP 07b: the player covers a 4 x 4 footprint of
// cells, and its position (`player.x`, `player.y`) is the footprint's top-left cell. It moves
// one cell at a time in 8 directions, faster while Space is held. A position is open when
// every cell of the footprint is open, with wrap-around; walls block it, a diagonal into a
// wall slides, it never squeezes through a corner gap, and it wraps at all four edges.
// A test places the player in its own maze by copying a new game and replacing the maze and
// the player's position, so any other fields keep the values a new game starts with.

type Axis = InputState["moveX"];

const SIZE = 4; // the player's footprint is SIZE x SIZE cells (2.10)

function move(moveX: Axis, moveY: Axis, fast = false): InputState {
  return { ...NO_INPUT, moveX, moveY, fast };
}

const DIRECTIONS: [name: string, dx: Axis, dy: Axis][] = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
  ["up-left", -1, -1],
  ["up-right", 1, -1],
  ["down-left", -1, 1],
  ["down-right", 1, 1],
];
const DIAGONALS = DIRECTIONS.filter(([, dx, dy]) => dx !== 0 && dy !== 0);

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// An open grid with walls on the given cells, wrapped into the grid.
function openExcept(width: number, height: number, walls: Point[]): Grid {
  const keys = new Set(
    walls.map(({ x, y }) => `${mod(x, width)},${mod(y, height)}`),
  );
  return createGrid(width, height, ({ x, y }) =>
    keys.has(`${x},${y}`) ? "wall" : "open",
  );
}

// A grid of walls with the given cells open, wrapped into the grid.
function wallsExcept(width: number, height: number, open: Point[]): Grid {
  const keys = new Set(
    open.map(({ x, y }) => `${mod(x, width)},${mod(y, height)}`),
  );
  return createGrid(width, height, ({ x, y }) =>
    keys.has(`${x},${y}`) ? "open" : "wall",
  );
}

// The cells of the footprint with its top-left cell at `p`, not wrapped.
function footprint(p: Point): Point[] {
  const cells: Point[] = [];
  for (let dy = 0; dy < SIZE; dy++) {
    for (let dx = 0; dx < SIZE; dx++) cells.push({ x: p.x + dx, y: p.y + dy });
  }
  return cells;
}

// Whether the whole footprint at `p` is on open cells, with wrap-around (2.10).
function fits(maze: Grid, p: Point): boolean {
  return footprint(p).every((c) => cellAt(maze, c) === "open");
}

// The player alone in `maze`: no hives or snipes, which would kill it (WP 11).
function place(maze: Grid, at: Point): GameState {
  const game = createGame(1);
  return {
    ...game,
    maze,
    player: { ...game.player, x: at.x, y: at.y },
    hives: [],
    snipes: [],
  };
}

function at(state: GameState): Point {
  return { x: state.player.x, y: state.player.y };
}

// Long enough for any sensible speed to take a few steps. Even at one cell per tick the
// player stays inside the open field below in this time, without wrapping.
const PATIENCE = 60;
const field = createGrid(151, 151, () => "open");
const centre = { x: 75, y: 75 };

// Steps until the player leaves its position, or PATIENCE ticks have passed.
function stepUntilMoved(state: GameState, input: InputState): GameState {
  const start = at(state);
  let current = state;
  for (let tick = 0; tick < PATIENCE; tick++) {
    current = step(current, input);
    if (current.player.x !== start.x || current.player.y !== start.y) break;
  }
  return current;
}

// Holds the input for `ticks` ticks and returns every position, the first being the start.
function hold(state: GameState, input: InputState, ticks: number): Point[] {
  const path = [at(state)];
  let current = state;
  for (let tick = 0; tick < ticks; tick++) {
    current = step(current, input);
    path.push(at(current));
  }
  return path;
}

// The positions the player stood on, in order, without repeats for the ticks it stayed.
function distinct(path: readonly Point[]): Point[] {
  return path.filter(
    (p, i) => i === 0 || p.x !== path[i - 1].x || p.y !== path[i - 1].y,
  );
}

// For each tick, whether the player left its position on that tick.
function moveTicks(path: readonly Point[]): boolean[] {
  return path.slice(1).map((p, i) => p.x !== path[i].x || p.y !== path[i].y);
}

// Ticks until the player first moves, or Infinity if it does not in 3 * PATIENCE.
function ticksToFirstMove(state: GameState, input: InputState): number {
  const moved = moveTicks(hold(state, input, 3 * PATIENCE)).indexOf(true);
  return moved === -1 ? Infinity : moved + 1;
}

function cellsMoved(path: readonly Point[]): number {
  let moves = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i].x !== path[i - 1].x || path[i].y !== path[i - 1].y) moves++;
  }
  return moves;
}

// The positions on `path` whose footprint covers a wall.
function inWalls(maze: Grid, path: readonly Point[]): Point[] {
  return path.filter((p) => !fits(maze, p));
}

describe("2.2 Player: a new game", () => {
  it.each([0, 1, 42, 123456789, 2 ** 32 - 1])(
    "starts the player with its whole footprint on open cells inside the maze (seed %d)",
    (seed) => {
      const game = createGame(seed);
      const { x, y } = at(game);

      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(game.maze.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(game.maze.height);
      expect(fits(game.maze, { x, y })).toBe(true);
    },
  );

  it("has the same maze and start for the same seed", () => {
    expect(createGame(77).maze).toEqual(createGame(77).maze);
    expect(at(createGame(77))).toEqual(at(createGame(77)));
  });

  it("has a different maze for a different seed (2.1)", () => {
    expect(createGame(1).maze.cells).not.toEqual(createGame(2).maze.cells);
  });

  it("is a maze with walls in it, not an open field", () => {
    const { maze } = createGame(5);
    expect(maze.cells).toContain("wall");
    expect(maze.cells).toContain("open");
  });

  it("does not move while no key is held", () => {
    expect(cellsMoved(hold(createGame(8), NO_INPUT, 3 * PATIENCE))).toBe(0);
    expect(cellsMoved(hold(place(field, centre), NO_INPUT, 3 * PATIENCE))).toBe(
      0,
    );
  });

  it("does not move while only Space is held", () => {
    const path = hold(place(field, centre), move(0, 0, true), 3 * PATIENCE);
    expect(cellsMoved(path)).toBe(0);
  });

  it.each(DIRECTIONS.filter(([, dx, dy]) => dx === 0 || dy === 0))(
    "can move %s from the start: the block has room on every side (2.10)",
    (_name, dx, dy) => {
      const game = createGame(3);
      const moved = stepUntilMoved(game, move(dx, dy));
      expect(at(moved)).not.toEqual(at(game));
      expect(fits(game.maze, at(moved))).toBe(true);
    },
  );
});

describe("2.2 Player: moves one cell at a time in 8 directions", () => {
  it.each(DIRECTIONS)("moves %s by one cell", (_name, dx, dy) => {
    const moved = stepUntilMoved(place(field, centre), move(dx, dy));
    expect(at(moved)).toEqual({ x: centre.x + dx, y: centre.y + dy });
  });

  it.each(DIRECTIONS)("moves %s by one cell when fast", (_name, dx, dy) => {
    const moved = stepUntilMoved(place(field, centre), move(dx, dy, true));
    expect(at(moved)).toEqual({ x: centre.x + dx, y: centre.y + dy });
  });

  it.each(DIRECTIONS)(
    "keeps moving %s in a straight line while the key is held",
    (_name, dx, dy) => {
      const path = hold(place(field, centre), move(dx, dy), PATIENCE);
      const end = path[path.length - 1];
      const steps = Math.max(
        Math.abs(end.x - centre.x),
        Math.abs(end.y - centre.y),
      );

      expect(steps).toBeGreaterThanOrEqual(2);
      expect(end).toEqual({
        x: centre.x + steps * dx,
        y: centre.y + steps * dy,
      });
    },
  );

  it.each([false, true])(
    "never moves more than one cell in a tick (fast: %s)",
    (fast) => {
      for (const [, dx, dy] of DIRECTIONS) {
        const path = hold(place(field, centre), move(dx, dy, fast), PATIENCE);
        for (let i = 1; i < path.length; i++) {
          expect(Math.abs(path[i].x - path[i - 1].x)).toBeLessThanOrEqual(1);
          expect(Math.abs(path[i].y - path[i - 1].y)).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it.each(DIAGONALS)(
    "moves %s in one diagonal step, not as two straight steps",
    (_name, dx, dy) => {
      const path = hold(place(field, centre), move(dx, dy), PATIENCE);
      // Every tick the player either stays or takes the whole diagonal step.
      const steps = new Set<string>();
      for (let i = 1; i < path.length; i++) {
        steps.add(`${path[i].x - path[i - 1].x},${path[i].y - path[i - 1].y}`);
      }
      steps.delete("0,0");
      expect([...steps]).toEqual([`${dx},${dy}`]);
    },
  );

  it("changes direction when a different key is held", () => {
    const right = stepUntilMoved(place(field, centre), move(1, 0));
    const down = stepUntilMoved(right, move(0, 1));
    const upLeft = stepUntilMoved(down, move(-1, -1));

    expect(at(right)).toEqual({ x: centre.x + 1, y: centre.y });
    expect(at(down)).toEqual({ x: centre.x + 1, y: centre.y + 1 });
    expect(at(upLeft)).toEqual(centre);
  });

  it("stops when the key is released", () => {
    const moved = stepUntilMoved(place(field, centre), move(-1, 0));
    expect(at(moved)).toEqual({ x: centre.x - 1, y: centre.y });
    expect(cellsMoved(hold(moved, NO_INPUT, 3 * PATIENCE))).toBe(0);
  });
});

describe("2.2 Player: Space moves faster", () => {
  it.each(DIRECTIONS)(
    "covers more cells %s with Space held than without",
    (_name, dx, dy) => {
      const normal = cellsMoved(
        hold(place(field, centre), move(dx, dy), PATIENCE),
      );
      const fast = cellsMoved(
        hold(place(field, centre), move(dx, dy, true), PATIENCE),
      );

      expect(normal).toBeGreaterThanOrEqual(2);
      expect(fast).toBeGreaterThan(normal);
    },
  );

  it("slows down again when Space is released", () => {
    const start = place(field, centre);
    let state = start;
    for (let tick = 0; tick < PATIENCE; tick++) {
      state = step(state, move(1, 0, true));
    }
    const afterRelease = cellsMoved(hold(state, move(0, 1), PATIENCE));
    const normal = cellsMoved(hold(start, move(0, 1), PATIENCE));
    const fast = cellsMoved(hold(start, move(0, 1, true), PATIENCE));

    expect(afterRelease).toBeLessThan(fast);
    expect(Math.abs(afterRelease - normal)).toBeLessThanOrEqual(1);
  });
});

describe("2.10 Sizes: walls block the player's whole footprint", () => {
  // One block of the maze (2.10): 16 x 12 cells with a wall on its left and top side. The grid
  // wraps, so the block's right and bottom sides are the same walls. Its 15 x 11 open cells
  // hold the footprint at x 1 to 12 and y 1 to 8; the player starts at (6, 4).
  const block = createGrid(16, 12, ({ x, y }) =>
    x === 0 || y === 0 ? "wall" : "open",
  );
  const start = { x: 6, y: 4 };

  it.each(DIRECTIONS)(
    "stops %s at the wall of a block, its footprint never on a wall",
    (_name, dx, dy) => {
      for (const fast of [false, true]) {
        const path = hold(
          place(block, start),
          move(dx, dy, fast),
          20 * PATIENCE,
        );

        expect(path[path.length - 1]).toEqual({
          x: dx < 0 ? 1 : dx > 0 ? 12 : start.x,
          y: dy < 0 ? 1 : dy > 0 ? 8 : start.y,
        });
        expect(inWalls(block, path)).toEqual([]);
      }
    },
  );

  // Every cell on the footprint's leading side matters, not only one corner or the middle.
  const STRAIGHT = DIRECTIONS.filter(([, dx, dy]) => dx === 0 || dy === 0);
  const leading = (p: Point, dx: number, dy: number): Point[] =>
    footprint({ x: p.x + dx, y: p.y + dy }).filter(
      (c) => !footprint(p).some((f) => f.x === c.x && f.y === c.y),
    );
  const middle = { x: 6, y: 5 };

  it.each(STRAIGHT)(
    "is stopped moving %s by a single wall cell anywhere along the footprint's leading side",
    (_name, dx, dy) => {
      const cells = leading(middle, dx, dy);
      expect(cells).toHaveLength(SIZE);
      for (const wall of cells) {
        const maze = openExcept(16, 15, [wall]);
        for (const fast of [false, true]) {
          const path = hold(
            place(maze, middle),
            move(dx, dy, fast),
            3 * PATIENCE,
          );
          expect(cellsMoved(path), `wall at ${wall.x},${wall.y}`).toBe(0);
        }
      }
    },
  );

  it.each(STRAIGHT)(
    "passes %s next to a wall cell just beside its leading side",
    (_name, dx, dy) => {
      // The cells diagonally beyond the two ends of the leading side: not in the way.
      const ends = leading(middle, dx, dy);
      const beside = [
        { x: ends[0].x - Math.abs(dy), y: ends[0].y - Math.abs(dx) },
        {
          x: ends[ends.length - 1].x + Math.abs(dy),
          y: ends[ends.length - 1].y + Math.abs(dx),
        },
      ];
      const maze = openExcept(16, 15, beside);
      const moved = stepUntilMoved(place(maze, middle), move(dx, dy));
      expect(at(moved)).toEqual({ x: middle.x + dx, y: middle.y + dy });
    },
  );

  // A 4 x 4 hole in the walls: the footprint fits, but there is nowhere to go.
  const hole = wallsExcept(10, 10, footprint({ x: 3, y: 3 }));

  it.each(DIRECTIONS)(
    "cannot move %s out of a hole exactly its size",
    (_name, dx, dy) => {
      for (const fast of [false, true]) {
        const path = hold(
          place(hole, { x: 3, y: 3 }),
          move(dx, dy, fast),
          3 * PATIENCE,
        );
        expect(cellsMoved(path)).toBe(0);
      }
    },
  );

  // A corridor exactly as high as the footprint, rows 1 to 4, open from x = 1 to x = 20.
  const corridor = createGrid(24, 6, ({ x, y }) =>
    y >= 1 && y <= 4 && x >= 1 && x <= 20 ? "open" : "wall",
  );

  it("walks a corridor as high as itself to its end and stops at the wall", () => {
    const path = hold(
      place(corridor, { x: 1, y: 1 }),
      move(1, 0),
      40 * PATIENCE,
    );
    expect(path[path.length - 1]).toEqual({ x: 17, y: 1 });
    expect(inWalls(corridor, path)).toEqual([]);
  });

  it("stops at the first wall cell in its way, even a single one", () => {
    const pillar = createGrid(24, 6, ({ x, y }) =>
      cellAt(corridor, { x, y }) === "wall" || (x === 12 && y === 3)
        ? "wall"
        : "open",
    );
    const path = hold(place(pillar, { x: 1, y: 1 }), move(1, 0), 40 * PATIENCE);
    expect(path[path.length - 1]).toEqual({ x: 8, y: 1 });
    expect(inWalls(pillar, path)).toEqual([]);
  });

  it("never covers a wall when a diagonal leads into one", () => {
    // Up-right from (1, 1) in the corridor: the diagonal position always covers row 0.
    const path = hold(
      place(corridor, { x: 1, y: 1 }),
      move(1, -1),
      40 * PATIENCE,
    );
    expect(inWalls(corridor, path)).toEqual([]);
    // It slides right along the top wall (2.2) to the end of the corridor.
    expect(path[path.length - 1]).toEqual({ x: 17, y: 1 });
  });

  it("can move another way after being blocked", () => {
    let state = place(block, start);
    for (let tick = 0; tick < 20 * PATIENCE; tick++) {
      state = step(state, move(1, 0));
    }
    expect(at(state)).toEqual({ x: 12, y: 4 });

    const turned = stepUntilMoved(state, move(-1, 0));
    expect(at(turned)).toEqual({ x: 11, y: 4 });
  });
});

describe("2.2 Player: a diagonal into a wall slides (2.10 footprint)", () => {
  // An open grid with at most three wall cells. Holding a diagonal from P, the footprint can
  // go to the diagonal position D, the horizontal position H or the vertical position V. Each
  // of the three has one cell that neither of the others covers; a wall there shuts that
  // position and no other. Neighbours wrap (2.1), so the player also starts in the corner its
  // diagonal leaves through, with all three positions across the edges.
  const W = 11;
  const H = 10;

  type Outcome = "diagonal" | "horizontal" | "vertical" | "stays";
  const RULES: [
    diagonal: boolean,
    horizontal: boolean,
    vertical: boolean,
    outcome: Outcome,
  ][] = [
    [true, true, true, "diagonal"],
    [true, true, false, "diagonal"],
    [true, false, true, "diagonal"],
    [true, false, false, "stays"], // a corner gap (2.1, 2.10)
    [false, true, true, "horizontal"],
    [false, true, false, "horizontal"],
    [false, false, true, "vertical"],
    [false, false, false, "stays"],
  ];

  const STARTS: [where: string, from: (dx: Axis, dy: Axis) => Point][] = [
    ["in the middle", () => ({ x: 3, y: 3 })],
    [
      "across the edges",
      (dx, dy) => ({ x: dx < 0 ? 0 : W - SIZE, y: dy < 0 ? 0 : H - SIZE }),
    ],
  ];

  // The one cell that only D, only H or only V covers.
  function onlyCells(p: Point, dx: number, dy: number) {
    const newCol = dx > 0 ? p.x + SIZE : p.x - 1;
    const newRow = dy > 0 ? p.y + SIZE : p.y - 1;
    return {
      diagonal: { x: newCol, y: newRow },
      horizontal: { x: newCol, y: dy > 0 ? p.y : p.y + SIZE - 1 },
      vertical: { x: dx > 0 ? p.x : p.x + SIZE - 1, y: newRow },
    };
  }

  const word = (open: boolean): string => (open ? "open" : "shut");

  const cases = DIAGONALS.flatMap(([name, dx, dy]) =>
    STARTS.flatMap(([where, from]) =>
      RULES.map(
        ([diagonal, horizontal, vertical, outcome]) =>
          [
            `${name} ${where}, diagonal ${word(diagonal)}, horizontal ${word(horizontal)}, vertical ${word(vertical)}: ${outcome}`,
            dx,
            dy,
            from(dx, dy),
            diagonal,
            horizontal,
            vertical,
            outcome,
          ] as const,
      ),
    ),
  );

  it.each(cases)(
    "%s",
    (_name, dx, dy, from, diagonal, horizontal, vertical, outcome) => {
      const only = onlyCells(from, dx, dy);
      const walls: Point[] = [];
      if (!diagonal) walls.push(only.diagonal);
      if (!horizontal) walls.push(only.horizontal);
      if (!vertical) walls.push(only.vertical);
      const maze = openExcept(W, H, walls);

      // The test's own check that each wall shuts exactly the position it is meant to.
      expect(fits(maze, { x: from.x + dx, y: from.y + dy })).toBe(diagonal);
      expect(fits(maze, { x: from.x + dx, y: from.y })).toBe(horizontal);
      expect(fits(maze, { x: from.x, y: from.y + dy })).toBe(vertical);

      for (const fast of [false, true]) {
        const start = place(maze, from);
        if (outcome === "stays") {
          const path = hold(start, move(dx, dy, fast), 3 * PATIENCE);
          expect(cellsMoved(path)).toBe(0);
          continue;
        }
        const target =
          outcome === "diagonal"
            ? { x: from.x + dx, y: from.y + dy }
            : outcome === "horizontal"
              ? { x: from.x + dx, y: from.y }
              : { x: from.x, y: from.y + dy };
        const moved = stepUntilMoved(start, move(dx, dy, fast));
        expect(at(moved)).toEqual({ x: mod(target.x, W), y: mod(target.y, H) });
      }
    },
  );

  // Down-right from (1, 1): the upper corridor (rows 1 to 4) is open from x = 1 to 20, the
  // lower one (rows 5 to 8) only from x = 10. The player slides right along the wall below it
  // until the footprint can step down diagonally at x = 9, steps diagonally to (13, 5), where
  // the bottom wall stops the diagonal, and slides right to the end at x = 17.
  const ledge = createGrid(22, 10, ({ x, y }) =>
    x >= 1 && x <= 20 && ((y >= 1 && y <= 4) || (y >= 5 && y <= 8 && x >= 10))
      ? "open"
      : "wall",
  );
  const ledgePath: Point[] = [
    ...Array.from({ length: 9 }, (_, i) => ({ x: 1 + i, y: 1 })),
    { x: 10, y: 2 },
    { x: 11, y: 3 },
    { x: 12, y: 4 },
    { x: 13, y: 5 },
    { x: 14, y: 5 },
    { x: 15, y: 5 },
    { x: 16, y: 5 },
    { x: 17, y: 5 },
  ];

  it.each([false, true])(
    "slides along a wall and steps diagonally again where it ends (fast: %s)",
    (fast) => {
      const path = hold(
        place(ledge, { x: 1, y: 1 }),
        move(1, 1, fast),
        40 * PATIENCE,
      );
      expect(distinct(path)).toEqual(ledgePath);
    },
  );

  it.each([false, true])(
    "slides vertically along a wall when the horizontal position is shut too (fast: %s)",
    (fast) => {
      // The same corridors mirrored on their diagonal: the walls now block the horizontal step.
      const transposed = createGrid(ledge.height, ledge.width, ({ x, y }) =>
        cellAt(ledge, { x: y, y: x }),
      );
      const path = hold(
        place(transposed, { x: 1, y: 1 }),
        move(1, 1, fast),
        40 * PATIENCE,
      );
      expect(distinct(path)).toEqual(
        ledgePath.map(({ x, y }) => ({ x: y, y: x })),
      );
    },
  );

  // Corridors exactly as wide as the footprint; they wrap round at their ends.
  const across = createGrid(151, 6, ({ y }) =>
    y >= 1 && y <= SIZE ? "open" : "wall",
  );
  const downwards = createGrid(6, 151, ({ x }) =>
    x >= 1 && x <= SIZE ? "open" : "wall",
  );

  it.each(DIAGONALS)(
    "slides %s along a corridor as one normal step at a time, tick for tick",
    (_name, dx, dy) => {
      for (const fast of [false, true]) {
        const sideways = hold(
          place(across, { x: 75, y: 1 }),
          move(dx, dy, fast),
          PATIENCE,
        );
        const straight = hold(
          place(across, { x: 75, y: 1 }),
          move(dx, 0, fast),
          PATIENCE,
        );
        expect(cellsMoved(straight)).toBeGreaterThanOrEqual(2);
        expect(sideways).toEqual(straight);

        const upOrDown = hold(
          place(downwards, { x: 1, y: 75 }),
          move(dx, dy, fast),
          PATIENCE,
        );
        const vertical = hold(
          place(downwards, { x: 1, y: 75 }),
          move(0, dy, fast),
          PATIENCE,
        );
        expect(cellsMoved(vertical)).toBeGreaterThanOrEqual(2);
        expect(upOrDown).toEqual(vertical);
      }
    },
  );

  it.each(DIAGONALS)(
    "takes a diagonal step %s as often as a straight step",
    (_name, dx, dy) => {
      for (const fast of [false, true]) {
        const diagonal = hold(
          place(field, centre),
          move(dx, dy, fast),
          PATIENCE,
        );
        const straight = hold(
          place(field, centre),
          move(dx, 0, fast),
          PATIENCE,
        );
        expect(cellsMoved(diagonal)).toBeGreaterThanOrEqual(2);
        expect(moveTicks(diagonal)).toEqual(moveTicks(straight));
      }
    },
  );
});

describe("2.1 Maze: no corner gaps for the player's footprint (2.10)", () => {
  // Two 4 x 4 holes that overlap diagonally: the footprint fits in each, but between them
  // both straight positions cover a wall, so the walls touch at a corner in the way.
  function rooms(width: number, height: number, a: Point): Grid {
    return wallsExcept(width, height, [
      ...footprint(a),
      ...footprint({ x: a.x + 1, y: a.y + 1 }),
    ]);
  }

  it.each([false, true])(
    "cannot pass diagonally between two walls that touch at a corner (fast: %s)",
    (fast) => {
      const maze = rooms(12, 11, { x: 3, y: 3 });
      expect(fits(maze, { x: 4, y: 4 })).toBe(true);

      const down = hold(
        place(maze, { x: 3, y: 3 }),
        move(1, 1, fast),
        4 * PATIENCE,
      );
      expect(cellsMoved(down)).toBe(0);
      const up = hold(
        place(maze, { x: 4, y: 4 }),
        move(-1, -1, fast),
        4 * PATIENCE,
      );
      expect(cellsMoved(up)).toBe(0);
    },
  );

  it.each([false, true])(
    "cannot pass through a corner gap across the edges (fast: %s)",
    (fast) => {
      // One hole has its top-left cell in the grid's bottom-right corner, the other in its
      // top-left corner, so the diagonal step between them crosses two edges.
      const W = 12;
      const H = 11;
      const maze = rooms(W, H, { x: W - 1, y: H - 1 });
      expect(fits(maze, { x: W - 1, y: H - 1 })).toBe(true);
      expect(fits(maze, { x: 0, y: 0 })).toBe(true);

      const downRight = hold(
        place(maze, { x: W - 1, y: H - 1 }),
        move(1, 1, fast),
        4 * PATIENCE,
      );
      expect(cellsMoved(downRight)).toBe(0);
      const upLeft = hold(
        place(maze, { x: 0, y: 0 }),
        move(-1, -1, fast),
        4 * PATIENCE,
      );
      expect(cellsMoved(upLeft)).toBe(0);
    },
  );

  it.each([false, true])(
    "passes diagonally once one straight position opens (fast: %s)",
    (fast) => {
      // The same holes with the cell that shuts the horizontal position opened.
      const maze = createGrid(12, 11, ({ x, y }) =>
        x === 7 && y === 3
          ? "open"
          : cellAt(rooms(12, 11, { x: 3, y: 3 }), { x, y }),
      );
      const moved = stepUntilMoved(
        place(maze, { x: 3, y: 3 }),
        move(1, 1, fast),
      );
      expect(at(moved)).toEqual({ x: 4, y: 4 });
    },
  );
});

describe("2.2 Player: staying put does not use up a step", () => {
  // A dead end: a corridor as high as the footprint, open from x = 75 rightwards, with the
  // player at its closed end, so all of these directions keep it where it is.
  const deadEnd = createGrid(151, 6, ({ x, y }) =>
    y >= 1 && y <= SIZE && x >= 75 ? "open" : "wall",
  );
  const end = { x: 75, y: 1 };
  const BLOCKED: [name: string, dx: Axis, dy: Axis][] = [
    ["left", -1, 0],
    ["up", 0, -1],
    ["down", 0, 1],
    ["up-left", -1, -1],
    ["down-left", -1, 1],
  ];

  it.each(BLOCKED)(
    "holding %s against the wall does not delay the next step",
    (_name, dx, dy) => {
      for (const fast of [false, true]) {
        let blocked = place(deadEnd, end);
        let idle = blocked;
        for (let ticks = 1; ticks <= PATIENCE; ticks++) {
          blocked = step(blocked, move(dx, dy, fast));
          idle = step(idle, move(0, 0, fast));
          expect(at(blocked)).toEqual(end);

          // Turning to the open side after `ticks` ticks against the wall moves the player
          // no later than after the same time with no direction held.
          const right = move(1, 0, fast);
          const afterIdle = ticksToFirstMove(idle, right);
          expect(afterIdle).toBeLessThan(Infinity);
          expect(ticksToFirstMove(blocked, right)).toBeLessThanOrEqual(
            afterIdle,
          );
        }
      }
    },
  );
});

describe("2.1 Maze / 2.2 Player: the footprint wraps around at all four edges", () => {
  // An open field with walls nowhere; the player's position crosses an edge.
  const W = 13;
  const H = 11;
  const open = createGrid(W, H, () => "open");

  const crossings: [
    edge: string,
    from: Point,
    dx: Axis,
    dy: Axis,
    to: Point,
  ][] = [
    ["left", { x: 0, y: 3 }, -1, 0, { x: W - 1, y: 3 }],
    ["right", { x: W - 1, y: 3 }, 1, 0, { x: 0, y: 3 }],
    ["top", { x: 4, y: 0 }, 0, -1, { x: 4, y: H - 1 }],
    ["bottom", { x: 4, y: H - 1 }, 0, 1, { x: 4, y: 0 }],
    // Diagonals that cross one edge only.
    ["left edge up-left", { x: 0, y: 3 }, -1, -1, { x: W - 1, y: 2 }],
    ["right edge down-right", { x: W - 1, y: 3 }, 1, 1, { x: 0, y: 4 }],
    ["top edge up-right", { x: 4, y: 0 }, 1, -1, { x: 5, y: H - 1 }],
    ["bottom edge down-left", { x: 4, y: H - 1 }, -1, 1, { x: 3, y: 0 }],
    // Diagonals through the four corners, crossing two edges at once.
    ["top-left corner", { x: 0, y: 0 }, -1, -1, { x: W - 1, y: H - 1 }],
    ["top-right corner", { x: W - 1, y: 0 }, 1, -1, { x: 0, y: H - 1 }],
    ["bottom-left corner", { x: 0, y: H - 1 }, -1, 1, { x: W - 1, y: 0 }],
    ["bottom-right corner", { x: W - 1, y: H - 1 }, 1, 1, { x: 0, y: 0 }],
  ];

  it.each(crossings)("crosses the %s", (_edge, from, dx, dy, to) => {
    for (const fast of [false, true]) {
      const moved = stepUntilMoved(place(open, from), move(dx, dy, fast));
      expect(at(moved)).toEqual(to);
    }
  });

  it.each([false, true])(
    "keeps the player's position inside the grid on a long walk (fast: %s)",
    (fast) => {
      for (const [, dx, dy] of DIRECTIONS) {
        const path = hold(
          place(open, { x: 4, y: 3 }),
          move(dx, dy, fast),
          10 * PATIENCE,
        );
        for (const p of path) {
          expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThan(W);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThan(H);
        }
        // Walking on and on, the player goes round the grid more than once.
        expect(cellsMoved(path)).toBeGreaterThan(Math.max(W, H));
      }
    },
  );

  // A wall line across the grid, and a player whose next position would put a footprint cell
  // on it across an edge: by the leading side wrapping, or with the footprint itself already
  // split over the edge.
  const BLOCKS: [
    name: string,
    wall: (p: Point) => boolean,
    from: Point,
    dx: Axis,
    dy: Axis,
  ][] = [
    [
      "left, the wall on the far side",
      ({ x }) => x === W - 1,
      { x: 0, y: 3 },
      -1,
      0,
    ],
    [
      "right, the wall on the far side",
      ({ x }) => x === 0,
      { x: W - SIZE, y: 3 },
      1,
      0,
    ],
    [
      "up, the wall on the far side",
      ({ y }) => y === H - 1,
      { x: 4, y: 0 },
      0,
      -1,
    ],
    [
      "down, the wall on the far side",
      ({ y }) => y === 0,
      { x: 4, y: H - SIZE },
      0,
      1,
    ],
    [
      "right, the footprint split over the edge",
      ({ x }) => x === 2,
      { x: W - 2, y: 3 },
      1,
      0,
    ],
    [
      "left, the footprint split over the edge",
      ({ x }) => x === W - 3,
      { x: W - 2, y: 3 },
      -1,
      0,
    ],
    [
      "down, the footprint split over the edge",
      ({ y }) => y === 2,
      { x: 4, y: H - 2 },
      0,
      1,
    ],
    [
      "up, the footprint split over the edge",
      ({ y }) => y === H - 3,
      { x: 4, y: H - 2 },
      0,
      -1,
    ],
  ];

  it.each(BLOCKS)("is blocked moving %s", (_name, wall, from, dx, dy) => {
    const walled = createGrid(W, H, (p) => (wall(p) ? "wall" : "open"));
    expect(fits(walled, from)).toBe(true);
    for (const fast of [false, true]) {
      const path = hold(place(walled, from), move(dx, dy, fast), 3 * PATIENCE);
      expect(cellsMoved(path)).toBe(0);
    }
  });

  it.each(BLOCKS)(
    "moves the other way from the same place (%s)",
    (_name, wall, from, dx, dy) => {
      const walled = createGrid(W, H, (p) => (wall(p) ? "wall" : "open"));
      const moved = stepUntilMoved(
        place(walled, from),
        move((0 - dx) as Axis, (0 - dy) as Axis),
      );
      expect(at(moved)).toEqual({
        x: mod(from.x - dx, W),
        y: mod(from.y - dy, H),
      });
    },
  );

  it("never covers a wall diagonally across a corner, and slides instead", () => {
    // The only wall is the bottom-right cell. Up-left from (0, 0) the diagonal position
    // (W - 1, H - 1) covers it; the horizontal position (W - 1, 0) does not.
    const walled = openExcept(W, H, [{ x: W - 1, y: H - 1 }]);
    const moved = stepUntilMoved(place(walled, { x: 0, y: 0 }), move(-1, -1));
    expect(at(moved)).toEqual({ x: W - 1, y: 0 });

    const path = hold(
      place(walled, { x: 0, y: 0 }),
      move(-1, -1),
      3 * PATIENCE,
    );
    expect(inWalls(walled, path)).toEqual([]);
  });
});

describe("4.3 step(state, input) with movement", () => {
  it("does not change the state it is given", () => {
    const state = place(field, centre);
    const before = structuredClone(state);
    for (const [, dx, dy] of DIRECTIONS) {
      step(state, move(dx, dy, true));
    }
    expect(state).toEqual(before);
  });

  it("does not change the input it is given", () => {
    const input = move(1, -1, true);
    const before = structuredClone(input);
    step(place(field, centre), input);
    expect(input).toEqual(before);
  });

  it("gives the same next state for the same state and input", () => {
    let a = createGame(21);
    let b = createGame(21);
    for (let tick = 0; tick < 4 * PATIENCE; tick++) {
      const [, dx, dy] = DIRECTIONS[Math.floor(tick / 10) % DIRECTIONS.length];
      const input = move(dx, dy, tick % 3 === 0);
      a = step(a, input);
      b = step(b, input);
    }
    expect(a).toEqual(b);
  });

  it("keeps the maze unchanged while the player moves", () => {
    const game = createGame(4);
    let state = game;
    for (const [, dx, dy] of DIRECTIONS) {
      for (let tick = 0; tick < PATIENCE; tick++) {
        state = step(state, move(dx, dy, true));
      }
    }
    expect(state.maze).toEqual(game.maze);
  });
});
