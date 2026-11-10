import { expect, test, type Page } from "@playwright/test";

// Spec 2.1, 2.2, 2.8, 3, 4.1 and 9.1 WP 07: the game is drawn on one canvas with the Canvas 2D
// API. The canvas has a fixed size in pixels (`canvas.width` x `canvas.height`) and is shown
// scaled by the largest whole number that fits the window (in CSS pixels), so pixels stay
// sharp. The view scrolls to keep the player centred, and an arrow key moves the player.
// The tests read the canvas pixels in the page through its 2D context; the image only changes
// when the game does, so a still game gives the same pixels frame after frame.

interface Shot {
  readonly width: number;
  readonly height: number;
  readonly hash: number;
}

interface Shift {
  /** Pixels the drawing moved, in the direction the player moved; 0 if it did not scroll. */
  readonly shift: number;
  /** Share of pixels that match with that shift. */
  readonly match: number;
  /** Share of pixels that match without any shift. */
  readonly matchAtZero: number;
}

// Helpers that run inside the page, installed by installProbe().
interface Probe {
  /** Reads the canvas, keeps the pixels under `name` and returns their hash. */
  snap(name: string): Shot;
  hashNow(): number;
  /** How many of the n x n equal blocks of the canvas hold more than one colour. */
  blocksWithDetail(n: number): number;
  /** Finds the shift along `axis` that best maps the shot `before` onto the shot `after`. */
  bestShift(before: string, after: string, axis: "x" | "y"): Shift;
}

interface ProbeWindow {
  probe: Probe;
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const shots = new Map<string, ImageData>();
    const read = (): ImageData => {
      const canvas = document.querySelector("canvas");
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("No canvas with a 2D context");
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    };
    const hash = (image: ImageData): number => {
      let h = 2166136261;
      for (const pixel of new Uint32Array(image.data.buffer)) {
        h = Math.imul(h ^ pixel, 16777619);
      }
      return h >>> 0;
    };
    const probe: Probe = {
      snap(name) {
        const image = read();
        shots.set(name, image);
        return { width: image.width, height: image.height, hash: hash(image) };
      },
      hashNow() {
        return hash(read());
      },
      blocksWithDetail(n) {
        const image = read();
        const pixels = new Uint32Array(image.data.buffer);
        const { width, height } = image;
        let detailed = 0;
        for (let by = 0; by < n; by++) {
          for (let bx = 0; bx < n; bx++) {
            const x0 = Math.floor((bx * width) / n);
            const x1 = Math.floor(((bx + 1) * width) / n);
            const y0 = Math.floor((by * height) / n);
            const y1 = Math.floor(((by + 1) * height) / n);
            const first = pixels[y0 * width + x0];
            let differs = false;
            for (let y = y0; y < y1 && !differs; y++) {
              for (let x = x0; x < x1; x++) {
                if (pixels[y * width + x] !== first) {
                  differs = true;
                  break;
                }
              }
            }
            if (differs) detailed++;
          }
        }
        return detailed;
      },
      bestShift(beforeName, afterName, axis) {
        const before = shots.get(beforeName);
        const after = shots.get(afterName);
        if (!before || !after) throw new Error("Missing shot");
        const { width, height } = before;
        const a = new Uint32Array(before.data.buffer);
        const b = new Uint32Array(after.data.buffer);
        // The pixel at p after the move is the pixel at p + shift before it.
        const matchFor = (shift: number): number => {
          let same = 0;
          let total = 0;
          for (let y = 0; y < height; y += 2) {
            const ya = axis === "y" ? y + shift : y;
            if (ya < 0 || ya >= height) continue;
            for (let x = 0; x < width; x += 2) {
              const xa = axis === "x" ? x + shift : x;
              if (xa < 0 || xa >= width) continue;
              total++;
              if (b[y * width + x] === a[ya * width + xa]) same++;
            }
          }
          return total === 0 ? 0 : same / total;
        };
        const limit = Math.floor((axis === "x" ? width : height) / 4);
        const matchAtZero = matchFor(0);
        let best = { shift: 0, match: matchAtZero };
        for (let shift = -limit; shift <= limit; shift++) {
          if (shift === 0) continue;
          const match = matchFor(shift);
          if (match > best.match) best = { shift, match };
        }
        return { ...best, matchAtZero };
      },
    };
    (window as unknown as ProbeWindow).probe = probe;
  });
}

function snap(page: Page, name: string): Promise<Shot> {
  return page.evaluate(
    (name) => (window as unknown as ProbeWindow).probe.snap(name),
    name,
  );
}

// Waits until two shots 150 ms apart are the same, and keeps the last one under `name`.
async function settle(page: Page, name: string): Promise<Shot> {
  let previous = await snap(page, name);
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await snap(page, name);
    if (next.hash === previous.hash) return next;
    previous = next;
  }
  throw new Error("The canvas kept changing with no key held");
}

// Opens the game and waits until it has drawn the maze across the whole canvas.
async function openGame(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await installProbe(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as ProbeWindow).probe.blocksWithDetail(4),
      ),
    )
    .toBe(16);
  return errors;
}

interface Layout {
  /** The canvas size in its own pixels. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Where the canvas is shown, in CSS pixels. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly rendering: string;
}

function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("No canvas");
    const box = canvas.getBoundingClientRect();
    return {
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      rendering: getComputedStyle(canvas).imageRendering,
    };
  });
}

// The largest whole-number scale at which the canvas fits the window.
function fittingScale(l: Layout): number {
  return Math.floor(
    Math.min(l.windowWidth / l.pixelWidth, l.windowHeight / l.pixelHeight),
  );
}

// Describes what is wrong with the canvas's scale and position, or null if nothing is.
function scaleProblem(l: Layout): string | null {
  const at = `canvas ${l.pixelWidth}x${l.pixelHeight} shown at ${l.width}x${l.height}+${l.left}+${l.top} in a ${l.windowWidth}x${l.windowHeight} window`;
  if (l.pixelWidth <= 0 || l.pixelHeight <= 0) return `empty ${at}`;
  const scale = fittingScale(l);
  if (scale < 1) return `does not fit at scale 1: ${at}`;
  const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
  if (
    !close(l.width, scale * l.pixelWidth) ||
    !close(l.height, scale * l.pixelHeight)
  ) {
    return `not at the largest whole-number scale ${scale}: ${at}`;
  }
  if (
    l.left < -0.01 ||
    l.top < -0.01 ||
    l.left + l.width > l.windowWidth + 0.01 ||
    l.top + l.height > l.windowHeight + 0.01
  ) {
    return `cut off: ${at}`;
  }
  return null;
}

test.describe("3 Presentation: the canvas", () => {
  test("draws the maze across the whole canvas without errors", async ({
    page,
  }) => {
    const errors = await openGame(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("keeps sharp pixels when scaled", async ({ page }) => {
    await openGame(page);
    expect(["pixelated", "crisp-edges"]).toContain(
      (await layout(page)).rendering,
    );
  });
});

test.describe("3 Presentation: scaling in whole-number steps", () => {
  test("shows the canvas at the largest whole-number scale that fits, from the minimum window 1280x720 up", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openGame(page);
    const start = await layout(page);

    for (const size of [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 1600, height: 1200 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () => scaleProblem(await layout(page)), {
          message: `window ${size.width}x${size.height}`,
        })
        .toBeNull();
      const now = await layout(page);
      // The canvas scales; it does not change its own size.
      expect([now.pixelWidth, now.pixelHeight]).toEqual([
        start.pixelWidth,
        start.pixelHeight,
      ]);
    }
  });

  test("steps up exactly when the window reaches the next whole multiple", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openGame(page);
    const { pixelWidth: w, pixelHeight: h } = await layout(page);
    // A scale above 1 whose window, and the windows one pixel smaller, are all supported.
    const scale = Math.max(Math.ceil(1280 / w), Math.ceil(720 / h), 1) + 1;

    for (const [size, expected] of [
      [{ width: scale * w, height: scale * h }, scale],
      [{ width: scale * w - 1, height: scale * h }, scale - 1],
      [{ width: scale * w, height: scale * h - 1 }, scale - 1],
      [{ width: scale * w + 1, height: scale * h + 1 }, scale],
    ] as const) {
      await page.setViewportSize(size);
      await expect
        .poll(
          async () => {
            const l = await layout(page);
            return [l.width / w, l.height / h, scaleProblem(l)];
          },
          { message: `window ${size.width}x${size.height}` },
        )
        .toEqual([expected, expected, null]);
    }
  });
});

const MOVES = [
  ["ArrowRight", "x", 1],
  ["ArrowDown", "y", 1],
  ["ArrowLeft", "x", -1],
  ["ArrowUp", "y", -1],
] as const;

test.describe("2.1 Maze and 2.8 Controls: an arrow key moves the player", () => {
  test("the view stays still while no key is held", async ({ page }) => {
    await openGame(page);
    const first = await settle(page, "first");
    await page.waitForTimeout(500);
    expect((await snap(page, "later")).hash).toBe(first.hash);
  });

  // The player starts in an open cell of a connected maze, so at least one of the four
  // straight directions is open. A key into a wall changes nothing, so each is tried in turn.
  test("an arrow key moves the player, the view scrolls with it, and releasing the key stops it", async ({
    page,
  }) => {
    const errors = await openGame(page);
    const blocked: string[] = [];

    for (const [key, axis, sign] of MOVES) {
      const before = await settle(page, "before");
      await page.keyboard.down(key);
      const changed = await page
        .waitForFunction(
          (hash) => (window as unknown as ProbeWindow).probe.hashNow() !== hash,
          before.hash,
          { polling: "raf", timeout: 1500 },
        )
        .then(
          () => true,
          () => false,
        );
      await page.keyboard.up(key);
      if (!changed) {
        blocked.push(key);
        continue;
      }

      // Releasing the key stops the player, so the view settles again.
      await settle(page, "after");
      const shift = await page.evaluate(
        (axis) =>
          (window as unknown as ProbeWindow).probe.bestShift(
            "before",
            "after",
            axis,
          ),
        axis,
      );
      // The maze moved across the screen the way the player went, while the player stayed in
      // the middle: the new picture is the old one shifted, not the old one with a moved player.
      expect(shift.shift, `${key}: ${JSON.stringify(shift)}`).not.toBe(0);
      expect(Math.sign(shift.shift), `${key}: ${JSON.stringify(shift)}`).toBe(
        sign,
      );
      expect(shift.match).toBeGreaterThan(shift.matchAtZero);
      expect(errors).toEqual([]);
      return;
    }
    throw new Error(`No arrow key moved the player: ${blocked.join(", ")}`);
  });
});
