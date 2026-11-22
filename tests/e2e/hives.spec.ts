import { expect, test } from "@playwright/test";
// A namespace import, so that a missing export fails this test only, not the whole run.
import * as view from "../../src/render/view";
import {
  floorPixel,
  open,
  OPEN_MS,
  openWithClock,
  pixelOf,
  pixelsIn,
} from "./canvas";
import {
  CELL_PX,
  hiveInSight,
  SNIPE_H,
  SNIPE_W,
  snipeInSight,
  TICKS_PER_SECOND,
} from "./game";

// Spec 2.3, 3 and 9.1 WP 09: hives, with their colour stages, and the snipes they spawn are
// drawn. A hive that has taken `hits` hits is drawn in `hiveColour(hits)` (some of its pixels
// have exactly that colour; it may flash). The tests find seeds in Node with the game's own
// core (see game.ts): one whose start view shows a hive the player can shoot without moving,
// and one in which a snipe is spawned in the start view and, as it moves (2.4, WP 10), stays
// for a while in a small area clear of everything else.

const HITS = 20; // a hive withstands 19 hits; the 20th destroys it (2.3)
const FIRE_KEYS: Record<string, string> = {
  "0,-1": "KeyW",
  "-1,0": "KeyA",
  "0,1": "KeyS",
  "1,0": "KeyD",
};

test.describe("2.3 Hives / 3 Presentation: hives are drawn in the colour of their stage", () => {
  test("a hive in view shows its new colour, then a later stage's as the player shoots it", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const sight = hiveInSight();
    const errors = await open(page, `/?seed=${sight.seed}`);

    const stages = await Promise.all(
      Array.from({ length: HITS }, (_, hits) =>
        pixelOf(page, view.hiveColour(hits)),
      ),
    );
    const fresh = stages[0];
    const later = new Set(stages.filter((p) => p !== fresh));
    expect(
      later.size,
      "hiveColour gives one colour for all stages",
    ).toBeGreaterThan(0);

    // Before any hit, some of the hive's pixels have its first colour.
    await expect
      .poll(async () => (await pixelsIn(page, sight.hive)).includes(fresh), {
        timeout: 5000,
      })
      .toBe(true);

    // Holding the fire key, the hive takes a hit every 13 ticks (2.5); before it breaks it is
    // drawn in a later stage's colour.
    const key = FIRE_KEYS[`${sight.fireX},${sight.fireY}`];
    await page.keyboard.down(key);
    const changed = await page
      .waitForFunction(
        ({ box, colours }) => {
          const canvas = document.querySelector("canvas");
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return false;
          const image = ctx.getImageData(box.x, box.y, box.width, box.height);
          return new Uint32Array(image.data.buffer).some((p) =>
            colours.includes(p),
          );
        },
        { box: sight.hive, colours: [...later] },
        { polling: "raf", timeout: 10_000 },
      )
      .then(
        () => true,
        () => false,
      );
    await page.keyboard.up(key);
    expect(changed, "the hive never showed a later stage's colour").toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe("2.3 Hives / 3 Presentation: spawned snipes are drawn", () => {
  test("a snipe spawned in view appears where the game puts it", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const sight = snipeInSight();
    // On Playwright's fake clock the page draws a frame every 16 ms of page time, each
    // running about one tick, however slowly the browser runs (canvas.ts). On wall time, a
    // busy browser gives few frames, and the game, which catches up only so far after a long
    // frame, falls behind: the snipe could come later than any wait.
    const errors = await openWithClock(page, `/?seed=${sight.seed}`);
    const floor = await floorPixel(page, CELL_PX);
    // The snipe is spawned on tick `sight.tick` and stays in the area for two seconds (game.ts);
    // the area is looked at half a second after it appears. The area is open, so before the
    // snipe is drawn it shows only floor; once it is drawn, a good part of the snipe's own
    // cells show something else.
    await page.clock.runFor(
      (1000 * sight.tick) / TICKS_PER_SECOND + 500 - OPEN_MS,
    );
    expect(
      (await pixelsIn(page, sight.snipe)).filter((p) => p !== floor).length,
    ).toBeGreaterThan((SNIPE_W * SNIPE_H * CELL_PX * CELL_PX) / 16);
    expect(errors).toEqual([]);
  });
});
