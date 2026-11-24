import { expect, test, type Page } from "@playwright/test";
import {
  canvasHash,
  canvasLabel,
  OPEN_MS,
  openTitleWithClock,
  openWithClock,
  TITLE_MS,
} from "./canvas";
import { quietSeeds, TICKS_PER_SECOND } from "./game";
import { gameOverRun, shown, type Ending, type Shown } from "./screens";
import {
  audioRenders,
  deathTicks,
  expectHeardMore,
  fireTicks,
  listen,
  play,
  quiet,
} from "./sound";

// Spec 2.8, 3 (Sound, Keys) and 9.1 WP 14 (v0.18): short beeps made with the Web Audio API
// for a shot, a hit, a hive destroyed and a death, with no audio files. M toggles mute while
// playing, paused, and on the won and game-over screens, without changing the screen: it
// neither pauses nor resumes the game. On the title screen every letter key, M included, only
// sets the skill letter (3). Letter keys work in either case (2.8): "m", "M" with Shift, and
// "M" without Shift (as with Caps Lock on).
//
// Mute carries into the next game and is stored locally, so it survives a reload. Sound
// starts muted when, and only when, storage can be read and holds exactly the value the game
// itself writes for muted, also when storage cannot be written. With nothing stored, with
// storage that cannot be read, or with any other stored value, sound starts on. If storage
// can be read but not written, M still mutes and unmutes for the rest of the page's life, and
// nothing is stored. Without Web Audio the game runs silently without errors.
//
// Keys (3): the screen, skill-level, pause and mute keys act on a key press, not on its
// auto-repeat. Playwright sends a `keydown` with `repeat` set when `keyboard.down` is called
// again for a key already down, as a key held long enough for the keyboard to repeat it. So a
// held M toggles mute once, and on the title a held letter or digit typed before another one
// does not set the skill level back when it repeats.
//
// Where the game stores mute, and the value it writes for muted, are its own: a test finds
// them by comparing local storage before and after M.
//
// What the page plays is heard at its Web Audio destination (sound.ts). The game runs on
// Playwright's fake clock (canvas.ts), so it is at a known tick when the test acts; the
// sound itself plays on the wall clock. The fake clock stays installed when the page is
// reloaded or opened at another address, paused, so the page only moves on with
// `page.clock.runFor`. Each test starts with empty storage (a new browser context), so sound
// is on at first.
//
// The quiet seeds (game.ts) are games at A1 in which, with no key held, nothing comes near
// the start view for a minute; there, for at least the first minute, no snipe fires, nothing
// is hit and the player does not die, so the only sounds are those of the player's own
// shots, which stop at the corridor's wall (2.5). D fires to the right.
//
// A test that expects silence first hears the page play in the same way, so that a page that
// plays nothing at all does not pass it.

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

// Holds D for `ms` of page time, then lets it go.
async function fireFor(page: Page, time: number): Promise<void> {
  await page.keyboard.down("KeyD");
  await play(page, time);
  await page.keyboard.up("KeyD");
}

// Loads the page again, at `path` or, without it, at the same address, on the fake clock, and
// runs it for TITLE_MS, showing the title screen.
async function reopen(page: Page, path?: string): Promise<void> {
  if (path === undefined) await page.reload();
  else await page.goto(path);
  await page.clock.runFor(TITLE_MS);
  expect(await canvasLabel(page)).toContain("Snipes Web");
}

// On the title screen of a page on the fake clock: types the skill level `skill`.
async function typeSkill(page: Page, skill: string): Promise<void> {
  for (const key of skill.toLowerCase()) await page.keyboard.press(key);
  await page.clock.runFor(50);
  expect((await shown(page)).skill).toBe(skill);
}

// On the title screen at the run's skill level, or on an end screen after a game at it, of a
// page on the fake clock opened with the run's seed: starts a game by pressing `start` and
// holds the run's fire key from its first tick for `ticks` ticks, then lets it go.
async function startRun(
  page: Page,
  run: Ending,
  start: string,
  ticks: number,
): Promise<void> {
  await page.keyboard.press(start);
  await page.keyboard.down(run.key);
  await play(page, ms(ticks));
  await page.keyboard.up(run.key);
}

// Like `startRun`, until the game is over and a second more. The game ends as worked out in
// Node (screens.ts): sound and mute change nothing in it. Returns the game-over screen.
async function playRun(page: Page, run: Ending, start: string): Promise<Shown> {
  await startRun(page, run, start, run.over + TICKS_PER_SECOND);
  await page.clock.runFor(50);
  const over = await shown(page);
  expect(over.screen, over.label).toBe("over");
  expect(over.score).toBe(run.score);
  return over;
}

// What a won or game-over screen shows (3): the screen, the score, the best and "New best!".
// The rest of its label is left out, so that the page may also show whether it is muted.
function endScreen(
  end: Shown,
): Pick<Shown, "screen" | "score" | "best" | "newBest"> {
  return {
    screen: end.screen,
    score: end.score,
    best: end.best,
    newBest: end.newBest,
  };
}

// Sends `times` auto-repeats of `code`, a key already held down, on the fake clock.
async function autoRepeat(page: Page, code: string, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(code);
    await page.clock.runFor(50);
  }
}

// Every entry in the page's local storage.
function stored(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = key === null ? null : localStorage.getItem(key);
      if (key !== null && value !== null) entries[key] = value;
    }
    return entries;
  });
}

// While playing with sound on and storage working: presses M, which mutes, and returns the
// local storage entries it added or changed: where the game stores mute, holding the value it
// writes for muted.
async function muteStored(page: Page): Promise<Record<string, string>> {
  const before = await stored(page);
  expect((await pressOnClock(page, "m")).screen).toBe("playing");
  const after = await stored(page);
  const changed = Object.fromEntries(
    Object.entries(after).filter(([key, value]) => before[key] !== value),
  );
  expect(Object.keys(changed), "M stored nothing").not.toEqual([]);
  return changed;
}

// Sets every key of `entries` in the page's local storage to `value`.
async function storeAll(
  page: Page,
  entries: Record<string, string>,
  value: string,
): Promise<void> {
  await page.evaluate(
    ([keys, to]) => {
      for (const key of keys) localStorage.setItem(key, to);
    },
    [Object.keys(entries), value] as const,
  );
}

// Init scripts (page.addInitScript) for local storage that is not fully available. They run
// in the page, so they cannot use anything from this module.

// Storage that cannot be read: using it throws, as when the browser turns it off.
function unreadableStorage(): void {
  Object.defineProperty(window, "localStorage", {
    get() {
      throw new DOMException("Storage is turned off", "SecurityError");
    },
  });
}

// Storage that can be read but not written: every change to it throws, as when it is full.
function unwritableStorage(): void {
  const refuse = (): never => {
    throw new DOMException("The quota has been exceeded", "QuotaExceededError");
  };
  Storage.prototype.setItem = refuse;
  Storage.prototype.removeItem = refuse;
  Storage.prototype.clear = refuse;
}

// Starts a game on the title screen and fires for `time` ms of page time.
async function startAndFire(page: Page, time: number): Promise<void> {
  expect((await pressOnClock(page, "Enter")).screen).toBe("playing");
  await play(page, OPEN_MS);
  await fireFor(page, time);
}

const NO_AUDIO = "This browser plays no Web Audio here";
const AUDIO_FILE =
  /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|mid|midi)(\?|#|$)/i;

test.describe("3 Presentation: sound", () => {
  test("a shot the player fires is heard, made with the Web Audio API and no audio file", async ({
    page,
  }) => {
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    const files: string[] = [];
    page.on("request", (request) => {
      if (
        request.resourceType() === "media" ||
        AUDIO_FILE.test(request.url())
      ) {
        files.push(request.url());
      }
    });
    page.on("response", (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (type.startsWith("audio/")) files.push(response.url());
    });
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await play(page, 1000);
    const before = await quiet(page);

    await fireFor(page, 1000);
    await expectHeardMore(page, before, "the player's shots were not heard");
    expect((await shown(page)).screen).toBe("playing");
    expect(files, "the page loaded audio files").toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("2.8 Controls / 3 Presentation: M on the title only sets the letter", () => {
  test("M on the title does not mute: the game started after it is heard", async ({
    page,
  }) => {
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openTitleWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    // Three presses of M: if each toggled mute, the game would start muted.
    await page.keyboard.press("m");
    await expect.poll(async () => (await shown(page)).skill).toBe("M1");
    await page.keyboard.press("Shift+KeyM");
    await page.keyboard.press("m");
    expect((await shown(page)).screen).toBe("title");
    await page.keyboard.press("a");
    await expect.poll(async () => (await shown(page)).skill).toBe("A1");
    expect((await pressOnClock(page, "Enter")).screen).toBe("playing");
    await play(page, OPEN_MS);
    const before = await quiet(page);

    await fireFor(page, 1000);
    await expectHeardMore(
      page,
      before,
      "M typed on the title muted the game started after it",
    );
    expect(errors).toEqual([]);
  });

  test("M on the title does not unmute a stored mute either: the game started after it is silent", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    // Sound is on at first; M mutes it, and the mute is stored.
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    expect((await pressOnClock(page, "m")).screen).toBe("playing");

    // After a reload, M typed on the title only sets the letter.
    await reopen(page);
    for (const key of ["m", "Shift+KeyM", "m"]) {
      const title = await pressOnClock(page, key);
      expect(title.screen, key).toBe("title");
      expect(title.skill, key).toBe("M1");
    }
    expect((await pressOnClock(page, "a")).skill).toBe("A1");
    expect((await pressOnClock(page, "Enter")).screen).toBe("playing");
    await play(page, OPEN_MS);
    const muted = await quiet(page);
    await fireFor(page, 1500);
    expect(
      await quiet(page),
      "M typed on the title unmuted the game started after it",
    ).toBe(muted);

    // In the game, M unmutes.
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(page, muted, "M in the game did not unmute");
    expect(errors).toEqual([]);
  });
});

test.describe("2.8 Controls / 3 Presentation: M mutes and unmutes while playing", () => {
  test("M mutes, also before any sound, M again unmutes, and a third M mutes again; the game goes on", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);

    // Muted at once, before anything has been played: the shots are not heard. M is not a
    // pause key: the game goes on.
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    const muted = await quiet(page);
    await fireFor(page, 1500);
    expect(await quiet(page), "a shot was heard while muted").toBe(muted);
    expect((await shown(page)).screen).toBe("playing");

    // Unmuted: the shots are heard again.
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(
      page,
      muted,
      "the shots were not heard after unmuting",
    );

    // Muted again, after sounds have been played: silence again.
    const before = await quiet(page);
    expect((await pressOnClock(page, "Shift+KeyM")).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(await quiet(page), "a shot was heard after muting again").toBe(
      before,
    );
    expect(errors).toEqual([]);
  });

  test("muting and unmuting during a game changes nothing in it: shots and a death are silent while muted, and the game ends as it would have", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    // A game at A9 (2 lives) that is soon over, with a fire key held from its first tick
    // (screens.ts), worked out in Node: the ticks on which the player fires, and on which it
    // dies. It is muted after its fourth shot and unmuted 6 ticks before its sixth last shot;
    // a death falls between.
    const run = gameOverRun("A9");
    const fired = fireTicks(run);
    const died = deathTicks(run);
    const muteAt = fired[3] + 6;
    const unmuteAt = fired[fired.length - 6] - 6;
    expect(
      died.some((tick) => tick > muteAt && tick < unmuteAt),
      "no death while muted",
    ).toBe(true);
    expect(unmuteAt).toBeGreaterThan(muteAt);
    expect(died.at(-1)).toBeLessThan(run.over);

    await listen(page);
    const errors = await openTitleWithClock(page, `/?seed=${run.seed}`);
    await typeSkill(page, run.skill);
    await page.keyboard.press("Enter");
    await page.keyboard.down(run.key);
    let now = 0;
    const playTo = async (tick: number): Promise<void> => {
      await play(page, ms(tick) - now);
      now = ms(tick);
    };

    // Sound on: the first shots are heard.
    await playTo(muteAt);
    await expectHeardMore(page, 0, "the first shots were not heard");

    // Muted: nothing is heard, through shots, hits and a death.
    await page.keyboard.press("m");
    const muted = await quiet(page);
    await playTo(unmuteAt);
    expect(await quiet(page), "a sound was heard while muted").toBe(muted);
    expect((await shown(page)).screen).toBe("playing");

    // Unmuted: the last shots are heard again.
    await page.keyboard.press("m");
    await playTo(run.over - 30);
    await expectHeardMore(page, muted, "nothing was heard after unmuting");

    // The game ends as worked out in Node: muting changed nothing in it.
    const before = await shown(page);
    expect(before.screen, before.label).toBe("playing");
    expect(before.lives).toBe(0);
    await playTo(run.over + TICKS_PER_SECOND);
    await page.keyboard.up(run.key);
    await page.clock.runFor(50);
    const over = await shown(page);
    expect(over.screen, over.label).toBe("over");
    expect(over.score).toBe(run.score);
    expect(errors).toEqual([]);
  });
});

test.describe("2.8 Controls / 3 Presentation: M while paused", () => {
  test("M mutes and unmutes while paused, without resuming the game", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    const before = await quiet(page);

    // Paused, M mutes: the game stays paused and does not move, with an arrow key held.
    expect((await pressOnClock(page, "p")).screen).toBe("paused");
    const still = await canvasHash(page);
    await page.keyboard.down("ArrowRight");
    const paused = await pressOnClock(page, "m");
    expect(paused.screen, `M resumed the game: ${paused.label}`).toBe("paused");
    await page.clock.runFor(1000);
    await page.keyboard.up("ArrowRight");
    expect((await shown(page)).screen).toBe("paused");
    expect(await canvasHash(page), "the game moved while paused").toBe(still);
    // One press of P resumes, and the shots are not heard.
    expect((await pressOnClock(page, "p")).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(await quiet(page), "a shot was heard after muting in pause").toBe(
      before,
    );

    // Paused again, M unmutes, with Esc as the pause key this time.
    expect((await pressOnClock(page, "Escape")).screen).toBe("paused");
    const again = await pressOnClock(page, "Shift+KeyM");
    expect(again.screen, `M resumed the game: ${again.label}`).toBe("paused");
    await page.clock.runFor(500);
    expect((await shown(page)).screen).toBe("paused");
    expect((await pressOnClock(page, "Escape")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(
      page,
      before,
      "the shots were not heard after unmuting in pause",
    );
    expect(errors).toEqual([]);
  });
});

test.describe("2.8 Controls / 3 Presentation: M on the won screen, with ?won=1 (4.3)", () => {
  // Every game on a `?won=1` page is won on its first tick and plays nothing, so what M did
  // on the won screen is heard in a game on the same site opened at the quiet seed's address.
  test("M mutes and unmutes on the won screen, which stays as it was", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const quietPath = `/?seed=${quietSeeds(1)[0]}`;
    const errors = await openTitleWithClock(page, "/?won=1");
    const won = await pressOnClock(page, "Enter");
    expect(won.screen, won.label).toBe("won");
    expect(won.newBest).toBe(true);

    // M mutes, and the won screen stays as it was.
    expect(await pressOnClock(page, "m")).toMatchObject(endScreen(won));
    await page.clock.runFor(500);
    expect(await shown(page)).toMatchObject(endScreen(won));
    // The next game is silent; M there unmutes it, so sound works in it.
    await reopen(page, quietPath);
    expect((await pressOnClock(page, "Enter")).screen).toBe("playing");
    await play(page, OPEN_MS);
    await fireFor(page, 1500);
    expect(
      await quiet(page),
      "a shot was heard after muting on the won screen",
    ).toBe(0);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "M in the game did not unmute");
    expect((await pressOnClock(page, "m")).screen).toBe("playing");

    // Muted again; on the won screen M unmutes, and the won screen stays as it was.
    await reopen(page, "/?won=1");
    const second = await pressOnClock(page, "Enter");
    expect(second.screen, second.label).toBe("won");
    expect(await pressOnClock(page, "Shift+KeyM")).toMatchObject(
      endScreen(second),
    );
    await reopen(page, quietPath);
    expect((await pressOnClock(page, "Enter")).screen).toBe("playing");
    await play(page, OPEN_MS);
    await fireFor(page, 1000);
    await expectHeardMore(
      page,
      0,
      "the shots were not heard after unmuting on the won screen",
    );
    expect(errors).toEqual([]);
  });
});

test.describe("2.8 Controls / 3 Presentation: M on the game-over screen, and mute carried into the next game", () => {
  test.setTimeout(180_000);

  test("M mutes on the game-over screen, which stays as it was; the next game (R) is silent; M there unmutes again", async ({
    page,
  }) => {
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    const run = gameOverRun("A9");
    await listen(page);
    const errors = await openTitleWithClock(page, `/?seed=${run.seed}`);
    await typeSkill(page, run.skill);

    // A first game, heard, to its end.
    const over = await playRun(page, run, "Enter");
    expect(over.newBest).toBe(true);
    const before = await quiet(page);
    expect(before, "the first game was not heard").toBeGreaterThan(0);

    // M mutes: the game-over screen stays as it was.
    expect(await pressOnClock(page, "m")).toMatchObject(endScreen(over));
    await page.clock.runFor(500);
    expect(await shown(page)).toMatchObject(endScreen(over));

    // R plays again, muted: the same game, through shots, hits and deaths, is silent.
    const second = await playRun(page, run, "r");
    expect(second.newBest).toBe(false);
    expect(await quiet(page), "a sound was heard in the next game").toBe(
      before,
    );

    // M unmutes on the game-over screen, which stays as it was; the next game is heard.
    expect(await pressOnClock(page, "Shift+KeyM")).toMatchObject(
      endScreen(second),
    );
    await startRun(page, run, "r", 300);
    await expectHeardMore(
      page,
      before,
      "the shots were not heard after unmuting on the game-over screen",
    );
    expect((await shown(page)).screen).toBe("playing");
    expect(errors).toEqual([]);
  });

  test("a mute set while playing carries through the game-over screen and the title into the next game", async ({
    page,
  }) => {
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    const run = gameOverRun("A9");
    const muteAt = fireTicks(run)[3] + 6;
    await listen(page);
    const errors = await openTitleWithClock(page, `/?seed=${run.seed}`);
    await typeSkill(page, run.skill);

    // Heard, then muted while playing, to the end of the game.
    await page.keyboard.press("Enter");
    await page.keyboard.down(run.key);
    await play(page, ms(muteAt));
    await expectHeardMore(page, 0, "the first shots were not heard");
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    const muted = await quiet(page);
    await play(page, ms(run.over + TICKS_PER_SECOND - muteAt));
    await page.keyboard.up(run.key);
    await page.clock.runFor(50);
    const over = await shown(page);
    expect(over.screen, over.label).toBe("over");
    expect(over.score).toBe(run.score);

    // Esc to the title and Enter: the next game is silent.
    const title = await pressOnClock(page, "Escape");
    expect(title.screen, title.label).toBe("title");
    expect(title.skill).toBe(run.skill);
    await startRun(page, run, "Enter", 300);
    expect((await shown(page)).screen).toBe("playing");
    expect(await quiet(page), "a sound was heard in the next game").toBe(muted);

    // M unmutes it.
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await page.keyboard.down(run.key);
    await play(page, 1000);
    await page.keyboard.up(run.key);
    await expectHeardMore(page, muted, "M in the next game did not unmute");
    expect(errors).toEqual([]);
  });
});

test.describe("3 Presentation: mute is stored locally", () => {
  test("mute survives a reload, and so does unmute", async ({ page }) => {
    test.setTimeout(90_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    // Sound is on at first.
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    expect((await pressOnClock(page, "m")).screen).toBe("playing");

    // After a reload the game is muted.
    await reopen(page);
    expect((await pressOnClock(page, "Enter")).screen).toBe("playing");
    await play(page, OPEN_MS);
    await fireFor(page, 1500);
    expect(await quiet(page), "a shot was heard after the reload").toBe(0);
    // M unmutes, and the shots are heard.
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "M after the reload did not unmute");

    // After another reload the game is not muted.
    await reopen(page);
    expect((await pressOnClock(page, "Enter")).screen).toBe("playing");
    await play(page, OPEN_MS);
    await fireFor(page, 1000);
    await expectHeardMore(
      page,
      0,
      "the shots were not heard after unmuting and reloading",
    );
    expect(errors).toEqual([]);
  });

  test("a stored value other than the game's own muted value starts sound on", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    // M mutes, and stores the game's own muted value.
    const muted = await muteStored(page);
    const values = new Set(Object.values(muted));
    expect(values.size, "M stored more than one value").toBe(1);
    const [own] = values;

    // Values near the game's own muted value, and values another program might write for
    // muted, each in place of the game's own: sound starts on.
    const swapped =
      own.toUpperCase() === own ? own.toLowerCase() : own.toUpperCase();
    const others = [
      "",
      ` ${own}`,
      `${own} `,
      `${own}0`,
      swapped,
      `"${own}"`,
      "1",
      "true",
      "muted",
      "{not json",
    ].filter((value, i, all) => value !== own && all.indexOf(value) === i);
    for (const other of others) {
      await storeAll(page, muted, other);
      await reopen(page);
      await startAndFire(page, 1000);
      await expectHeardMore(
        page,
        0,
        `sound did not start on with "${other}" stored instead of "${own}"`,
      );
    }

    // The game's own muted value, stored again: sound starts muted.
    await storeAll(page, muted, own);
    await reopen(page);
    await startAndFire(page, 1500);
    expect(
      await quiet(page),
      `a shot was heard with the game's own "${own}" stored`,
    ).toBe(0);
    expect(errors).toEqual([]);
  });

  test("when storage can be read but not written, a stored muted value starts sound muted, M still mutes and unmutes, and nothing is stored", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    // Muted with working storage: the muted value is stored.
    await muteStored(page);

    // From the reload on, storage can be read but not written: sound starts muted.
    await page.addInitScript(unwritableStorage);
    await reopen(page);
    await startAndFire(page, 1500);
    expect(
      await quiet(page),
      "a shot was heard with a muted value stored",
    ).toBe(0);

    // M unmutes, mutes and unmutes again, though nothing can be stored.
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "M did not unmute");
    const before = await quiet(page);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(await quiet(page), "M did not mute again").toBe(before);
    expect((await pressOnClock(page, "Shift+KeyM")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(page, before, "M did not unmute again");

    // Nothing was stored: after a reload the stored muted value still starts sound muted.
    await reopen(page);
    await startAndFire(page, 1500);
    expect(
      await quiet(page),
      "a shot was heard after a reload: the unmute was stored",
    ).toBe(0);
    expect(errors).toEqual([]);
  });

  test("when storage can be read but not written and nothing is stored, M still mutes, and after a reload sound starts on", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await page.addInitScript(unwritableStorage);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    const before = await quiet(page);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(await quiet(page), "a shot was heard while muted").toBe(before);

    await reopen(page);
    await startAndFire(page, 1000);
    await expectHeardMore(
      page,
      0,
      "sound did not start on after a reload with nothing stored",
    );
    expect(errors).toEqual([]);
  });

  test("when storage cannot be read, sound starts on, also with a muted value stored, and M still mutes and unmutes", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    // Muted with working storage: the muted value is stored.
    await muteStored(page);

    // From the reload on, storage cannot be read: sound starts on.
    await page.addInitScript(unreadableStorage);
    await reopen(page);
    await startAndFire(page, 1000);
    await expectHeardMore(
      page,
      0,
      "sound did not start on with storage that cannot be read",
    );

    // M mutes and unmutes.
    const before = await quiet(page);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(await quiet(page), "M did not mute").toBe(before);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(page, before, "M did not unmute");
    expect(errors).toEqual([]);
  });
});

test.describe("2.8 Controls: M works in either case", () => {
  test('"M" without Shift (Caps Lock) mutes, Shift+M unmutes, and "m" mutes again', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    const before = await quiet(page);

    // Playwright's "M" sends the key "M" without Shift held, as with Caps Lock on.
    expect((await pressOnClock(page, "M")).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(await quiet(page), '"M" did not mute').toBe(before);

    expect((await pressOnClock(page, "Shift+KeyM")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(page, before, "Shift+M did not unmute");

    const again = await quiet(page);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(await quiet(page), '"m" did not mute').toBe(again);
    expect(errors).toEqual([]);
  });
});

test.describe("3 Presentation (Keys): a key acts on its press, not on its auto-repeat", () => {
  test("a held M toggles mute once, while playing and while paused", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    test.skip(!(await audioRenders(page)), NO_AUDIO);
    await listen(page);
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await fireFor(page, 1000);
    await expectHeardMore(page, 0, "the player's shots were not heard");
    const before = await quiet(page);

    // Held while playing, with three auto-repeats: muted once. Had each repeat toggled, the
    // four keydowns would have left sound on.
    await page.keyboard.down("KeyM");
    await page.clock.runFor(50);
    await autoRepeat(page, "KeyM");
    await page.keyboard.up("KeyM");
    expect((await shown(page)).screen).toBe("playing");
    await fireFor(page, 1500);
    expect(
      await quiet(page),
      "a shot was heard after a held M: its auto-repeats toggled mute",
    ).toBe(before);

    // Held while paused, with three auto-repeats: unmuted once, and still paused.
    expect((await pressOnClock(page, "p")).screen).toBe("paused");
    await page.keyboard.down("KeyM");
    await page.clock.runFor(50);
    await autoRepeat(page, "KeyM");
    await page.keyboard.up("KeyM");
    const paused = await shown(page);
    expect(paused.screen, paused.label).toBe("paused");
    expect((await pressOnClock(page, "p")).screen).toBe("playing");
    await fireFor(page, 1000);
    await expectHeardMore(
      page,
      before,
      "no shot was heard after a held M: its auto-repeats toggled mute",
    );
    expect(errors).toEqual([]);
  });

  test("on the title, the auto-repeat of a letter or digit typed earlier does not set the skill level back", async ({
    page,
  }) => {
    const errors = await openTitleWithClock(page, "/");
    // C held, D typed, C repeats: the letter stays D.
    await page.keyboard.down("KeyC");
    await page.clock.runFor(50);
    expect((await shown(page)).skill).toBe("C1");
    expect((await pressOnClock(page, "d")).skill).toBe("D1");
    await autoRepeat(page, "KeyC");
    expect((await shown(page)).skill, "C's auto-repeat set the letter").toBe(
      "D1",
    );
    await page.keyboard.up("KeyC");

    // 3 held, 5 typed, 3 repeats: the digit stays 5.
    await page.keyboard.down("Digit3");
    await page.clock.runFor(50);
    expect((await shown(page)).skill).toBe("D3");
    expect((await pressOnClock(page, "5")).skill).toBe("D5");
    await autoRepeat(page, "Digit3");
    expect((await shown(page)).skill, "3's auto-repeat set the digit").toBe(
      "D5",
    );
    await page.keyboard.up("Digit3");

    // M held, A typed, M repeats: on the title M is a letter, and its repeat does nothing.
    await page.keyboard.down("KeyM");
    await page.clock.runFor(50);
    expect((await shown(page)).skill).toBe("M5");
    expect((await pressOnClock(page, "a")).skill).toBe("A5");
    await autoRepeat(page, "KeyM");
    const title = await shown(page);
    expect(title.screen).toBe("title");
    expect(title.skill, "M's auto-repeat set the letter").toBe("A5");
    await page.keyboard.up("KeyM");

    const playing = await pressOnClock(page, "Enter");
    expect(playing.screen, playing.label).toBe("playing");
    expect(playing.skill).toBe("A5");
    expect(errors).toEqual([]);
  });
});

test.describe("3 Presentation: without Web Audio", () => {
  test("the game runs silently without errors, with M while playing, paused and on the won screen", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      for (const name of [
        "AudioContext",
        "webkitAudioContext",
        "OfflineAudioContext",
        "AudioWorkletNode",
      ]) {
        Reflect.deleteProperty(window, name);
      }
    });
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    expect((await pressOnClock(page, "m")).screen).toBe("playing");
    await fireFor(page, 1000);
    expect((await shown(page)).screen).toBe("playing");

    expect((await pressOnClock(page, "p")).screen).toBe("paused");
    expect((await pressOnClock(page, "m")).screen).toBe("paused");
    expect((await pressOnClock(page, "p")).screen).toBe("playing");
    await fireFor(page, 1000);
    expect((await shown(page)).screen).toBe("playing");

    await reopen(page, "/?won=1");
    const won = await pressOnClock(page, "Enter");
    expect(won.screen, won.label).toBe("won");
    expect(await pressOnClock(page, "m")).toMatchObject(endScreen(won));
    expect((await pressOnClock(page, "Enter")).screen).toBe("won");
    expect(errors).toEqual([]);
  });
});
