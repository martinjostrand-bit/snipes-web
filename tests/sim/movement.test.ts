import { describe, expect, it } from "vitest";
import {
  cellAt,
  createGrid,
  wrap,
  type Grid,
  type Point,
} from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.1, 2.2, 6.2 and 9.1 WP 06: whole games run headless from a seed and scripted
// input. Every tick the player is inside the grid, never inside a wall and at most one cell
// (the short way round a wrapping edge) from where it was; the maze is unchanged. Every move
// is the one 2.2 allows for the keys held: straight into an open cell, a diagonal that is not
// a corner gap (2.1), or else a slide along the wall, horizontal first.

type Axis = InputState["moveX"];

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7919 + 1);
const TICKS = 30 * 60; // one minute at 30 ticks/s
const AXES: Axis[] = [-1, 0, 1];
const STRAIGHT: [Axis, Axis][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// Draws whole numbers in [0, n) from the seeded PRNG, so a script is the same on every run.
function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

function randomInput(draw: (n: number) => number): InputState {
  return {
    ...NO_INPUT,
    moveX: AXES[draw(3)],
    moveY: AXES[draw(3)],
    fast: draw(2) === 1,
  };
}

// A fixed input log: a random direction (or none) and Space state every 5 to 40 ticks.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  while (log.length < ticks) {
    const input = randomInput(draw);
    for (let i = 5 + draw(36); i > 0 && log.length < ticks; i--) {
      log.push(input);
    }
  }
  return log;
}

// A walk that explores the maze: every 5 to 24 ticks it holds a new input. Three times in
// four that is a straight direction with an open cell next to the player; otherwise it is
// any direction or none, so the player also runs into walls, straight and diagonally.
function explore(
  seed: number,
  ticks: number,
  onTick: (state: GameState, tick: number, input: InputState) => void,
): GameState {
  const draw = drawer(seed);
  let state = createGame(seed);
  let tick = 0;
  while (tick < ticks) {
    let input = randomInput(draw);
    if (draw(4) > 0) {
      const { x, y } = state.player;
      const open = STRAIGHT.filter(
        ([dx, dy]) => cellAt(state.maze, { x: x + dx, y: y + dy }) === "open",
      );
      if (open.length > 0) {
        const [moveX, moveY] = open[draw(open.length)];
        input = { ...input, moveX, moveY };
      }
    }
    for (let i = 5 + draw(20); i > 0 && tick < ticks; i--, tick++) {
      state = step(state, input);
      onTick(state, tick, input);
    }
  }
  return state;
}

function axisDistance(a: number, b: number, size: number): number {
  const d = Math.abs(a - b) % size;
  return Math.min(d, size - d);
}

function inside(maze: Grid, { x, y }: Point): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < maze.width &&
    y >= 0 &&
    y < maze.height
  );
}

// The only cell the player may move to from `from` with `input` held (2.1, 2.2), or null if it
// must stay put. A diagonal takes the diagonal cell if it is open and not a corner gap, else
// the horizontal cell, else the vertical cell, whichever is open first.
function allowedMove(
  maze: Grid,
  from: Point,
  { moveX, moveY }: InputState,
): Point | null {
  const open = (dx: number, dy: number): boolean =>
    cellAt(maze, { x: from.x + dx, y: from.y + dy }) === "open";
  const to = (dx: number, dy: number): Point =>
    wrap(maze, { x: from.x + dx, y: from.y + dy });

  if (moveX === 0 && moveY === 0) return null;
  if (moveX === 0 || moveY === 0) {
    return open(moveX, moveY) ? to(moveX, moveY) : null;
  }
  if (open(moveX, moveY) && (open(moveX, 0) || open(0, moveY))) {
    return to(moveX, moveY);
  }
  if (open(moveX, 0)) return to(moveX, 0);
  if (open(0, moveY)) return to(0, moveY);
  return null;
}

// Checks one tick: the player stayed, or took the one move 2.2 allows for the held input.
function ruleProblem(
  maze: Grid,
  before: Point,
  after: Point,
  input: InputState,
  tick: number,
): string | null {
  if (after.x === before.x && after.y === before.y) return null;
  const allowed = allowedMove(maze, before, input);
  if (allowed !== null && allowed.x === after.x && allowed.y === after.y) {
    return null;
  }
  const expected = allowed === null ? "stay" : `${allowed.x},${allowed.y}`;
  return `tick ${tick}: moved ${before.x},${before.y} -> ${after.x},${after.y} holding ${input.moveX},${input.moveY}, allowed ${expected}`;
}

// A rough, seeded grid: about one cell in three is a wall, so it is full of corner gaps,
// dead ends and walls to slide along, unlike a generated maze (spec 10).
function roughGrid(seed: number, width: number, height: number): Grid {
  const draw = drawer(seed);
  return createGrid(width, height, () => (draw(3) === 0 ? "wall" : "open"));
}

function play(seed: number, log: readonly InputState[]): GameState {
  let state = createGame(seed);
  for (const input of log) {
    state = step(state, input);
  }
  return state;
}

describe("6.2 Invariants: the player is never inside a wall", () => {
  it.each(SEEDS)("holds every tick of a minute's walk (seed %d)", (seed) => {
    const game = createGame(seed);
    const maze = game.maze;
    const visited = new Set<string>();
    const problems: string[] = [];
    let previous: Point = { x: game.player.x, y: game.player.y };

    const end = explore(seed, TICKS, (state, tick) => {
      const now = { x: state.player.x, y: state.player.y };
      if (!inside(maze, now)) {
        problems.push(`tick ${tick}: outside the grid at ${now.x},${now.y}`);
      } else if (cellAt(maze, now) !== "open") {
        problems.push(`tick ${tick}: inside a wall at ${now.x},${now.y}`);
      }
      if (
        axisDistance(previous.x, now.x, maze.width) > 1 ||
        axisDistance(previous.y, now.y, maze.height) > 1
      ) {
        problems.push(
          `tick ${tick}: jumped from ${previous.x},${previous.y} to ${now.x},${now.y}`,
        );
      }
      visited.add(`${now.x},${now.y}`);
      previous = now;
    });

    expect(problems).toEqual([]);
    expect(end.maze).toEqual(maze);
    // Guards against a player that hardly moves, which would pass the checks above.
    expect(visited.size).toBeGreaterThan(10);
  });
});

describe("2.2 Player: every move follows the movement rules", () => {
  it.each(SEEDS)("in a generated maze (seed %d)", (seed) => {
    const game = createGame(seed);
    const maze = game.maze;
    const problems: string[] = [];
    let previous: Point = { x: game.player.x, y: game.player.y };
    let moves = 0;

    explore(seed, TICKS, (state, tick, input) => {
      const after = { x: state.player.x, y: state.player.y };
      const problem = ruleProblem(maze, previous, after, input, tick);
      if (problem !== null) problems.push(problem);
      if (after.x !== previous.x || after.y !== previous.y) moves++;
      previous = after;
    });

    expect(problems).toEqual([]);
    expect(moves).toBeGreaterThan(10);
  });

  it.each(SEEDS)("in a rough grid full of corner gaps (seed %d)", (seed) => {
    const maze = roughGrid(seed, 40, 30);
    const game = createGame(seed);
    // Start on the open cell with the most open cells in its 3 x 3 neighbourhood.
    let start: Point = { x: 0, y: 0 };
    let best = -1;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        if (cellAt(maze, { x, y }) !== "open") continue;
        let around = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (cellAt(maze, { x: x + dx, y: y + dy }) === "open") around++;
          }
        }
        if (around > best) {
          best = around;
          start = { x, y };
        }
      }
    }

    let state: GameState = {
      ...game,
      maze,
      player: { ...game.player, x: start.x, y: start.y },
    };
    const problems: string[] = [];
    const visited = new Set<string>();
    inputLog(seed + 7, TICKS).forEach((input, tick) => {
      const before = { x: state.player.x, y: state.player.y };
      state = step(state, input);
      const after = { x: state.player.x, y: state.player.y };
      if (!inside(maze, after) || cellAt(maze, after) !== "open") {
        problems.push(`tick ${tick}: in a wall at ${after.x},${after.y}`);
      }
      const problem = ruleProblem(maze, before, after, input, tick);
      if (problem !== null) problems.push(problem);
      visited.add(`${after.x},${after.y}`);
    });

    expect(problems).toEqual([]);
    expect(state.maze).toEqual(maze);
    expect(visited.size).toBeGreaterThan(5);
  });
});

describe("6.2 Determinism with movement", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "seed %d and the same moving input log give the same final state",
    (seed) => {
      const log = inputLog(seed + 1, TICKS);
      expect(play(seed, log)).toEqual(play(seed, log));
    },
  );

  it("a different input log takes the player along a different path", () => {
    const path = (log: readonly InputState[]): string[] => {
      let state = createGame(3);
      return log.map((input) => {
        state = step(state, input);
        return `${state.player.x},${state.player.y}`;
      });
    };
    expect(path(inputLog(100, TICKS))).not.toEqual(path(inputLog(200, TICKS)));
  });
});
