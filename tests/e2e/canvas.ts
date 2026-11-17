import { expect, type Page } from "@playwright/test";
import type { Box } from "./game";

// Reads the game's canvas in the page through its 2D context. Pixels are compared as 32-bit
// numbers (the four bytes R, G, B, A of a pixel), the same in every helper here.

// Opens the page at `path` (such as "/?seed=7") and waits until it has drawn the maze across
// the canvas: at least half of its 4 x 4 equal blocks show more than one colour. Returns the
// errors the page reports, as they come.
export async function open(page: Page, path: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(path);
  await expect.poll(() => blocksWithDetail(page)).toBeGreaterThanOrEqual(8);
  return errors;
}

function blocksWithDetail(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return 0;
    const { width, height } = canvas;
    const pixels = new Uint32Array(
      ctx.getImageData(0, 0, width, height).data.buffer,
    );
    let detailed = 0;
    for (let by = 0; by < 4; by++) {
      for (let bx = 0; bx < 4; bx++) {
        const x0 = Math.floor((bx * width) / 4);
        const x1 = Math.floor(((bx + 1) * width) / 4);
        const y0 = Math.floor((by * height) / 4);
        const y1 = Math.floor(((by + 1) * height) / 4);
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
  });
}

// A hash of the whole canvas.
export function canvasHash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) throw new Error("No canvas with a 2D context");
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let h = 2166136261;
    for (const pixel of new Uint32Array(image.data.buffer)) {
      h = Math.imul(h ^ pixel, 16777619);
    }
    return h >>> 0;
  });
}

// Waits until two hashes of the canvas 150 ms apart are the same, and returns that hash.
export async function settle(page: Page): Promise<number> {
  let previous = await canvasHash(page);
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await canvasHash(page);
    if (next === previous) return next;
    previous = next;
  }
  throw new Error("The canvas kept changing with no key held");
}

// The pixels of the canvas inside `box` (in canvas pixels).
export function pixelsIn(page: Page, box: Box): Promise<number[]> {
  return page.evaluate((b) => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) throw new Error("No canvas with a 2D context");
    const image = ctx.getImageData(b.x, b.y, b.width, b.height);
    return [...new Uint32Array(image.data.buffer)];
  }, box);
}

// The pixel a CSS colour gives when filled into a canvas.
export function pixelOf(page: Page, colour: string): Promise<number> {
  return page.evaluate((css) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return new Uint32Array(ctx.getImageData(0, 0, 1, 1).data.buffer)[0];
  }, colour);
}

// The floor: the most common pixel of the view below the HUD row of `top` pixels. Corridors
// are 15 x 11 open cells (2.10), so most of the view is floor.
export function floorPixel(page: Page, top: number): Promise<number> {
  return page.evaluate((hud) => {
    const canvas = document.querySelector("canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) throw new Error("No canvas with a 2D context");
    const image = ctx.getImageData(0, hud, canvas.width, canvas.height - hud);
    const counts = new Map<number, number>();
    for (const pixel of new Uint32Array(image.data.buffer)) {
      counts.set(pixel, (counts.get(pixel) ?? 0) + 1);
    }
    let best = 0;
    let most = -1;
    for (const [pixel, count] of counts) {
      if (count > most) {
        most = count;
        best = pixel;
      }
    }
    return best;
  }, top);
}
