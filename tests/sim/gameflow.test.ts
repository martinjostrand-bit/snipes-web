import { describe, expect, it } from "vitest";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2, 2.2, 2.7, 6.2 and 9.1 WP 13: whole games run headless until they are won or over.
//
// - `state.gameOver` becomes true at the end of the 120th tick after the tick on which the
//   lives went to 0, unless the level was cleared on or before that tick; never earlier, never
//   with lives left, never together with `state.cleared` (the game won, 2.7).
// - The level is marked cleared exactly when no hive and no snipe is left (ghosts come with
//   WP 15, so the games use letters without them, A to C), whatever is in flight and whether
//   or not the player is in play.
// - The score never goes down. No tick runs after the game is won or over: `step` returns the
//   state unchanged, so the bonus is added at most once and nothing moves.
// - The same seed and input log give the same end (6.2).
//
// Digit 9 gives 2 lives and the most snipes (2.6), so games end soon.

type Axis = InputState["moveX"];

const AXES: Axis[] = [-1, 0, 1];
const MINUTE = 60 * 60; // ticks in a minute at 60 ticks/s (4.3)
const OVER_TICKS = 120; // 2.2
const AFTER_END = 60; // ticks a test goes on stepping a game that has ended
const SLOW = 180_000;

function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

// A fixed input log: random movement, Space and fire keys every 5 to 40 ticks.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  while (log.length < ticks) {
    const keys: InputState = {
      ...NO_INPUT,
      moveX: AXES[draw(3)],
      moveY: AXES[draw(3)],
      fireX: AXES[draw(3)],
      fireY: AXES[draw(3)],
      fast: draw(4) === 0,
    };
    for (let i = 5 + draw(36); i > 0 && log.length < ticks; i--) {
      log.push(keys);
    }
  }
  return log;
}

interface End {
  readonly state: GameState;
  /** The tick on which the game was won or became over, or -1. */
  readonly tick: number;
  readonly problems: string[];
}

// Plays `start` with `log` and checks 2.2, 2.7 and 6.2 on every tick. `change` may change the
// state before a tick, as a test's setup. Once the game has ended, it is stepped AFTER_END
// more times with the rest of the log, and must not change.
function play(
  start: GameState,
  log: readonly InputState[],
  change: (s: GameState, tick: number) => GameState = (s) => s,
): End {
  const problems: string[] = [];
  const report = (what: string): void => {
    if (problems.length < 20) problems.push(what);
  };
  let state = start;
  let lastDeath = -1;
  for (const [i, keys] of log.entries()) {
    const tick = i + 1;
    const before = change(state, tick);
    const after = step(before, keys);
    state = after;
    const at = `tick ${tick}`;
    if (after.score < before.score) {
      report(
        `${at}: the score went down from ${before.score} to ${after.score}`,
      );
    }
    if (after.ticks !== before.ticks + 1) {
      report(`${at}: ticks went from ${before.ticks} to ${after.ticks}`);
    }
    const empty = after.hives.length === 0 && after.snipes.length === 0;
    if (after.cleared !== empty) {
      report(
        `${at}: cleared is ${after.cleared} with ${after.hives.length} hives and ${after.snipes.length} snipes`,
      );
    }
    if (after.gameOver && after.cleared) report(`${at}: both won and over`);
    if (after.gameOver && after.lives !== 0) {
      report(`${at}: over with ${after.lives} lives`);
    }
    if (before.lives > 0 && after.lives === 0) lastDeath = tick;
    const due = lastDeath >= 0 && tick === lastDeath + OVER_TICKS;
    if (after.gameOver !== (due && !after.cleared)) {
      report(
        `${at}: gameOver is ${after.gameOver}; the lives went to 0 on tick ${lastDeath}`,
      );
    }
    if (after.cleared || after.gameOver) {
      // The game has ended: no tick runs after it.
      for (const [j, more] of log.slice(tick, tick + AFTER_END).entries()) {
        const next = step(state, more);
        if (JSON.stringify(next) !== JSON.stringify(state)) {
          report(`${at}: the ended game changed ${j + 1} ticks later`);
          break;
        }
        state = next;
      }
      return { state, tick, problems };
    }
  }
  return { state, tick: -1, problems };
}

describe("6.2 Invariants: no tick runs after the game is over (2.2, 2.7)", () => {
  it.each([
    [18, "A9"],
    [4, "B9"],
    [6, "B9"],
    [19, "B9"],
    [25, "A9"],
    [22, "A9"],
  ] as const)(
    "seed %d at %s, random moving and firing until the game is over",
    (seed, skill) => {
      const end = play(
        createGame(seed, skill),
        inputLog(seed + 100, 8 * MINUTE),
      );
      expect(end.problems).toEqual([]);
      // Guard: the game ended by losing the last life.
      expect(end.tick, "the game did not end within 8 minutes").toBeGreaterThan(
        0,
      );
      expect(end.state.gameOver).toBe(true);
      expect(end.state.lives).toBe(0);
    },
    SLOW,
  );

  it(
    "standing still at A9, the game is over and stays so",
    () => {
      const log = new Array<InputState>(8 * MINUTE).fill(NO_INPUT);
      const end = play(createGame(25, "A9"), log);
      expect(end.problems).toEqual([]);
      expect(end.state.gameOver).toBe(true);
    },
    SLOW,
  );
});

describe("6.2 Invariants: a level is won exactly when no hive or snipe is left, then nothing runs (2.7)", () => {
  // Partway through a game, every hive is taken away; the snipes left are taken away a few
  // ticks later, with whatever is in flight left as it is. The level is then cleared at the
  // end of that tick, whether the player is in play or not.
  it.each([
    [18, "A9", 600],
    [4, "B9", 1500],
    [17, "C9", 300],
    [19, "B5", 2000],
    [25, "A9", 500],
  ] as const)(
    "seed %d at %s, hives taken away on tick %d",
    (seed, skill, at) => {
      const end = play(
        createGame(seed, skill),
        inputLog(seed + 200, 8 * MINUTE),
        (s, tick) => {
          if (tick === at) return { ...s, hives: [] };
          if (tick === at + 30) return { ...s, snipes: [] };
          return s;
        },
      );
      expect(end.problems).toEqual([]);
      // It was won on the tick the snipes went, or earlier if shots killed them all first.
      expect(end.state.cleared).toBe(true);
      expect(end.state.gameOver).toBe(false);
      expect(end.tick).toBeGreaterThanOrEqual(at);
      expect(end.tick).toBeLessThanOrEqual(at + 30);
    },
    SLOW,
  );

  it(
    "a game won while the player has no lives left, before it is over, stays won",
    () => {
      // Find the tick on which the lives go to 0 standing still, then take every enemy away
      // 60 ticks later.
      const log = new Array<InputState>(8 * MINUTE).fill(NO_INPUT);
      let state = createGame(25, "A9");
      let last = -1;
      for (let tick = 1; tick <= log.length && last < 0; tick++) {
        state = step(state, NO_INPUT);
        if (state.lives === 0) last = tick;
      }
      expect(last).toBeGreaterThan(0);
      const end = play(createGame(25, "A9"), log, (s, tick) =>
        tick === last + 60 ? { ...s, hives: [], snipes: [] } : s,
      );
      expect(end.problems).toEqual([]);
      expect(end.tick).toBe(last + 60);
      expect(end.state.cleared).toBe(true);
      expect(end.state.gameOver).toBe(false);
      expect(end.state.lives).toBe(0);
    },
    SLOW,
  );
});

describe("6.2 Determinism: the same seed and input log end the same way", () => {
  it.each([4, 19])(
    "seed %d at B9",
    (seed) => {
      const log = inputLog(seed + 100, 8 * MINUTE);
      const a = play(createGame(seed, "B9"), log);
      const b = play(createGame(seed, "B9"), log);
      expect(a.tick).toBeGreaterThan(0);
      expect(b.tick).toBe(a.tick);
      expect(b.state).toEqual(a.state);
    },
    SLOW,
  );
});
