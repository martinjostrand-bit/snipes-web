import { expect, test } from "@playwright/test";
import { floorPixel, open, pixelsIn } from "./canvas";
import { CELL_PX, deathInSight, TICKS_PER_SECOND } from "./game";

// Spec 2.2, 3 and 9.1 WP 11 (spec v0.12): while the player is out of play, between its death
// and its return, it is not drawn. The test finds a seed in Node with the game's own core (see
// game.ts) in which the player, with no key held, dies early and nothing else is drawn on or
// next to its footprint until it comes back. Out of play the player stays where it died, so
// its footprint stays in the middle of the view.

test.describe("2.2 Player / 3 Presentation: the player is not drawn while out of play", () => {
  test("the player's place shows only floor after it dies, and it is drawn again once back", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const sight = deathInSight();
    const errors = await open(page, `/?seed=${sight.seed}`);
    const floor = await floorPixel(page, CELL_PX);

    // In play, the player is drawn: its footprint shows more than floor.
    expect((await pixelsIn(page, sight.player)).some((p) => p !== floor)).toBe(
      true,
    );

    // Some frame after its death shows only floor there.
    const wait = (1000 * sight.back) / TICKS_PER_SECOND + 10_000;
    const hidden = await page
      .waitForFunction(
        ({ box, floor }) => {
          const canvas = document.querySelector("canvas");
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return false;
          const image = ctx.getImageData(box.x, box.y, box.width, box.height);
          return new Uint32Array(image.data.buffer).every((p) => p === floor);
        },
        { box: sight.player, floor },
        { polling: "raf", timeout: wait },
      )
      .then(
        () => true,
        () => false,
      );
    expect(hidden, "the player was still drawn while out of play").toBe(true);

    // Back in play, the view is centred on it again and it is drawn there.
    await expect
      .poll(
        async () =>
          (await pixelsIn(page, sight.player)).some((p) => p !== floor),
        { timeout: 10_000 },
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
});
