import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createGame,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 4.3, 6.2 and 9.1 WP 18: the determinism check over recorded games.
//
// - A game is fully described by its seed, its options (the skill level, 2.6) and its input
//   log (4.3). The recorded games are stored in `recorded-games.json` next to this file, each as
//   `{ seed, skill, inputs }`, the input log as run-length pairs [ticks held, input]. They were
//   generated once and are only read here. (They were made from the game's own PRNG seeded with
//   seed * 7919 + 1: keys held for 5 to 40 ticks at a time, one spell in 8 with no keys, Space
//   one time in 4.)
// - Between them there is a game at a letter from A to C and, for each of the four letter
//   features of 2.6, a game with that feature on. Each log is at most 3,600 ticks.
// - Each game is replayed twice from `createGame(seed, skill)`, one `step(state, input)` per
//   tick, and the two `GameState`s are deep-equal after every tick (6.2).
// - All randomness is in the state and `step` is the only way to change it (4.3), so the first
//   replay freezes every state and input it steps: a change to one throws.
// - Together the games reach a player death, a hive hit, a ghost appearing, a bounce of the
//   player's shot, and a game that is won or over by the end of its log.
//
// Determinism already holds, so these tests may pass before any code change
// (9.2 step 1).

type Run = readonly [ticks: number, input: InputState];

interface Recording {
  readonly seed: number;
  readonly skill: string;
  readonly inputs: readonly Run[];
}

const MOST_TICKS = 3600; // 9.1 WP 18: a recorded log is at most a minute at 60 ticks/s
const SLOW = 120_000;

// Spec 2.6: the letters that enable each feature.
const FEATURES = {
  ghosts: "DEFIJKLOPSTUVWXYZ",
  bouncing: "GHIJKLQRSTUVWXYZ",
  deadlyWalls: "MNOPQRSTUVWXYZ",
  hivesResist: "WXYZ",
} as const;
const NO_FEATURES = "ABC";

const RECORDINGS = JSON.parse(
  readFileSync(new URL("recorded-games.json", import.meta.url), "utf8"),
) as Recording[];

// The input log, one input per tick.
function ticksOf(recording: Recording): InputState[] {
  return recording.inputs.flatMap(([ticks, input]) =>
    new Array<InputState>(ticks).fill(input),
  );
}

// Freezes a value and everything in it, so that changing any of it throws (modules run in
// strict mode). Parts already frozen, such as a maze shared by every state of a game, are not
// walked again.
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

const label = (r: Recording): string => `${r.skill} seed ${r.seed}`;
const EACH = RECORDINGS.map((r) => [label(r), r] as const);

describe("6.2 Determinism: the recorded games", () => {
  it("are stored as a seed, a skill level and run-length input pairs of at most 3,600 ticks", () => {
    expect(RECORDINGS.length).toBeGreaterThan(0);
    const axis = [-1, 0, 1];
    for (const recording of RECORDINGS) {
      expect(Object.keys(recording).sort(), label(recording)).toEqual([
        "inputs",
        "seed",
        "skill",
      ]);
      expect(Number.isInteger(recording.seed), label(recording)).toBe(true);
      expect(recording.seed, label(recording)).toBeGreaterThanOrEqual(0);
      expect(recording.seed, label(recording)).toBeLessThan(2 ** 32);
      expect(recording.skill, label(recording)).toMatch(/^[A-Z][1-9]$/);
      let total = 0;
      for (const [ticks, input] of recording.inputs) {
        expect(Number.isInteger(ticks) && ticks > 0, label(recording)).toBe(
          true,
        );
        expect(Object.keys(input).sort(), label(recording)).toEqual([
          "fast",
          "fireX",
          "fireY",
          "moveX",
          "moveY",
        ]);
        expect(axis).toContain(input.moveX);
        expect(axis).toContain(input.moveY);
        expect(axis).toContain(input.fireX);
        expect(axis).toContain(input.fireY);
        expect(typeof input.fast).toBe("boolean");
        total += ticks;
      }
      expect(total, label(recording)).toBeGreaterThan(0);
      expect(total, label(recording)).toBeLessThanOrEqual(MOST_TICKS);
    }
  });

  it("include a game at A to C and, for each letter feature, a game with it on", () => {
    const letters = RECORDINGS.map((r) => r.skill[0]);
    expect(letters.some((l) => NO_FEATURES.includes(l))).toBe(true);
    for (const [feature, on] of Object.entries(FEATURES)) {
      expect(
        letters.some((l) => on.includes(l)),
        feature,
      ).toBe(true);
    }
  });

  it.each(EACH)(
    "%s, replayed twice, gives deep-equal states after every tick",
    (_, recording) => {
      // The first replay freezes everything it steps; the second runs as the page does.
      let frozen = deepFreeze(createGame(recording.seed, recording.skill));
      let plain = createGame(recording.seed, recording.skill);
      expect(plain).toEqual(frozen);
      // The two new games' mazes are deep-equal, so the second takes the first's frozen maze:
      // as long as neither replay replaces it, comparing the states need not walk its 61,440
      // cells every tick, and neither can change it in place.
      plain = { ...plain, maze: frozen.maze };
      ticksOf(recording).forEach((input, tick) => {
        frozen = deepFreeze(step(frozen, deepFreeze({ ...input })));
        plain = step(plain, input);
        if (!isDeepStrictEqual(plain, frozen)) {
          expect(plain, `after tick ${tick + 1}`).toEqual(frozen);
          expect.fail(`the states differ after tick ${tick + 1}`);
        }
      });
    },
    SLOW,
  );

  it(
    "together reach a death, a hive hit, a ghost, a bounce and an ended game",
    () => {
      const reached = {
        death: false,
        hiveHit: false,
        ghostAppears: false,
        playerShotBounces: false,
        wonOrOver: false,
      };
      for (const recording of RECORDINGS) {
        let state: GameState = createGame(recording.seed, recording.skill);
        for (const input of ticksOf(recording)) {
          const before = state;
          state = step(state, input);
          if (state.lives < before.lives) reached.death = true;
          // A hive is hit when it takes a hit or is destroyed (its 20th hit, 2.3).
          const hit = before.hives.some((was) => {
            const now = state.hives.find((h) => h.x === was.x && h.y === was.y);
            return now === undefined || now.hits > was.hits;
          });
          if (hit) reached.hiveHit = true;
          if (state.ghosts.length > before.ghosts.length) {
            reached.ghostAppears = true;
          }
          // Spec 3: for each of the player's shots that moved on this tick, whether it bounced.
          if (state.motion.bouncedShots.includes(true)) {
            reached.playerShotBounces = true;
          }
        }
        if (state.cleared || state.gameOver) reached.wonOrOver = true;
      }
      expect(reached).toEqual({
        death: true,
        hiveHit: true,
        ghostAppears: true,
        playerShotBounces: true,
        wonOrOver: true,
      });
    },
    SLOW,
  );
});
