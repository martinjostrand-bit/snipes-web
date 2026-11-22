import { expect, test, type Page } from "@playwright/test";
import { floorPixel, openWithClock } from "./canvas";
import {
  CELL_PX,
  PLAYER_ON_CANVAS,
  quietSeeds,
  snipeInSight,
  TICKS_PER_SECOND,
  VIEW_COLS,
  VIEW_ROWS,
} from "./game";

// Spec 3 (Motion and View) and 9.1 WP 11b: the logic moves in whole cells of 16 x 16 pixels,
// but the screen shows smooth motion. Between two steps the player and each snipe are drawn
// sliding from the cell of their last step to their current cell, and the view follows the
// player's drawn position, so it scrolls smoothly while the player's footprint stays in the
// middle of the view.
//
// The tests record what the page draws, frame by frame, with a requestAnimationFrame loop in
// the page. They run the page on Playwright's fake clock (`openWithClock`), so that it draws
// a frame every 16 ms of page time, as on a display of about 60 Hz, however few frames per
// second a busy machine gives the browser. Drawing is smooth (anti-aliased), so pictures are
// compared by how much their pixels differ, not by exact equality.

const WIDTH = VIEW_COLS * CELL_PX;
const HEIGHT = (VIEW_ROWS + 1) * CELL_PX;

interface Recorder {
  frames: unknown[];
  on: boolean;
}

interface RecorderWindow {
  recorder: Recorder;
}

// --- The view while the player moves -------------------------------------------------------

// What is kept of each frame: the brightness of every 16th row of the view (leaving out the
// HUD row and the player's rows), and of the lower half of the player's footprint (its beak,
// where the eyes do not blink, 3) with MARGIN pixels on either side.
const MARGIN = 8;
const MAX_SHIFT = 7 * CELL_PX;

interface ViewFrame {
  readonly rows: number[];
  readonly beak: number[];
}

async function recordView(page: Page): Promise<void> {
  await page.evaluate(
    ({ player, margin, width, height, cell }) => {
      const recorder: Recorder = { frames: [], on: true };
      (window as unknown as RecorderWindow).recorder = recorder;
      const canvas = document.querySelector("canvas");
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("No canvas with a 2D context");
      const rows: number[] = [];
      for (let y = cell + 5; y < height; y += cell) {
        if (y < player.y || y >= player.y + player.height) rows.push(y);
      }
      const light = (d: Uint8ClampedArray, i: number): number =>
        2 * d[i] + 5 * d[i + 1] + d[i + 2];
      const frame = (): void => {
        if (!recorder.on) return;
        const image = ctx.getImageData(0, 0, width, height).data;
        const kept: number[] = [];
        for (const y of rows) {
          for (let x = 0; x < width; x++)
            kept.push(light(image, 4 * (y * width + x)));
        }
        const beak: number[] = [];
        const top = player.y + player.height / 2;
        for (let y = top; y < player.y + player.height; y++) {
          for (
            let x = player.x - margin;
            x < player.x + player.width + margin;
            x++
          ) {
            beak.push(light(image, 4 * (y * width + x)));
          }
        }
        recorder.frames.push({ rows: kept, beak });
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    {
      player: PLAYER_ON_CANVAS,
      margin: MARGIN,
      width: WIDTH,
      height: HEIGHT,
      cell: CELL_PX,
    },
  );
}

// Spec 3: the canvas is 80 x 44 cells plus the HUD row, 16 x 16 pixels each, so the pixels
// the tests read are where they expect them.
async function expectCanvasSize(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas ? [canvas.width, canvas.height] : [];
  });
  expect(size).toEqual([WIDTH, HEIGHT]);
}

// The frames come back as one JSON string: Playwright passes an array of numbers value by
// value, which for the millions of numbers of the view's frames takes longer than the test
// may run, while a string of the same data takes well under a second.
async function stopRecording<T>(page: Page): Promise<T[]> {
  const json = await page.evaluate(() => {
    const recorder = (window as unknown as RecorderWindow).recorder;
    recorder.on = false;
    return JSON.stringify(recorder.frames);
  });
  return JSON.parse(json) as T[];
}

// The number of pixels the maze has moved left in `after` compared with `before` (the pixel
// at x after is the one at x + shift before), from 0 to MAX_SHIFT: the shift with the
// smallest difference.
function shiftLeft(before: ViewFrame, after: ViewFrame): number {
  const rows = before.rows.length / WIDTH;
  let best = 0;
  let least = Infinity;
  for (let shift = 0; shift <= MAX_SHIFT; shift++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      const base = r * WIDTH;
      for (let x = 0; x + shift < WIDTH; x++) {
        sum += Math.abs(after.rows[base + x] - before.rows[base + x + shift]);
      }
    }
    const mean = sum / (rows * (WIDTH - shift));
    if (mean < least) {
      least = mean;
      best = shift;
    }
  }
  return best;
}

// How many pixels the beak has moved right in `after` compared with `before`, from -MARGIN to
// MARGIN: the offset with the smallest difference, the smallest offset on a tie.
function beakOffset(before: ViewFrame, after: ViewFrame): number {
  const span = PLAYER_ON_CANVAS.width + 2 * MARGIN;
  const rows = before.beak.length / span;
  let best = 0;
  let least = Infinity;
  for (const offset of [
    0,
    ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((o) => [-o, o]),
  ]) {
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      for (let x = MARGIN; x < span - MARGIN; x++) {
        sum += Math.abs(
          after.beak[r * span + x] - before.beak[r * span + x - offset],
        );
      }
    }
    if (sum < least) {
      least = sum;
      best = offset;
    }
  }
  return best;
}

test.describe("3 Presentation: Motion — the view follows the player's drawn position", () => {
  test("scrolls smoothly, by part of a cell between steps, and keeps the player in the middle", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = await openWithClock(page, `/?seed=${quietSeeds(1)[0]}`);
    await expectCanvasSize(page);
    await recordView(page);
    await page.clock.runFor(100);
    // From the start there are 6 open cells to the right of the player's footprint (2.10).
    // Held for 50 ms of page time (3 ticks), the player takes one or two steps (2.2).
    await page.keyboard.down("ArrowRight");
    await page.clock.runFor(50);
    await page.keyboard.up("ArrowRight");
    await page.clock.runFor(700);
    const frames = await stopRecording<ViewFrame>(page);
    // A frame every 16 ms of page time.
    expect(frames.length).toBeGreaterThan(40);

    const [before] = frames;
    const shifts = frames.map((f) => shiftLeft(before, f));
    const final = shifts[shifts.length - 1];
    // Settled: the player has arrived on whole cells, a few of them to the right.
    expect(shifts[shifts.length - 2], `shifts ${shifts.join(",")}`).toBe(final);
    expect(final, `shifts ${shifts.join(",")}`).toBeGreaterThan(0);
    expect(final % CELL_PX, `shifts ${shifts.join(",")}`).toBe(0);
    // On the way, some frames show the maze moved by part of a cell.
    const between = shifts.filter(
      (s) => s > 0 && s < final && s % CELL_PX !== 0,
    );
    expect(between.length, `shifts ${shifts.join(",")}`).toBeGreaterThan(0);
    // In every frame the player is drawn in the middle of the view.
    const offsets = frames.map((f) => beakOffset(before, f));
    expect(
      offsets.filter((o) => Math.abs(o) > 1),
      `offsets ${offsets.join(",")} with shifts ${shifts.join(",")}`,
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// --- A moving snipe ------------------------------------------------------------------------

interface SnipeFrame {
  /** How much the area differs from the floor, summed over its pixels. */
  readonly weight: number;
  /** The centre of that difference, in canvas pixels. */
  readonly x: number;
  readonly y: number;
}

test.describe("3 Presentation: Motion — a moving snipe is drawn between cells", () => {
  test("a snipe in view slides a little from frame to frame instead of jumping a cell at a time", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // A seed in which a snipe appears in the start view and moves for a while in a small
    // open area, alone there (game.ts).
    const sight = snipeInSight();
    const errors = await openWithClock(page, `/?seed=${sight.seed}`);
    await expectCanvasSize(page);
    const floor = await floorPixel(page, CELL_PX);
    await page.evaluate(
      ({ box, floor }) => {
        const recorder: Recorder = { frames: [], on: true };
        (window as unknown as RecorderWindow).recorder = recorder;
        const canvas = document.querySelector("canvas");
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) throw new Error("No canvas with a 2D context");
        const f = new Uint8ClampedArray(new Uint32Array([floor]).buffer);
        const frame = (): void => {
          if (!recorder.on) return;
          const d = ctx.getImageData(box.x, box.y, box.width, box.height).data;
          let weight = 0;
          let sx = 0;
          let sy = 0;
          for (let y = 0; y < box.height; y++) {
            for (let x = 0; x < box.width; x++) {
              const i = 4 * (y * box.width + x);
              const w =
                Math.abs(d[i] - f[0]) +
                Math.abs(d[i + 1] - f[1]) +
                Math.abs(d[i + 2] - f[2]);
              weight += w;
              sx += w * x;
              sy += w * y;
            }
          }
          recorder.frames.push({
            weight,
            x: weight > 0 ? box.x + sx / weight : 0,
            y: weight > 0 ? box.y + sy / weight : 0,
          });
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      },
      { box: sight.snipe, floor },
    );
    // The snipe appears on tick `sight.tick` and stays in the area for two seconds; it is
    // watched for one and a half.
    const appears = (1000 * sight.tick) / TICKS_PER_SECOND;
    await page.clock.runFor(appears + 1500);
    const frames = await stopRecording<SnipeFrame>(page);

    const most = Math.max(...frames.map((f) => f.weight));
    expect(most).toBeGreaterThan(0);
    // The frames that show the snipe: those after it appeared.
    const first = frames.findIndex((f) => f.weight >= most / 2);
    const shown = frames.slice(first).filter((f) => f.weight >= most / 2);
    expect(shown.length).toBeGreaterThan(20);
    const moves: number[] = [];
    for (let i = 1; i < shown.length; i++) {
      moves.push(
        Math.hypot(shown[i].x - shown[i - 1].x, shown[i].y - shown[i - 1].y),
      );
    }
    // It moved at least a cell while watched (2.4: a step every 10 or 13 ticks).
    const xs = shown.map((f) => f.x);
    const ys = shown.map((f) => f.y);
    const travel = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
    expect(
      travel,
      `moves ${moves.map((m) => m.toFixed(1)).join(",")}`,
    ).toBeGreaterThan(CELL_PX / 2);
    // Sliding, it moves a fraction of a cell from one frame to the next; drawn only on whole
    // cells, it would stay still or jump a whole cell (16 pixels) at once.
    const small = moves.filter((m) => m > 0.3 && m < CELL_PX / 2);
    expect(
      small.length,
      `moves ${moves.map((m) => m.toFixed(1)).join(",")}`,
    ).toBeGreaterThanOrEqual(5);
    expect(errors).toEqual([]);
  });
});
