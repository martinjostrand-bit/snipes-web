import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { levelBonus } from "../../src/core/score";
import { createGame } from "../../src/core/state";
import {
  canvasHash,
  floorPixel,
  OPEN_MS,
  openTitleWithClock,
  openWithClock,
  pixelsIn,
} from "./canvas";
import { CELL_PX, deathInSight, quietSeeds, TICKS_PER_SECOND } from "./game";
import {
  gameOverRun,
  hiveShotDown,
  openTitle,
  read,
  shown,
  waitFor,
  type Ending,
  type Screen,
  type Shown,
} from "./screens";

// Spec 2, 2.2, 2.7, 2.8, 3, 4.3 and 9.1 WP 13: the screens and the flow between them: title
// → playing ⇄ paused → won or game over → playing again or title. What each screen shows is
// read from the canvas's accessible name (screens.ts).
//
// - Title: the name, the version, the skill level and the best score for it. A letter A to Z
//   (either case) sets the letter, a digit 1 to 9 the digit; other keys do nothing. Enter
//   starts a game at that skill level. The skill level shown at first is the last one started,
//   stored locally; else, or if the stored value is not valid, A1.
// - P or Esc pauses and resumes; the page loop runs no tick while paused.
// - Won and game over: the score (bonus included), the best for the skill level including this
//   game, and "New best!" only when the score is strictly higher than the best stored before.
//   With no stored score the best is 0. Enter or R starts a new game at the same skill level;
//   Esc goes back to the title.
// - The high score is stored locally per skill level when a game is won or lost. Without
//   storage the game still works.
// - `?won=1` (4.3): every game on that page starts with no hives and no snipes, so it is won
//   on its first tick, with the bonus for the digit's lives after 1 tick.
// - Screen and pause keys act on a key press, not on its auto-repeat. Playwright sends a
//   `keydown` with `repeat` set when `keyboard.down` is called again for a key already down.
//
// Each test starts with empty storage (a new browser context). Tests that need the game's
// timing run the page on Playwright's fake clock (canvas.ts): a frame every 16 ms of page
// time, each running about one tick. A key held from a game's first tick gives the same game
// as in Node, however the frames fall, since the game only sees the keys held on each tick.

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

// Spec 2.6: the lives for digits 1 to 9.
const LIVES = [5, 5, 5, 5, 5, 4, 4, 3, 2];

// The score of a game won on its first tick (`?won=1`) at a skill level with digit `digit`:
// no points, only the bonus for the digit's lives after 1 tick (2.7).
function wonScore(digit: number): number {
  return levelBonus(LIVES[digit - 1], 1);
}

// Page time, in ms, for `ticks` ticks of the game.
function ms(ticks: number): number {
  return (1000 * ticks) / TICKS_PER_SECOND;
}

// Presses a key and lets the page draw a few frames on the fake clock.
async function pressOnClock(page: Page, key: string): Promise<Shown> {
  await page.keyboard.press(key);
  await page.clock.runFor(50);
  return shown(page);
}

async function typeSkill(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

// ===========================================================================================

test.describe("3 Presentation: the title screen", () => {
  test("shows the name, the version, the skill level A1 and a best score of 0 at first", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/");
    const title = await shown(page);
    expect(title.label).toContain(`Snipes Web v${version}`);
    expect(title.screen).toBe("title");
    expect(title.skill).toBe("A1");
    expect(title.best).toBe(0);
    expect(errors).toEqual([]);
  });

  test("stays on the title until Enter is pressed: the game does not start on its own", async ({
    page,
  }) => {
    const errors = await openTitleWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await page.clock.runFor(5000);
    expect((await shown(page)).screen).toBe("title");
    const playing = await pressOnClock(page, "Enter");
    expect(playing.screen).toBe("playing");
    expect(errors).toEqual([]);
  });

  test("a typed letter (either case) and digit set the skill level; Enter starts a game at it", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/");
    await typeSkill(page, ["m", "Digit7"]);
    await expect.poll(async () => (await shown(page)).skill).toBe("M7");
    await page.keyboard.press("Shift+KeyZ");
    await expect.poll(async () => (await shown(page)).skill).toBe("Z7");
    await typeSkill(page, ["x", "3"]);
    await expect.poll(async () => (await shown(page)).skill).toBe("X3");
    await page.keyboard.press("Digit7");
    await expect.poll(async () => (await shown(page)).skill).toBe("X7");
    expect((await shown(page)).screen).toBe("title");

    await page.keyboard.press("Enter");
    // Spec 2.6: digit 7 gives 6 hives and 4 lives.
    const playing = await waitFor(page, "playing");
    expect(playing.skill).toBe("X7");
    expect(playing.lives).toBe(4);
    expect(playing.hives).toBe(6);
    expect(playing.score).toBe(0);
    expect(errors).toEqual([]);
  });

  test("other keys, the digit 0 among them, do nothing", async ({ page }) => {
    const errors = await openTitle(page, "/");
    await typeSkill(page, ["c", "4"]);
    await expect.poll(async () => (await shown(page)).skill).toBe("C4");
    for (const key of [
      "Digit0",
      "Space",
      "ArrowUp",
      "ArrowLeft",
      "Minus",
      "Period",
      "Shift+Digit1",
    ]) {
      await page.keyboard.press(key);
      const title = await shown(page);
      expect(title.screen, key).toBe("title");
      expect(title.skill, key).toBe("C4");
    }
    expect(errors).toEqual([]);
  });

  test("M, P, R and Esc do not mute, pause, restart or leave: letters only set the letter", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/");
    for (const [key, skill] of [
      ["p", "P1"],
      ["m", "M1"],
      ["r", "R1"],
      ["Shift+KeyP", "P1"],
      ["w", "W1"],
      ["s", "S1"],
    ] as const) {
      await page.keyboard.press(key);
      await expect.poll(async () => (await shown(page)).skill, key).toBe(skill);
      expect((await shown(page)).screen, key).toBe("title");
    }
    await page.keyboard.press("Escape");
    const title = await shown(page);
    expect(title.screen).toBe("title");
    expect(title.skill).toBe("S1");
    await page.keyboard.press("Enter");
    expect((await waitFor(page, "playing")).skill).toBe("S1");
    expect(errors).toEqual([]);
  });

  test("shows the last skill level started after a reload; one typed but not started is not kept", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/");
    await typeSkill(page, ["k", "4"]);
    await page.keyboard.press("Enter");
    expect((await waitFor(page, "playing")).skill).toBe("K4");

    await page.reload();
    let title = await waitFor(page, "title");
    expect(title.skill).toBe("K4");

    await typeSkill(page, ["d", "5"]);
    await expect.poll(async () => (await shown(page)).skill).toBe("D5");
    await page.reload();
    title = await waitFor(page, "title");
    expect(title.skill).toBe("K4");
    expect(errors).toEqual([]);
  });

  test("falls back to A1 when the stored skill level is not a letter A-Z and a digit 1-9", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/");
    for (const bad of ["M0", "MM", "M55", "5M", ""]) {
      // Start a game at M5, so that M5 is stored, and find where.
      await page.goto("/");
      await waitFor(page, "title");
      await typeSkill(page, ["m", "5"]);
      await page.keyboard.press("Enter");
      await waitFor(page, "playing");
      const changed = await page.evaluate((value) => {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const stored = key === null ? null : localStorage.getItem(key);
          if (key !== null && stored?.includes("M5")) {
            keys.push(key);
            localStorage.setItem(key, stored.split("M5").join(value));
          }
        }
        return keys;
      }, bad);
      expect(changed, "M5 was not stored when the game started").not.toEqual(
        [],
      );
      await page.reload();
      const title = await waitFor(page, "title");
      expect(title.skill, `stored "${bad}"`).toBe("A1");
    }
    expect(errors).toEqual([]);
  });

  test("falls back to A1, with a best of 0, when what is stored is not even readable", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/?won=1");
    await typeSkill(page, ["m", "5"]);
    await page.keyboard.press("Enter");
    await waitFor(page, "won");
    await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null) localStorage.setItem(key, "{not json");
      }
    });
    await page.reload();
    const title = await waitFor(page, "title");
    expect(title.skill).toBe("A1");
    expect(title.best).toBe(0);
    // And the game still works.
    await page.keyboard.press("Enter");
    expect((await waitFor(page, "won")).score).toBe(wonScore(1));
    expect(errors).toEqual([]);
  });
});

test.describe("3 Presentation: the won screen, with ?won=1 (4.3)", () => {
  test("Enter on the title wins at once: the score is the bonus, the best is that score, and it is a new best", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/?won=1");
    await page.keyboard.press("Enter");
    const won = await waitFor(page, "won");
    expect(wonScore(1)).toBeGreaterThan(0);
    expect(won.score).toBe(wonScore(1));
    expect(won.best).toBe(wonScore(1));
    expect(won.newBest).toBe(true);
    expect(errors).toEqual([]);
  });

  test.describe("plays again at the same skill level, and the same score is not a new best", () => {
    for (const key of ["Enter", "r", "Shift+KeyR"]) {
      test(`with ${key}`, async ({ page }) => {
        const errors = await openTitle(page, "/?won=1");
        await typeSkill(page, ["g", "8"]);
        await page.keyboard.press("Enter");
        const first = await waitFor(page, "won");
        expect(first.score).toBe(wonScore(8));
        expect(first.newBest).toBe(true);

        await page.keyboard.press(key);
        // A new game at G8, won on its first tick with the same score.
        await expect
          .poll(async () => (await shown(page)).newBest, { timeout: 10_000 })
          .toBe(false);
        const again = await waitFor(page, "won");
        expect(again.score).toBe(wonScore(8));
        expect(again.best).toBe(wonScore(8));
        expect(again.newBest).toBe(false);
        expect(errors).toEqual([]);
      });
    }
  });

  test("Esc goes back to the title, which shows the skill level and the new best", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/?won=1");
    await typeSkill(page, ["b", "2"]);
    await page.keyboard.press("Enter");
    await waitFor(page, "won");
    await page.keyboard.press("Escape");
    const title = await waitFor(page, "title");
    expect(title.label).toContain(`Snipes Web v${version}`);
    expect(title.skill).toBe("B2");
    expect(title.best).toBe(wonScore(2));
    expect(errors).toEqual([]);
  });

  test("other keys do nothing on the won screen", async ({ page }) => {
    const errors = await openTitle(page, "/?won=1");
    await page.keyboard.press("Enter");
    await waitFor(page, "won");
    for (const key of ["p", "m", "a", "Space", "ArrowUp", "Digit5"]) {
      await page.keyboard.press(key);
      const won = await shown(page);
      expect(won.screen, key).toBe("won");
      expect(won.newBest, key).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test("a held Enter does not start another game on its auto-repeat", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/?won=1");
    await page.keyboard.down("Enter");
    const won = await waitFor(page, "won");
    expect(won.newBest).toBe(true);
    // Auto-repeats of the held key.
    for (let i = 0; i < 3; i++) await page.keyboard.down("Enter");
    await page.waitForTimeout(300);
    expect((await shown(page)).newBest).toBe(true);
    await page.keyboard.up("Enter");
    // A new press plays again: the same score is no longer a new best.
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => {
        const again = await shown(page);
        return again.screen === "won" && !again.newBest;
      })
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test("without ?won=1 exactly, the game starts normally", async ({ page }) => {
    const seed = quietSeeds(1)[0];
    for (const value of ["0", "true", "1x", "", "2"]) {
      const errors = await openTitle(page, `/?seed=${seed}&won=${value}`);
      await page.keyboard.press("Enter");
      const playing = await waitFor(page, "playing");
      expect(playing.hives, `?won=${value}`).toBe(
        createGame(seed).hives.length,
      );
      await page.waitForTimeout(500);
      expect((await shown(page)).screen, `?won=${value}`).toBe("playing");
      expect(errors).toEqual([]);
    }
  });
});

test.describe("2.7 Levels and scoring / 3 Presentation: the high score per skill level", () => {
  test("survives a reload, and is kept for each skill level apart", async ({
    page,
  }) => {
    const errors = await openTitle(page, "/?won=1");
    await page.keyboard.press("Enter");
    expect((await waitFor(page, "won")).best).toBe(wonScore(1));

    await page.reload();
    let title = await waitFor(page, "title");
    expect(title.skill).toBe("A1");
    expect(title.best).toBe(wonScore(1));

    // Another skill level has its own best, 0 until a game at it ends.
    await page.keyboard.press("9");
    await expect.poll(async () => (await shown(page)).skill).toBe("A9");
    expect((await shown(page)).best).toBe(0);
    // Another letter too.
    await page.keyboard.press("b");
    await expect.poll(async () => (await shown(page)).skill).toBe("B9");
    expect((await shown(page)).best).toBe(0);
    await page.keyboard.press("a");
    await page.keyboard.press("Enter");
    const won = await waitFor(page, "won");
    // Digit 9 has 2 lives, so its bonus is lower than A1's; it is still a new best for A9.
    expect(wonScore(9)).toBeLessThan(wonScore(1));
    expect(won.score).toBe(wonScore(9));
    expect(won.best).toBe(wonScore(9));
    expect(won.newBest).toBe(true);

    await page.reload();
    title = await waitFor(page, "title");
    expect(title.skill).toBe("A9");
    expect(title.best).toBe(wonScore(9));
    await page.keyboard.press("1");
    await expect.poll(async () => (await shown(page)).skill).toBe("A1");
    expect((await shown(page)).best).toBe(wonScore(1));
    expect(errors).toEqual([]);
  });

  test("a lower score is not a new best, and the stored best stays", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const run = gameOverRun("A9");
    // First a won game at A9, with a score above that of the lost game below, on another
    // page of the same site.
    expect(wonScore(9)).toBeGreaterThan(run.score);
    const first = await page.context().newPage();
    const firstErrors = await openTitle(first, "/?won=1");
    await first.keyboard.press("9");
    await first.keyboard.press("Enter");
    expect((await waitFor(first, "won")).best).toBe(wonScore(9));
    await first.close();
    expect(firstErrors).toEqual([]);

    // Then a lost game at A9.
    const errors = await openTitleWithClock(page, `/?seed=${run.seed}`);
    expect((await shown(page)).skill).toBe("A9");
    const over = await playToTheEnd(page, run);
    expect(over.score).toBe(run.score);
    expect(over.best).toBe(wonScore(9));
    expect(over.newBest).toBe(false);
    expect(await pressOnClock(page, "Escape")).toMatchObject({
      screen: "title",
      skill: "A9",
      best: wonScore(9),
    });
    expect(errors).toEqual([]);
  });

  test("the game works and stores nothing when local storage cannot be used", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Storage is turned off", "SecurityError");
        },
      });
    });
    const errors = await openTitle(page, "/?won=1");
    let title = await shown(page);
    expect(title.skill).toBe("A1");
    expect(title.best).toBe(0);
    await typeSkill(page, ["c", "3"]);
    await page.keyboard.press("Enter");
    const won = await waitFor(page, "won");
    expect(won.score).toBe(wonScore(3));
    expect(won.newBest).toBe(true);
    await page.keyboard.press("Enter");
    await waitFor(page, "won");
    await page.keyboard.press("Escape");
    expect((await waitFor(page, "title")).skill).toBe("C3");

    await page.reload();
    title = await waitFor(page, "title");
    expect(title.skill).toBe("A1");
    expect(title.best).toBe(0);
    expect(errors).toEqual([]);
  });

  test("the game works when local storage refuses to store", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException(
          "The quota has been exceeded",
          "QuotaExceededError",
        );
      };
    });
    const errors = await openTitle(page, "/?won=1");
    await page.keyboard.press("Enter");
    const won = await waitFor(page, "won");
    expect(won.score).toBe(wonScore(1));
    await page.keyboard.press("Escape");
    await waitFor(page, "title");
    await page.keyboard.press("Enter");
    await waitFor(page, "won");
    expect(errors).toEqual([]);
  });
});

// --- Game over --------------------------------------------------------------------------

// On the title screen of a page on the fake clock with `?seed=` the run's seed: types the
// run's skill level, starts the game with Enter, holds the run's fire key from its first tick
// until the game is over (and a second more), then lets it go. Returns the game-over screen.
async function playToTheEnd(page: Page, run: Ending): Promise<Shown> {
  await typeSkill(page, [...run.skill.toLowerCase()]);
  await page.clock.runFor(50);
  expect((await shown(page)).skill).toBe(run.skill);
  await page.keyboard.press("Enter");
  await page.keyboard.down(run.key);
  // Before the end, the game goes on; then it is over.
  await page.clock.runFor(ms(run.over - 30));
  const before = await shown(page);
  expect(before.screen, before.label).toBe("playing");
  expect(before.lives).toBe(0);
  await page.clock.runFor(ms(30 + TICKS_PER_SECOND));
  await page.keyboard.up(run.key);
  await page.clock.runFor(50);
  const over = await shown(page);
  expect(over.screen, over.label).toBe("over");
  return over;
}

test.describe("2.2 Player / 3 Presentation: game over after the last life", () => {
  test.setTimeout(180_000);

  test("start → lose every life → game over, with the score, the best and New best!", async ({
    page,
  }) => {
    const run = gameOverRun("A9");
    const errors = await openTitleWithClock(page, `/?seed=${run.seed}`);
    const over = await playToTheEnd(page, run);
    expect(over.score).toBe(run.score);
    expect(over.best).toBe(run.score);
    expect(over.newBest).toBe(true);
    // The game-over screen stays; letters and the game's keys do nothing there.
    await page.clock.runFor(2000);
    for (const key of ["p", "a", "Space", "ArrowUp", "Digit1"]) {
      expect((await pressOnClock(page, key)).screen, key).toBe("over");
    }
    expect(errors).toEqual([]);
  });

  test.describe("plays again at the same skill level, from the same seed", () => {
    for (const key of ["Enter", "r"]) {
      test(`with ${key}; the same score is not a new best`, async ({
        page,
      }) => {
        const run = gameOverRun("A9");
        const errors = await openTitleWithClock(page, `/?seed=${run.seed}`);
        await playToTheEnd(page, run);
        // The new game starts at once, with the digit's lives and nothing scored. The fire key
        // is held from its first tick, as in the first game.
        await page.keyboard.press(key);
        await page.keyboard.down(run.key);
        await page.clock.runFor(50);
        const again = await shown(page);
        expect(again.screen, again.label).toBe("playing");
        expect(again.skill).toBe("A9");
        expect(again.lives).toBe(2);
        expect(again.score).toBe(0);
        expect(again.hives).toBe(createGame(run.seed, "A9").hives.length);
        // Played the same way, it is the same game (3: every game on a `?seed=N` page uses N),
        // and ends with the same score, which is not strictly higher than the best.
        await page.clock.runFor(ms(run.over + TICKS_PER_SECOND));
        await page.keyboard.up(run.key);
        await page.clock.runFor(50);
        const over = await shown(page);
        expect(over.screen, over.label).toBe("over");
        expect(over.score).toBe(run.score);
        expect(over.best).toBe(run.score);
        expect(over.newBest).toBe(false);
        expect(errors).toEqual([]);
      });
    }
  });

  test("Esc goes back to the title, which shows the skill level and its best", async ({
    page,
  }) => {
    const run = gameOverRun("A9");
    const errors = await openTitleWithClock(page, `/?seed=${run.seed}`);
    await playToTheEnd(page, run);
    const title = await pressOnClock(page, "Escape");
    expect(title.screen, title.label).toBe("title");
    expect(title.label).toContain(`Snipes Web v${version}`);
    expect(title.skill).toBe("A9");
    expect(title.best).toBe(run.score);
    // Another digit shows its own best, and Enter starts a game at the skill level shown.
    await page.keyboard.press("3");
    const other = await pressOnClock(page, "Shift+KeyQ");
    expect(other.skill).toBe("Q3");
    expect(other.best).toBe(0);
    const playing = await pressOnClock(page, "Enter");
    expect(playing.screen).toBe("playing");
    expect(playing.skill).toBe("Q3");
    expect(playing.lives).toBe(5);
    expect(errors).toEqual([]);
  });
});

// --- Pause ----------------------------------------------------------------------------------

test.describe("3 Presentation / 4.3 Game loop: pause", () => {
  const PAIRS: [pause: string, resume: string][] = [
    ["p", "p"],
    ["Escape", "Escape"],
    ["Shift+KeyP", "Escape"],
    ["Escape", "p"],
  ];

  for (const [pause, resume] of PAIRS) {
    test(`${pause} pauses: the game stops, even with an arrow key held, and ${resume} resumes it`, async ({
      page,
    }) => {
      // A quiet seed: nothing moves in the view but the player (game.ts). From the start
      // there are 6 open cells to the right of the player's footprint (2.10).
      const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
      expect((await shown(page)).screen).toBe("playing");
      const paused = await pressOnClock(page, pause);
      expect(paused.screen, paused.label).toBe("paused");
      const still = await canvasHash(page);
      await page.keyboard.down("ArrowRight");
      await page.clock.runFor(1500);
      expect((await shown(page)).screen).toBe("paused");
      expect(await canvasHash(page), "the game moved while paused").toBe(still);

      const playing = await pressOnClock(page, resume);
      expect(playing.screen, playing.label).toBe("playing");
      await page.clock.runFor(300);
      await page.keyboard.up("ArrowRight");
      expect(
        await canvasHash(page),
        "the player did not move after resuming",
      ).not.toBe(still);
      expect(errors).toEqual([]);
    });
  }

  test("runs no tick while paused: after resuming, the game goes on from where it stopped", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // A seed in which, with no key held, the player dies after 5 s and is out of play until
    // it comes back, with nothing drawn near it (game.ts). The game is paused a second before
    // the death, for five seconds.
    const sight = deathInSight();
    const errors = await openWithClock(page, `/?seed=${sight.seed}`);
    const floor = await floorPixel(page, CELL_PX);
    const drawn = async (): Promise<boolean> =>
      (await pixelsIn(page, sight.player)).some((p) => p !== floor);
    const pauseAt = sight.died - TICKS_PER_SECOND;
    await page.clock.runFor(ms(pauseAt) - OPEN_MS);
    expect((await pressOnClock(page, "p")).screen).toBe("paused");
    await page.clock.runFor(5000);
    expect((await shown(page)).screen).toBe("paused");
    expect((await pressOnClock(page, "p")).screen).toBe("playing");

    // Half a second later the player is still in play, as it was half a second before its
    // death.
    await page.clock.runFor(500);
    expect(await drawn(), "the player was not drawn before its death").toBe(
      true,
    );
    expect((await shown(page)).lives).toBe(createGame(sight.seed).lives);
    // Halfway between its death and its return it is out of play, with one life fewer.
    const mid = (sight.died + sight.back) / 2;
    await page.clock.runFor(ms(mid - pauseAt) - 600);
    expect(await drawn(), "the player was drawn while out of play").toBe(false);
    expect((await shown(page)).lives).toBe(createGame(sight.seed).lives - 1);
    expect(errors).toEqual([]);
  });

  test("a held P does not resume on its auto-repeat; a new press does", async ({
    page,
  }) => {
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await page.keyboard.down("KeyP");
    await page.clock.runFor(50);
    expect((await shown(page)).screen).toBe("paused");
    for (let i = 0; i < 3; i++) {
      await page.keyboard.down("KeyP");
      await page.clock.runFor(50);
    }
    expect((await shown(page)).screen).toBe("paused");
    await page.keyboard.up("KeyP");
    expect((await pressOnClock(page, "KeyP")).screen).toBe("playing");
    expect(errors).toEqual([]);
  });
});

// --- HUD ------------------------------------------------------------------------------------

test.describe("3 Presentation: the HUD", () => {
  test("shows the score, lives, skill level, hives left and enemies left at the start", async ({
    page,
  }) => {
    const seed = quietSeeds(1)[0];
    const game = createGame(seed);
    const errors = await openWithClock(page, `/?seed=${seed}`);
    // No hive spawns in the first second of a game (WP 09), so no enemy is on the map yet.
    expect(await shown(page)).toMatchObject({
      screen: "playing" satisfies Screen,
      score: 0,
      lives: game.lives,
      skill: "A1",
      hives: game.hives.length,
      enemies: 0,
    });
    expect(errors).toEqual([]);
  });

  test("shows one life fewer once the player has died", async ({ page }) => {
    test.setTimeout(120_000);
    const sight = deathInSight();
    const errors = await openWithClock(page, `/?seed=${sight.seed}`);
    await page.clock.runFor(ms(sight.died - TICKS_PER_SECOND / 2) - OPEN_MS);
    expect((await shown(page)).lives).toBe(createGame(sight.seed).lives);
    await page.clock.runFor(ms(TICKS_PER_SECOND));
    expect((await shown(page)).lives).toBe(createGame(sight.seed).lives - 1);
    expect(errors).toEqual([]);
  });

  test("shows the score, the hives left and the enemies left as the game goes on", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const sight = hiveShotDown();
    const errors = await openTitleWithClock(page, `/?seed=${sight.seed}`);
    await page.keyboard.press("Enter");
    await page.keyboard.down(sight.key);
    await page.clock.runFor(ms(sight.tick));
    const hud = await shown(page);
    await page.keyboard.up(sight.key);
    expect(sight.state.score).toBeGreaterThanOrEqual(100);
    expect(hud).toMatchObject({
      screen: "playing" satisfies Screen,
      score: sight.state.score,
      lives: sight.state.lives,
      hives: sight.state.hives.length,
      enemies: sight.state.snipes.length,
    });
    expect(errors).toEqual([]);
  });
});

// Guards on what the tests above take from the game's own core.
test.describe("2.7 Levels and scoring: the scores the screen tests expect", () => {
  test("a game won on its first tick scores more with more lives", () => {
    expect(wonScore(1)).toBeGreaterThan(wonScore(9));
    expect(wonScore(9)).toBeGreaterThan(0);
    expect(read("Score: 12 Best: 30 New best!")).toMatchObject({
      score: 12,
      best: 30,
      newBest: true,
    });
    expect(read("Best score 30, score 12")).toMatchObject({
      score: 12,
      best: 30,
      newBest: false,
    });
  });
});
