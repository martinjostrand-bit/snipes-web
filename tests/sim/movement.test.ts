import { describe, expect, it } from "vitest";
import { cellAt, type Grid, type Point } from "../../src/core/grid";
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
// (the short way round a wrapping edge) from where it was; the maze is unchanged.

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
  onTick: (state: GameState, tick: number) => void,
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
      onTick(state, tick);
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
