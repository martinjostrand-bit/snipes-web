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

// Spec 2.2, 2.6, 2.10, 6.2 and 9.1 WP 17: deadly walls in whole games, run headless from a
// seed, a skill level and scripted input.
//
// - The test follows, from the spec alone, when the player's step is due (2.2): it is in play,
//   a direction is held, and the wait after its last step is over. A step happens on the first
//   tick it is due, and after it the player waits 2 more ticks, or 1 if Space was held at that
//   step. Coming back after a death, it may step on the next tick.
// - On a due tick, the held direction touches a wall when it is not a plain step (2.2, 2.10):
//   a straight step whose position covers a wall, or a diagonal whose diagonal position covers
//   a wall or that goes through a corner gap.
// - At M to Z, a touch kills the player on that tick where it stood: it loses a life and is
//   out of play at once (2.2, 2.4). In every game, no cell the player covers is ever a wall
//   (6.2).
// - The pairs B and M, C and N, D and O, E and P, G and Q, H and R, I and S, J and T, K and U,
//   L and V differ only in deadly walls (2.6). From the same seed and input, the two games of
//   a pair are the same until the player first touches a wall.
//
// Lives are topped up, so that the games go on after the last one (WP 13).

type Axis = InputState["moveX"];

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const MINUTE = 60 * 60;
const SLOW = 120_000;
const AXES: Axis[] = [-1, 0, 1];

function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

// A scripted input log: new movement and fire keys every `every` ticks.
function inputLog(seed: number, ticks: number, every = 30): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  let keys = NO_INPUT;
  for (let t = 0; t < ticks; t++) {
    if (t % every === 0) {
      keys = {
        moveX: AXES[draw(3)],
        moveY: AXES[draw(3)],
        fast: draw(4) === 0,
        fireX: AXES[draw(3)],
        fireY: AXES[draw(3)],
      };
    }
    log.push(keys);
  }
  return log;
}

// Whether the player's footprint at p covers no wall, with wrap-around (2.10).
function fits(maze: Grid, p: Point): boolean {
  for (let dy = 0; dy < PLAYER; dy++) {
    for (let dx = 0; dx < PLAYER; dx++) {
      if (cellAt(maze, { x: p.x + dx, y: p.y + dy }) === "wall") return false;
    }
  }
  return true;
}

// Spec 2.2 and 2.10: whether the direction held, from p, is not a plain step.
function touches(maze: Grid, p: Point, input: InputState): boolean {
  const { moveX: dx, moveY: dy } = input;
  if (dx === 0 && dy === 0) return false;
  const open = (mx: number, my: number) =>
    fits(maze, { x: p.x + mx, y: p.y + my });
  if (dx === 0 || dy === 0) return !open(dx, dy);
  return !open(dx, dy) || (!open(dx, 0) && !open(0, dy));
}

// Follows, tick by tick, the first tick on which the player's next step may happen (2.2).
class Steps {
  private ready = 1;

  // Whether a step is due on tick `tick` from `state`, the state before it.
  due(state: GameState, tick: number, input: InputState): boolean {
    return (
      state.respawn === 0 &&
      tick >= this.ready &&
      (input.moveX !== 0 || input.moveY !== 0)
    );
  }

  // Records what tick `tick` did, from `before` to `after`.
  record(
    before: GameState,
    after: GameState,
    tick: number,
    input: InputState,
  ): void {
    const inPlay = before.respawn === 0 && after.respawn === 0;
    const moved =
      before.player.x !== after.player.x || before.player.y !== after.player.y;
    if (inPlay && moved) this.ready = tick + (input.fast ? 2 : 3);
    if (before.respawn > 0 && after.respawn === 0) this.ready = tick + 1;
  }
}

// What the rules decide in a tick, but the skill level.
function plain(s: GameState) {
  return {
    rng: s.rng,
    player: s.player,
    hives: s.hives,
    snipes: s.snipes,
    ghosts: s.ghosts,
    shots: s.shots,
    snipeShots: s.snipeShots,
    lives: s.lives,
    respawn: s.respawn,
    score: s.score,
    cleared: s.cleared,
    gameOver: s.gameOver,
  };
}

// Spec 2.6: pairs of letters that differ only in deadly walls.
const PAIRS = [
  ["B", "M"],
  ["C", "N"],
  ["D", "O"],
  ["E", "P"],
  ["G", "Q"],
  ["H", "R"],
  ["I", "S"],
  ["J", "T"],
  ["K", "U"],
  ["L", "V"],
] as const;
const DEADLY = [..."MNOPQRSTUVWXYZ"];

// ===========================================================================================

describe("6.2 Invariants: deadly walls in whole games at M to Z (2.2, 2.10)", () => {
  it.each([
    [1, "M5"],
    [2, "P3"],
    [3, "R7"],
    [4, "U5"],
    [5, "W2"],
    [6, "Z9"],
  ])(
    "seed %d at %s: every touch kills where the player stood, and it never covers a wall",
    (seed, skill) => {
      let state: GameState = { ...createGame(seed, skill), lives: 1000 };
      const steps = new Steps();
      let wallDeaths = 0;
      for (const [i, keys] of inputLog(seed + 100, 2 * MINUTE).entries()) {
        const tick = i + 1;
        const before = state;
        const touch =
          steps.due(before, tick, keys) &&
          touches(before.maze, before.player, keys);
        state = step(before, keys);
        const where = `seed ${seed} at ${skill}, tick ${tick}`;
        expect(fits(state.maze, state.player), where).toBe(true);
        if (touch) {
          wallDeaths++;
          expect(
            { x: state.player.x, y: state.player.y },
            `${where}: dies where it stood`,
          ).toEqual({ x: before.player.x, y: before.player.y });
          expect(state.lives, where).toBe(before.lives - 1);
          expect(state.respawn, where).toBeGreaterThan(0);
        }
        steps.record(before, state, tick, keys);
        if (state.cleared || state.gameOver) break;
      }
      // Guard: the player did touch walls in this game.
      expect(wallDeaths).toBeGreaterThan(0);
    },
    SLOW,
  );

  it.each(DEADLY)(
    "at %s5 a player that keeps pushing into walls dies on them, and only loses lives",
    (letter) => {
      // The keys change every 6 ticks, so many steps run into walls.
      const seed = letter.charCodeAt(0);
      let state: GameState = { ...createGame(seed, `${letter}5`), lives: 1000 };
      const steps = new Steps();
      let wallDeaths = 0;
      for (const [i, keys] of inputLog(seed, MINUTE / 2, 6).entries()) {
        const tick = i + 1;
        const before = state;
        const touch =
          steps.due(before, tick, keys) &&
          touches(before.maze, before.player, keys);
        state = step(before, keys);
        expect(state.lives).toBeLessThanOrEqual(before.lives);
        expect(state.lives).toBeGreaterThanOrEqual(before.lives - 1);
        if (touch) {
          wallDeaths++;
          expect(state.lives, `${letter}5, tick ${tick}`).toBe(
            before.lives - 1,
          );
        }
        steps.record(before, state, tick, keys);
        if (state.cleared || state.gameOver) break;
      }
      expect(wallDeaths).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe("2.6 Skill level: deadly walls change nothing until the player first touches a wall", () => {
  it.each(PAIRS)(
    "%s and %s play the same game up to the first touch, which kills only at the second",
    (off, on) => {
      let touched = 0;
      let survived = 0;
      for (const seed of [1, 2, 3]) {
        let a: GameState = { ...createGame(seed, `${off}5`), lives: 1000 };
        let b: GameState = { ...createGame(seed, `${on}5`), lives: 1000 };
        const steps = new Steps();
        for (const [i, keys] of inputLog(seed + 200, 2 * MINUTE).entries()) {
          const tick = i + 1;
          const where = `seed ${seed}, tick ${tick}`;
          const touch =
            steps.due(b, tick, keys) && touches(b.maze, b.player, keys);
          const beforeB = b;
          a = step(a, keys);
          b = step(b, keys);
          if (touch) {
            touched++;
            // At the letter with deadly walls the player dies where it stood.
            expect(
              { x: b.player.x, y: b.player.y },
              `${where}: dies where it stood`,
            ).toEqual({ x: beforeB.player.x, y: beforeB.player.y });
            expect(b.lives, where).toBe(beforeB.lives - 1);
            expect(b.respawn, where).toBeGreaterThan(0);
            // Without them the player slides or stays put, and stays in play unless
            // something else killed it on that tick.
            if (a.respawn === 0) survived++;
            break;
          }
          if (JSON.stringify(plain(b)) !== JSON.stringify(plain(a))) {
            expect(plain(b), where).toEqual(plain(a));
          }
          steps.record(beforeB, b, tick, keys);
          if (a.cleared || a.gameOver) break;
        }
      }
      // Guard: the player touched a wall in these games, and survived it at the first letter.
      expect(touched).toBeGreaterThan(0);
      expect(survived).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe("6.2 Invariants: determinism with deadly walls", () => {
  it.each(["M5", "Z9"])(
    "the same seed and input log give the same game at %s",
    (skill) => {
      const log = inputLog(77, MINUTE, 10);
      const play = () => {
        let s: GameState = { ...createGame(9, skill), lives: 1000 };
        for (const keys of log) s = step(s, keys);
        return s;
      };
      expect(play()).toEqual(play());
    },
    SLOW,
  );
});
