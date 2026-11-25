import { describe, expect, it } from "vitest";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.3, 2.5, 2.6, 6.2 and 9.1 WP 16: hives resisting snipe shots in whole games, run
// headless from a seed, a skill level and scripted input.
//
// - At W to Z a snipe's shot never damages a hive (`Hive.hits`), so while the player does not
//   fire, no hive ever takes a hit or is destroyed.
// - The letters T and W, U and X, V and Y differ only in this feature (2.6). Played from the
//   same seed with the same input, the two games stay the same, but for the hits snipe shots
//   do to hives at T, U and V, until a hive is destroyed in one game and not in the other.
//
// Lives are topped up, so that the games go on after the last one (WP 13).

type Axis = InputState["moveX"];

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

// A scripted input log: new movement and fire keys every 30 ticks.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  let keys = NO_INPUT;
  for (let t = 0; t < ticks; t++) {
    if (t % 30 === 0) {
      keys = {
        moveX: AXES[draw(3)],
        moveY: AXES[draw(3)],
        fast: draw(6) === 0,
        fireX: AXES[draw(3)],
        fireY: AXES[draw(3)],
      };
    }
    log.push(keys);
  }
  return log;
}

function totalHits(s: GameState): number {
  return s.hives.reduce((sum, h) => sum + h.hits, 0);
}

// What the rules decide in a tick, but for the hives' hits.
function plain(s: GameState) {
  return {
    rng: s.rng,
    player: s.player,
    hives: s.hives.map((h) => ({ ...h, hits: 0 })),
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

// Spec 2.6: pairs of letters that differ only in hives resisting snipe shots.
const PAIRS = [
  ["T", "W"],
  ["U", "X"],
  ["V", "Y"],
] as const;
const SEEDS = [1, 3, 6];

// ===========================================================================================

describe("6.2 Invariants: at W to Z snipe shots never damage a hive (2.3, 2.5, 2.6)", () => {
  it.each(PAIRS)(
    "standing still without firing for two minutes, hives take hits at %s and none at %s",
    (off, on) => {
      let offHits = 0;
      for (const seed of SEEDS) {
        for (const [letter, resists] of [
          [off, false],
          [on, true],
        ] as const) {
          let state: GameState = {
            ...createGame(seed, `${letter}5`),
            lives: 1000,
          };
          const hives = state.hives.length;
          for (let tick = 1; tick <= 2 * MINUTE; tick++) {
            const before = state;
            state = step(state, NO_INPUT);
            const hit =
              totalHits(state) > totalHits(before) ||
              state.hives.length < before.hives.length;
            if (resists) {
              expect(hit, `seed ${seed} at ${letter}5, tick ${tick}`).toBe(
                false,
              );
            } else if (hit) {
              offHits++;
            }
            if (state.cleared || state.gameOver) break;
          }
          if (resists) {
            expect(state.hives).toHaveLength(hives);
            expect(totalHits(state)).toBe(0);
          }
        }
      }
      // Guard: without the feature, snipe shots did reach hives in these games.
      expect(offHits, `hits at ${off}`).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe("2.6 Skill level: resisting hives change only the hits snipe shots do to hives, in whole games", () => {
  it.each(PAIRS)(
    "%s and %s play the same games but for the hives' hits, moving and firing",
    (off, on) => {
      let differed = 0;
      for (const seed of SEEDS) {
        let a: GameState = { ...createGame(seed, `${off}5`), lives: 1000 };
        let b: GameState = { ...createGame(seed, `${on}5`), lives: 1000 };
        for (const [i, keys] of inputLog(seed + 50, 2 * MINUTE).entries()) {
          a = step(a, keys);
          b = step(b, keys);
          const where = `seed ${seed}, tick ${i + 1}`;
          if (a.hives.length !== b.hives.length) {
            // A hive destroyed at the letter without the feature only: it took more hits.
            expect(a.hives.length, where).toBeLessThan(b.hives.length);
            break;
          }
          if (JSON.stringify(plain(b)) !== JSON.stringify(plain(a))) {
            expect(plain(b), where).toEqual(plain(a));
          }
          for (const [k, h] of b.hives.entries()) {
            expect(h.hits, where).toBeLessThanOrEqual(a.hives[k].hits);
          }
          if (totalHits(b) < totalHits(a)) differed++;
          if (a.cleared || a.gameOver) break;
        }
      }
      // Guard: snipe shots reached hives, so the games could have differed in more.
      expect(differed).toBeGreaterThan(0);
    },
    SLOW,
  );
});
