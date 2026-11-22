import { describe, expect, it } from "vitest";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import { levelBonus } from "../../src/core/score";
import {
  createGame,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.5, 2.7, 6.2 and 9.1 WP 12: whole games run headless from a seed, a skill level and
// scripted input, with the score and the win condition. `state.score` is the score,
// `state.cleared` whether the level is cleared, and `levelBonus(lives, ticks)` the bonus for
// clearing it with `lives` at the end of the clearing tick, on the level's tick `ticks`, the first
// being 1 (tests/unit/scoring.test.ts checks these in full). Every tick:
//
// - the score is a whole number, at least 0, and never goes down;
// - the level is marked cleared exactly when no hive and no snipe is left, whatever shots are
//   in flight and whether or not the player is in play (2.7, 6.2);
// - the score goes up only by the 2.7 points: 100 for each hive and 10 for each snipe destroyed
//   on a tick on which a player's shot hit it (also when a snipe's shot made the final hit),
//   and the bonus once, on the tick the level is cleared (6.2: at most once a level). So the
//   rise, less any bonus, is a multiple of 10, at most 100 for each hive that went and 10 for
//   each snipe a player's shot in flight could have hit, as each shot hits one target;
// - on a tick with no snipe's shot in flight, every hive and snipe that went was destroyed by a
//   player's shot (a snipe's shot first moves on the tick after it appears, 2.4), so the rise
//   is at least 100 for each hive that went and 10 for each snipe fewer.
//
// Ghosts come with WP 15, so the games use letters without ghosts (A to C). Lives are topped
// up, so that the game goes on after the last one (WP 13) and no level is ever cleared by a
// player with no lives left, the case 2.7 leaves open.

type Axis = InputState["moveX"];

const HIVE_POINTS = 100;
const SNIPE_POINTS = 10;
const MINUTE = 60 * 60; // ticks in a minute at 60 ticks/s (4.3)
const AXES: Axis[] = [-1, 0, 1];
const SLOW = 120_000;

// Draws whole numbers in [0, n) from the seeded PRNG, so a script is the same on every run.
function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

// A fixed input log: random movement, Space and fire keys every 5 to 40 ticks. Space is held
// less often than in the other simulations, so that the player fires more.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  while (log.length < ticks) {
    const keys: InputState = {
      moveX: AXES[draw(3)],
      moveY: AXES[draw(3)],
      fast: draw(8) === 0,
      fireX: AXES[draw(3)],
      fireY: AXES[draw(3)],
    };
    for (let i = 5 + draw(36); i > 0 && log.length < ticks; i--) {
      log.push(keys);
    }
  }
  return log;
}

interface Watch {
  readonly problems: string[];
  /** Points from kills seen so far, and bonuses. */
  readonly totals: { kills: number; bonuses: number };
  /** Checks tick `n` (counted from 1, the first step of the new game), `before` to `after`. */
  readonly tick: (before: GameState, after: GameState, n: number) => void;
}

function watch(): Watch {
  const problems: string[] = [];
  const totals = { kills: 0, bonuses: 0 };
  const tick = (before: GameState, after: GameState, n: number): void => {
    const report = (what: string): void => {
      if (problems.length < 20) problems.push(`tick ${n}: ${what}`);
    };

    const { score } = after;
    if (!Number.isInteger(score) || score < 0) report(`score ${score}`);
    if (score < before.score) report(`score ${before.score} -> ${score}`);

    const none = after.hives.length === 0 && after.snipes.length === 0;
    if (after.cleared !== none) {
      report(
        `cleared ${after.cleared} with ${after.hives.length} hives and ${after.snipes.length} snipes`,
      );
    }

    const bonus =
      after.cleared && !before.cleared ? levelBonus(after.lives, n) : 0;
    if (bonus > 0) totals.bonuses++;
    const points = score - before.score - bonus;
    const hivesGone = before.hives.length - after.hives.length;
    const fewerSnipes = Math.max(0, before.snipes.length - after.snipes.length);
    const most =
      HIVE_POINTS * hivesGone +
      SNIPE_POINTS * Math.min(before.snipes.length, before.shots.length);
    if (points % SNIPE_POINTS !== 0 || points < 0 || points > most) {
      report(
        `score +${score - before.score} (bonus ${bonus}) with ${hivesGone} hives gone, ${before.snipes.length} snipes and ${before.shots.length} shots before`,
      );
    }
    if (before.snipeShots.length === 0) {
      const least = HIVE_POINTS * hivesGone + SNIPE_POINTS * fewerSnipes;
      if (points < least) {
        report(
          `score +${points} for ${hivesGone} hives and ${fewerSnipes} snipes the player destroyed`,
        );
      }
    }
    if (points > 0) totals.kills += points;
  };
  return { problems, totals, tick };
}

// Plays `ticks` ticks of the input log from a new game, checking every tick. With `calm`, the
// snipes' shots are taken away as they appear, before they first move, so that every hive and
// snipe that goes is destroyed by a player's shot.
function play(
  seed: number,
  skill: string,
  ticks: number,
  calm: boolean,
): { checks: Watch; state: GameState } {
  let state: GameState = { ...createGame(seed, skill), lives: 1000 };
  const checks = watch();
  for (const [i, keys] of inputLog(seed + 1, ticks).entries()) {
    const before = state;
    state = step(state, keys);
    if (calm) state = { ...state, snipeShots: [] };
    checks.tick(before, state, i + 1);
  }
  return { checks, state };
}

// ===========================================================================================

describe("2.7 Levels and scoring / 6.2 Invariants: the score and the cleared mark every tick of a game", () => {
  const cases = [3, 4, 5].flatMap((seed) =>
    ["A1", "B5", "C9"].map((skill) => [seed * 7919, skill] as const),
  );

  it.each(cases)(
    "seed %d at %s, two minutes of random moving and firing",
    (seed, skill) => {
      const { checks, state } = play(seed, skill, 2 * MINUTE, false);
      expect(checks.problems).toEqual([]);
      expect(state.cleared).toBe(false);
    },
    SLOW,
  );

  it.each(cases)(
    "seed %d at %s, two minutes, every kill by the player's shots",
    (seed, skill) => {
      const { checks, state } = play(seed, skill, 2 * MINUTE, true);
      expect(checks.problems).toEqual([]);
      expect(state.cleared).toBe(false);
    },
    SLOW,
  );

  it(
    "the player's shots score in these games",
    () => {
      // Guard: the checks above saw points scored, so they checked something.
      let kills = 0;
      for (const [seed, skill] of cases) {
        const { checks } = play(seed, skill, 2 * MINUTE, true);
        expect(checks.problems).toEqual([]);
        kills += checks.totals.kills;
      }
      expect(kills).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe("6.2 Determinism with scoring", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "seed %d and the same input log give the same score and cleared mark",
    (seed) => {
      const log = inputLog(seed + 9, 2 * MINUTE);
      let a = createGame(seed, "C9");
      let b = createGame(seed, "C9");
      for (const keys of log) {
        a = step(a, keys);
        b = step(b, keys);
        expect(a.score).toBe(b.score);
        expect(a.cleared).toBe(b.cleared);
      }
      expect(a).toEqual(b);
    },
    SLOW,
  );
});
