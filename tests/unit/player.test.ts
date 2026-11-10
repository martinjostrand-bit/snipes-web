import { describe, expect, it } from "vitest";
import { cellAt, createGrid, type Grid, type Point } from "../../src/core/grid";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.1, 2.2, 4.3 and 9.1 WP 06: the player moves one cell at a time in 8 directions,
// faster while Space is held, is blocked by walls, slides along a wall when a diagonal is
// blocked, never squeezes through a corner gap and wraps around at all four edges.
// The game state holds the maze (`maze`) and the player's cell (`player.x`, `player.y`).
// A test places the player in its own maze by copying a new game and replacing those, so any
// other fields of the state and the player keep the values a new game starts with.

type Axis = InputState["moveX"];

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

// Rows of "#" (wall) and "." (open), top row first.
function gridFrom(rows: readonly string[]): Grid {
  return createGrid(rows[0].length, rows.length, ({ x, y }) =>
    rows[y][x] === "#" ? "wall" : "open",
  );
}

function place(maze: Grid, at: Point): GameState {
  const game = createGame(1);
  return { ...game, maze, player: { ...game.player, x: at.x, y: at.y } };
}

function at(state: GameState): Point {
  return { x: state.player.x, y: state.player.y };
}

// Long enough for any sensible speed to take a few steps. Even at one cell per tick the
// player stays inside the open field below in this time, without wrapping.
const PATIENCE = 60;
const field = createGrid(151, 151, () => "open");
const centre = { x: 75, y: 75 };

// Steps until the player leaves its cell, or PATIENCE ticks have passed.
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

// The cells the player stood on, in order, without repeats for the ticks it stayed.
function distinct(path: readonly Point[]): Point[] {
  return path.filter(
    (p, i) => i === 0 || p.x !== path[i - 1].x || p.y !== path[i - 1].y,
  );
}

// For each tick, whether the player left its cell on that tick.
function moveTicks(path: readonly Point[]): boolean[] {
  return path.slice(1).map((p, i) => p.x !== path[i].x || p.y !== path[i].y);
}

// Ticks until the player first leaves its cell, or Infinity if it does not in 3 * PATIENCE.
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

describe("2.2 Player: a new game", () => {
  it.each([0, 1, 42, 123456789, 2 ** 32 - 1])(
    "starts the player on an open cell inside the maze (seed %d)",
    (seed) => {
      const game = createGame(seed);
      const { x, y } = at(game);

      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(game.maze.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(game.maze.height);
      expect(cellAt(game.maze, { x, y })).toBe("open");
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

  it.each(DIRECTIONS.filter(([, dx, dy]) => dx !== 0 && dy !== 0))(
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

describe("2.2 Player: walls block the player", () => {
  // The player sits in the middle of a 3 x 3 room whose wall is two cells thick.
  const room = gridFrom([
    "#######",
    "#######",
    "##...##",
    "##...##",
    "##...##",
    "#######",
    "#######",
  ]);
  const middle = { x: 3, y: 3 };

  it.each(DIRECTIONS)("stops %s at the wall of the room", (_name, dx, dy) => {
    for (const fast of [false, true]) {
      const path = hold(place(room, middle), move(dx, dy, fast), 4 * PATIENCE);

      expect(path[path.length - 1]).toEqual({
        x: middle.x + dx,
        y: middle.y + dy,
      });
      for (const p of path) {
        expect(cellAt(room, p)).toBe("open");
      }
    }
  });

  // A cell with walls on all eight sides: there is nowhere to go.
  const cell = gridFrom(["#####", "#####", "##.##", "#####", "#####"]);

  it.each(DIRECTIONS)(
    "cannot move %s out of a walled-in cell",
    (_name, dx, dy) => {
      for (const fast of [false, true]) {
        const path = hold(
          place(cell, { x: 2, y: 2 }),
          move(dx, dy, fast),
          3 * PATIENCE,
        );
        expect(cellsMoved(path)).toBe(0);
      }
    },
  );

  it("walks a corridor to its end and stops at the first wall", () => {
    const corridor = gridFrom(["############", "#.......#..#", "############"]);
    const path = hold(
      place(corridor, { x: 1, y: 1 }),
      move(1, 0),
      20 * PATIENCE,
    );

    expect(path[path.length - 1]).toEqual({ x: 7, y: 1 });
    for (const p of path) {
      expect(cellAt(corridor, p)).toBe("open");
    }
  });

  it("never enters a wall when a diagonal leads into one", () => {
    // Up-right from (1, 2) is the wall at (2, 1); straight up and straight right are open.
    const corner = gridFrom(["#####", "#.###", "#...#", "#...#", "#####"]);
    const path = hold(place(corner, { x: 1, y: 2 }), move(1, -1), 3 * PATIENCE);
    for (const p of path) {
      expect(cellAt(corner, p)).toBe("open");
    }
    // It slides right (2.2), first to (2, 2), then to (3, 2), where every way is shut.
    expect(distinct(path)).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
  });

  it("can move another way after being blocked", () => {
    let state = place(room, middle);
    for (let tick = 0; tick < 3 * PATIENCE; tick++) {
      state = step(state, move(1, 0));
    }
    expect(at(state)).toEqual({ x: 4, y: 3 });

    const turned = stepUntilMoved(state, move(-1, 0));
    expect(at(turned)).toEqual({ x: 3, y: 3 });
  });
});

describe("2.2 Player: a diagonal into a wall slides", () => {
  // A 5 x 5 grid of walls. The player's cell is open, and so are those of the three cells on
  // the way (diagonal, horizontal, vertical) that a case names. Neighbours wrap (2.1), so the
  // player also starts in the corner its diagonal leaves through, with all three across edges.
  const SIZE = 5;
  const m = (n: number): number => (n + SIZE) % SIZE;

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
    [true, false, false, "stays"], // a corner gap (2.1)
    [false, true, true, "horizontal"],
    [false, true, false, "horizontal"],
    [false, false, true, "vertical"],
    [false, false, false, "stays"],
  ];

  const STARTS: [where: string, from: (dx: Axis, dy: Axis) => Point][] = [
    ["in the middle", () => ({ x: 2, y: 2 })],
    [
      "across the edges",
      (dx, dy) => ({ x: dx < 0 ? 0 : SIZE - 1, y: dy < 0 ? 0 : SIZE - 1 }),
    ],
  ];

  const word = (open: boolean): string => (open ? "open" : "wall");

  const cases = DIRECTIONS.filter(([, dx, dy]) => dx !== 0 && dy !== 0).flatMap(
    ([name, dx, dy]) =>
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
      const open = [from];
      if (diagonal) open.push({ x: from.x + dx, y: from.y + dy });
      if (horizontal) open.push({ x: from.x + dx, y: from.y });
      if (vertical) open.push({ x: from.x, y: from.y + dy });
      const keys = new Set(open.map(({ x, y }) => `${m(x)},${m(y)}`));
      const maze = createGrid(SIZE, SIZE, ({ x, y }) =>
        keys.has(`${x},${y}`) ? "open" : "wall",
      );

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
        expect(at(moved)).toEqual({ x: m(target.x), y: m(target.y) });
      }
    },
  );

  // Down-right from (1, 1): along the wall below to (4, 1), diagonally to (6, 3) where the
  // wall ends, then along the bottom wall to (8, 3), where every way is shut.
  const ledge = [
    "##########",
    "#........#",
    "#####....#",
    "#........#",
    "##########",
  ];
  const ledgePath: Point[] = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 2 },
    { x: 6, y: 3 },
    { x: 7, y: 3 },
    { x: 8, y: 3 },
  ];

  it.each([false, true])(
    "slides along a wall and steps diagonally again where it ends (fast: %s)",
    (fast) => {
      const maze = gridFrom(ledge);
      const path = hold(
        place(maze, { x: 1, y: 1 }),
        move(1, 1, fast),
        20 * PATIENCE,
      );
      expect(distinct(path)).toEqual(ledgePath);
    },
  );

  it.each([false, true])(
    "slides vertically along a wall when the horizontal cell is a wall too (fast: %s)",
    (fast) => {
      // The same room mirrored on its diagonal: the walls now block the horizontal step.
      const transposed = ledge[0]
        .split("")
        .map((_, x) => ledge.map((row) => row[x]).join(""));
      const maze = gridFrom(transposed);
      const path = hold(
        place(maze, { x: 1, y: 1 }),
        move(1, 1, fast),
        20 * PATIENCE,
      );
      expect(distinct(path)).toEqual(
        ledgePath.map(({ x, y }) => ({ x: y, y: x })),
      );
    },
  );

  // One-cell corridors with walls on both sides; they wrap round at their ends.
  const across = createGrid(151, 3, ({ y }) => (y === 1 ? "open" : "wall"));
  const downwards = createGrid(3, 151, ({ x }) => (x === 1 ? "open" : "wall"));

  it.each(DIRECTIONS.filter(([, dx, dy]) => dx !== 0 && dy !== 0))(
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

  it.each(DIRECTIONS.filter(([, dx, dy]) => dx !== 0 && dy !== 0))(
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

describe("2.1 Maze: no corner gaps for the player", () => {
  // Two rooms that touch only where (2, 2) and (3, 3) meet at a corner.
  const rooms = gridFrom([
    "#######",
    "#..####",
    "#..####",
    "###..##",
    "###..##",
    "#######",
  ]);

  it.each([false, true])(
    "cannot pass diagonally between two walls that touch at a corner (fast: %s)",
    (fast) => {
      const down = hold(
        place(rooms, { x: 1, y: 1 }),
        move(1, 1, fast),
        4 * PATIENCE,
      );
      expect(distinct(down)).toEqual([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]);

      const up = hold(
        place(rooms, { x: 4, y: 4 }),
        move(-1, -1, fast),
        4 * PATIENCE,
      );
      expect(distinct(up)).toEqual([
        { x: 4, y: 4 },
        { x: 3, y: 3 },
      ]);
    },
  );

  it.each([false, true])(
    "cannot pass through a corner gap across the edges (fast: %s)",
    (fast) => {
      // The rooms at the top-left and bottom-right touch only through the wrapping corner.
      const wrapped = gridFrom([
        "..####",
        "..####",
        "######",
        "######",
        "####..",
        "####..",
      ]);
      const upLeft = hold(
        place(wrapped, { x: 1, y: 1 }),
        move(-1, -1, fast),
        4 * PATIENCE,
      );
      expect(distinct(upLeft)).toEqual([
        { x: 1, y: 1 },
        { x: 0, y: 0 },
      ]);

      const downRight = hold(
        place(wrapped, { x: 4, y: 4 }),
        move(1, 1, fast),
        4 * PATIENCE,
      );
      expect(distinct(downRight)).toEqual([
        { x: 4, y: 4 },
        { x: 5, y: 5 },
      ]);
    },
  );
});

describe("2.2 Player: staying put does not use up a step", () => {
  // A dead end: the corridor at y = 1 is open from x = 75 rightwards, and the player is at
  // its closed end, so all of these directions keep it where it is.
  const deadEnd = createGrid(151, 3, ({ x, y }) =>
    y === 1 && x >= 75 ? "open" : "wall",
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

describe("2.1 Maze / 2.2 Player: wraps around at all four edges", () => {
  // An open field with walls nowhere; the player starts on an edge and crosses it.
  const W = 9;
  const H = 7;
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
    "keeps the player's cell inside the grid on a long walk (fast: %s)",
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

  it("is blocked by a wall on the far side of the left edge", () => {
    const walled = createGrid(W, H, ({ x }) => (x === W - 1 ? "wall" : "open"));
    const path = hold(place(walled, { x: 0, y: 3 }), move(-1, 0), 3 * PATIENCE);
    expect(cellsMoved(path)).toBe(0);
  });

  it("is blocked by a wall on the far side of the bottom edge", () => {
    const walled = createGrid(W, H, ({ y }) => (y === 0 ? "wall" : "open"));
    const path = hold(
      place(walled, { x: 4, y: H - 1 }),
      move(0, 1),
      3 * PATIENCE,
    );
    expect(cellsMoved(path)).toBe(0);
  });

  it("never enters a wall diagonally across a corner", () => {
    const walled = createGrid(W, H, ({ x, y }) =>
      x === W - 1 && y === H - 1 ? "wall" : "open",
    );
    const path = hold(
      place(walled, { x: 0, y: 0 }),
      move(-1, -1),
      3 * PATIENCE,
    );
    for (const p of path) {
      expect(cellAt(walled, p)).toBe("open");
    }
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
