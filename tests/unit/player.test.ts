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
// faster while Space is held, is blocked by walls and wraps around at all four edges.
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
