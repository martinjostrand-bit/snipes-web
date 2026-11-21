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

// Spec 2.2, 2.5, 4.3, 6.2 and 9.1 WP 08b: whole games at 60 ticks/s, run headless from a seed
// and scripted input in which keys are pressed and released at random, often for only a tick
// or two. Every tick is checked against the test's own model of the speed rules:
//
// - The player steps on the first tick a direction is held, the previous wait is over and a
//   move is possible (2.2, 2.10); after a step it waits 2 more ticks, or 1 if Space was held at
//   that step. Staying put does not use up a step.
// - Every shot in flight moves exactly one cell along its line per tick, until its next
//   position is a wall or a corner gap (2.1, 2.5, 2.10).
// - A shot fires on a tick a fire key is held, Space is not held and at least 13 ticks have
//   passed since the last shot, unless a wall is where it would start; then it uses no time.
//   It appears just outside the player's footprint (2.10), before or after this tick's step.

type Axis = InputState["moveX"];

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)
const STEP_TICKS = 3;
const FAST_STEP_TICKS = 2;
const FIRE_TICKS = 13;
const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7919 + 5);
const TICKS = 60 * 60; // one minute at 60 ticks/s (4.3)
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

function fits(maze: Grid, p: Point, size: number): boolean {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (cellAt(maze, { x: p.x + dx, y: p.y + dy }) !== "open") return false;
    }
  }
  return true;
}

function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function at(state: GameState): Point {
  return { x: state.player.x, y: state.player.y };
}

// The only position the player may move to from `from` with `input` held (2.1, 2.2, 2.10),
// or null if it must stay put.
function allowedMove(
  maze: Grid,
  from: Point,
  { moveX, moveY }: InputState,
): Point | null {
  const open = (dx: number, dy: number): boolean =>
    fits(maze, { x: from.x + dx, y: from.y + dy }, PLAYER);
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

// Spec 2.10: where a player's shot appears, wrapped into the grid.
function spawnFor(maze: Grid, player: Point, dx: number, dy: number): Point {
  return wrap(maze, {
    x: dx < 0 ? player.x - SHOT : dx > 0 ? player.x + PLAYER : player.x + 1,
    y: dy < 0 ? player.y - SHOT : dy > 0 ? player.y + PLAYER : player.y + 1,
  });
}

// Spec 2.1, 2.5 and 2.10: whether a shot at `p` flying (dx, dy) is stopped by a wall or a
// corner gap at its next step.
function shotBlocked(maze: Grid, p: Point, dx: number, dy: number): boolean {
  const next = { x: p.x + dx, y: p.y + dy };
  return (
    !fits(maze, next, SHOT) ||
    (dx !== 0 &&
      dy !== 0 &&
      !fits(maze, { x: next.x, y: p.y }, SHOT) &&
      !fits(maze, { x: p.x, y: next.y }, SHOT))
  );
}

// Plays `ticks` ticks, holding new keys every 1 to `hold` ticks. Three times in four the
// movement keys are a straight direction in which the footprint has room, so the player gets
// around; otherwise any direction or none. Space is held one time in three, and a fire key
// (any of the 8 directions) two times in three.
function play(
  start: GameState,
  seed: number,
  ticks: number,
  hold: number,
  onTick: (
    before: GameState,
    after: GameState,
    input: InputState,
    tick: number,
  ) => void,
): GameState {
  const draw = drawer(seed);
  let state = start;
  let tick = 1;
  while (tick <= ticks) {
    let input: InputState = {
      ...NO_INPUT,
      moveX: AXES[draw(3)],
      moveY: AXES[draw(3)],
      fast: draw(3) === 0,
    };
    if (draw(4) > 0) {
      const room = STRAIGHT.filter(([dx, dy]) =>
        fits(
          state.maze,
          { x: state.player.x + dx, y: state.player.y + dy },
          PLAYER,
        ),
      );
      if (room.length > 0) {
        const [moveX, moveY] = room[draw(room.length)];
        input = { ...input, moveX, moveY };
      }
    }
    if (draw(3) > 0) {
      let fireX: Axis = 0;
      let fireY: Axis = 0;
      while (fireX === 0 && fireY === 0) {
        fireX = AXES[draw(3)];
        fireY = AXES[draw(3)];
      }
      input = { ...input, fireX, fireY };
    }
    for (let i = 1 + draw(hold); i > 0 && tick <= ticks; i--, tick++) {
      const before = state;
      state = step(state, input);
      onTick(before, state, input, tick);
    }
  }
  return state;
}

// A rough, seeded grid: about one cell in twenty is a wall, scattered, so the footprint meets
// corner gaps, dead ends and walls to slide along everywhere, unlike a generated maze.
function roughGrid(seed: number, width: number, height: number): Grid {
  const draw = drawer(seed);
  return createGrid(width, height, () => (draw(20) === 0 ? "wall" : "open"));
}

// The position in the grid where the footprint fits with the most fitting positions around.
function roomiest(maze: Grid): Point {
  let start: Point = { x: 0, y: 0 };
  let best = -1;
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      if (!fits(maze, { x, y }, PLAYER)) continue;
      let around = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (fits(maze, { x: x + dx, y: y + dy }, PLAYER)) around++;
        }
      }
      if (around > best) {
        best = around;
        start = { x, y };
      }
    }
  }
  return start;
}

interface StepReport {
  readonly problems: string[];
  readonly moves: number;
  /** Ticks a move was possible but the wait was not over. */
  readonly waited: number;
  /** Ticks the wait was over and a direction held, but no move was possible. */
  readonly blocked: number;
  readonly fastMoves: number;
}

// Plays a game and checks every tick against the model of 2.2.
function checkSteps(start: GameState, seed: number): StepReport {
  const maze = start.maze;
  const problems: string[] = [];
  let ready = 1;
  let moves = 0;
  let waited = 0;
  let blocked = 0;
  let fastMoves = 0;
  play(start, seed, TICKS, 12, (before, after, input, tick) => {
    const from = at(before);
    const held = input.moveX !== 0 || input.moveY !== 0;
    const target = held ? allowedMove(maze, from, input) : null;
    const due = tick >= ready;
    const expected = due && target !== null ? target : from;
    if (!same(at(after), expected)) {
      problems.push(
        `tick ${tick}: ${from.x},${from.y} -> ${after.player.x},${after.player.y} holding ${input.moveX},${input.moveY}${input.fast ? " with Space" : ""}, expected ${expected.x},${expected.y} (next step due on tick ${ready})`,
      );
    }
    if (target !== null && !due) waited++;
    if (held && target === null && due) blocked++;
    // Follows the game, so that one wrong tick is reported once, not on every tick after it.
    if (!same(at(after), from)) {
      ready = tick + (input.fast ? FAST_STEP_TICKS : STEP_TICKS);
      moves++;
      if (input.fast) fastMoves++;
    }
  });
  return { problems, moves, waited, blocked, fastMoves };
}

describe("2.2 Player: steps exactly on the ticks the speed rule allows (4.3)", () => {
  it.each(SEEDS)(
    "in a generated maze, keys pressed and released at random (seed %d)",
    (seed) => {
      // Without hives or snipes, which would kill the player and move it to a new place
      // (WP 11).
      const report = checkSteps(
        { ...createGame(seed), hives: [], snipes: [] },
        seed,
      );
      expect(report.problems).toEqual([]);
      // Guards: the player got around, at both speeds, and the wait and walls both held it.
      expect(report.moves).toBeGreaterThan(200);
      expect(report.fastMoves).toBeGreaterThan(50);
      expect(report.waited).toBeGreaterThan(200);
      expect(report.blocked).toBeGreaterThan(10);
    },
  );

  it.each(SEEDS.slice(0, 10))(
    "in a rough grid full of corner gaps (seed %d)",
    (seed) => {
      const game = createGame(seed);
      const maze = roughGrid(seed, 60, 45);
      const start = roomiest(maze);
      const report = checkSteps(
        {
          ...game,
          maze,
          player: { ...game.player, x: start.x, y: start.y },
          hives: [],
          snipes: [],
        },
        seed + 1,
      );
      expect(report.problems).toEqual([]);
      expect(report.moves).toBeGreaterThan(50);
      expect(report.waited).toBeGreaterThan(50);
      expect(report.blocked).toBeGreaterThan(10);
    },
  );
});

describe("2.5 Bullets: shot speed and fire rate over whole games (2.2, 4.3)", () => {
  it.each(SEEDS)(
    "in a generated maze, moving and firing at random (seed %d)",
    (seed) => {
      // Without hives or snipes (WP 09), so that only walls stop the shots.
      const game: GameState = { ...createGame(seed), hives: [], snipes: [] };
      const maze = game.maze;
      const problems: string[] = [];
      let lastShot: number | undefined;
      let fired = 0;
      let stopped = 0;
      let refusedForSpace = 0;
      let refusedForWait = 0;

      play(game, seed, TICKS, 20, (before, after, input, tick) => {
        // Every shot in flight moves exactly one cell along its line, or stops at a wall.
        const left = new Map<string, number>();
        const key = (s: { x: number; y: number; dx: number; dy: number }) =>
          `${s.x},${s.y},${s.dx},${s.dy}`;
        for (const s of after.shots)
          left.set(key(s), (left.get(key(s)) ?? 0) + 1);
        for (const s of before.shots) {
          if (shotBlocked(maze, s, s.dx, s.dy)) {
            stopped++;
            continue;
          }
          const next = {
            ...wrap(maze, { x: s.x + s.dx, y: s.y + s.dy }),
            dx: s.dx,
            dy: s.dy,
          };
          const count = left.get(key(next)) ?? 0;
          if (count === 0) {
            problems.push(
              `tick ${tick}: the shot at ${s.x},${s.y} going ${s.dx},${s.dy} did not move one cell on`,
            );
          } else {
            left.set(key(next), count - 1);
          }
        }

        // What is left is new: at most one shot, fired by the rules.
        const added = after.shots.filter((s) => {
          const count = left.get(key(s)) ?? 0;
          if (count === 0) return false;
          left.set(key(s), count - 1);
          return true;
        });
        const held = input.fireX !== 0 || input.fireY !== 0;
        const due = lastShot === undefined || tick - lastShot >= FIRE_TICKS;
        const spawns = [at(before), at(after)].map((p) =>
          spawnFor(maze, p, input.fireX, input.fireY),
        );
        if (added.length > 1) {
          problems.push(`tick ${tick}: ${added.length} new shots`);
        }
        for (const s of added) {
          const what = `tick ${tick}: a new shot at ${s.x},${s.y} going ${s.dx},${s.dy}`;
          if (!held) problems.push(`${what} with no fire key held`);
          else if (input.fast) problems.push(`${what} with Space held`);
          else if (!due) {
            problems.push(
              `${what} only ${tick - (lastShot ?? 0)} ticks after the last`,
            );
          } else if (s.dx !== input.fireX || s.dy !== input.fireY) {
            problems.push(`${what}, fire keys ${input.fireX},${input.fireY}`);
          } else if (!spawns.some((p) => same(p, s))) {
            problems.push(`${what}, not just outside the player`);
          }
        }
        if (added.length > 0) {
          lastShot = tick;
          fired++;
        } else if (held && !input.fast && due) {
          // Not fired: only right if a wall is where the shot would start.
          const room = spawns.map((p) => fits(maze, p, SHOT));
          if (room.every(Boolean)) {
            problems.push(
              `tick ${tick}: no shot fired going ${input.fireX},${input.fireY}, ${lastShot === undefined ? "none before" : `${tick - lastShot} ticks after the last`}`,
            );
          }
        } else if (held && input.fast && due) {
          refusedForSpace++;
        } else if (held && !due) {
          refusedForWait++;
        }
      });

      expect(problems).toEqual([]);
      // Guards: plenty of shots, stopped by walls, held back by Space and by the wait.
      expect(fired).toBeGreaterThan(50);
      expect(stopped).toBeGreaterThan(50);
      expect(refusedForSpace).toBeGreaterThan(20);
      expect(refusedForWait).toBeGreaterThan(500);
    },
  );
});
