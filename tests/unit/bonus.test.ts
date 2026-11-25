import { describe, expect, it } from "vitest";
import { levelBonus } from "../../src/core/score";
import { createGame, NO_INPUT, step } from "../../src/core/state";

// Spec 2.7 and 9.1 WP 18: the final level bonus, 100·L + 5·max(0, 300 − ⌊T/60⌋), where L is the
// lives at the end of the clearing tick and T the ticks of the level up to and including it,
// the first being 1. ⌊T/60⌋ is the whole seconds taken, so a started second does not count.
// It is the same at every skill level. `levelBonus(lives, ticks)` in `src/core/score.ts` gives
// it. Every expected value here is written out, not computed by `levelBonus`.
//
// The formula is WP 12's, so these tests may pass before any code change (9.2 step 1).

describe("2.7 Levels and scoring: the level bonus formula", () => {
  // [L, T, bonus]
  it.each([
    // The cases named in 9.1 WP 18.
    [3, 3630, 1500], // the 2.7 example: 300 + 5·240
    [3, 1, 1800],
    [3, 59, 1800], // a started second does not count
    [3, 60, 1795],
    [3, 17_999, 305],
    [3, 18_000, 300],
    [3, 18_001, 300],
    [0, 3630, 1200],
    [0, 18_000, 0],
    [5, 1, 2000],
    // More around the edges of a second and of the 5 minutes.
    [3, 119, 1795],
    [3, 120, 1790],
    [3, 17_940, 305],
    [3, 17_939, 310],
    [0, 1, 1500],
    [0, 17_999, 5],
    [0, 1_000_000, 0],
    [1, 1, 1600],
    [2, 1, 1700],
    [4, 1, 1900],
    [5, 18_000, 500],
    [5, 600_000, 500],
    [2, 3630, 1400],
    [4, 7200, 1300], // 400 + 5·180
    [1, 10_799, 705], // 100 + 5·(300 − 179)
  ])("is %d lives, %d ticks → %d", (lives, ticks, bonus) => {
    expect(levelBonus(lives, ticks)).toBe(bonus);
  });

  // A game with no hive and no snipe is cleared at the end of its first tick (2.7), T = 1, with
  // the digit's lives (2.6) and no other points that tick: the score is the bonus alone.
  it.each([
    ["A1", 2000], // 5 lives
    ["M5", 2000], // 5 lives
    ["Z6", 1900], // 4 lives
    ["C8", 1800], // 3 lives
    ["W9", 1700], // 2 lives
  ])(
    "gives a game at %s cleared on its first tick a score of %d",
    (skill, score) => {
      const game = { ...createGame(5, skill), hives: [], snipes: [] };
      const after = step(game, NO_INPUT);
      expect(after.cleared).toBe(true);
      expect(after.score).toBe(score);
    },
  );
});
