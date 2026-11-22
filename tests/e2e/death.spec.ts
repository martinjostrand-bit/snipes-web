import { expect, test } from "@playwright/test";
import { floorPixel, OPEN_MS, openWithClock, pixelsIn } from "./canvas";
import { CELL_PX, deathInSight, TICKS_PER_SECOND } from "./game";

// Spec 2.2, 3 and 9.1 WP 11 (spec v0.12): while the player is out of play, between its death
// and its return, it is not drawn. The test finds a seed in Node with the game's own core (see
// game.ts) in which the player, with no key held, dies early and nothing else is drawn on or
// next to its footprint until it comes back. Out of play the player stays where it died, so
// its footprint stays in the middle of the view.
//
// The page runs on Playwright's fake clock (canvas.ts `openWithClock`): it draws a frame every
// 16 ms of page time, each running about one tick, however slowly the browser runs, so the
// game is at a known tick when the test looks. On wall time a busy browser gives few frames
// and the game falls behind, as it catches up only so far after a long frame.

// Page time, in ms, at which the game has run `ticks` ticks, give or take a frame or two: the
// page's first frame starts the game, and every later one runs the 16 ms since the last.
function atTick(ticks: number): number {
  return (1000 * ticks) / TICKS_PER_SECOND;
}

test.describe("2.2 Player / 3 Presentation: the player is not drawn while out of play", () => {
  test("the player's place shows only floor after it dies, and it is drawn again once back", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const sight = deathInSight();
    const errors = await openWithClock(page, `/?seed=${sight.seed}`);
    const floor = await floorPixel(page, CELL_PX);
    const drawn = async (): Promise<boolean> =>
      (await pixelsIn(page, sight.player)).some((p) => p !== floor);
    let now = OPEN_MS;

    // In play, the player is drawn: its footprint shows more than floor.
    expect(await drawn(), "the player was not drawn in play").toBe(true);

    // Halfway between its death and its return (at least half a second apart, game.ts), it is
    // out of play, and its place shows only floor.
    const out = atTick((sight.died + sight.back) / 2);
    await page.clock.runFor(out - now);
    now = out;
    expect(await drawn(), "the player was still drawn while out of play").toBe(
      false,
    );

    // Back in play, the view is centred on it again and it is drawn there.
    const back = atTick(sight.back) + 500;
    await page.clock.runFor(back - now);
    expect(await drawn(), "the player was not drawn once back").toBe(true);
    expect(errors).toEqual([]);
  });
});
