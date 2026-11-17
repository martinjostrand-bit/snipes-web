import { expect, test, type Page } from "@playwright/test";
import { createGame } from "../../src/core/state";
import { canvasHash, open, settle } from "./canvas";
import { differentViews, MAX_SEED, quietSeeds } from "./game";

// Spec 4.3 and 9.1 WP 09: the page accepts an optional `?seed=N` in its URL, a whole number
// from 0 to 2^32 - 1; without it, or with any other value, each game gets a random seed.
// The tests use seeds in which no hive or snipe comes near the start view (see game.ts), so
// the canvas settles: the same seed then always gives the same picture, and a picture that
// differs from it comes from another seed.

// The settled picture of the page at `path`, with the errors the page reported.
async function picture(
  page: Page,
  path: string,
): Promise<{ hash: number; errors: string[] }> {
  const errors = await open(page, path);
  return { hash: await settle(page), errors };
}

// A picture of the page at `path` half a second after it has drawn the maze, settled or not.
async function glance(page: Page, path: string): Promise<number> {
  const errors = await open(page, path);
  await page.waitForTimeout(500);
  expect(errors, path).toEqual([]);
  return canvasHash(page);
}

test.describe("4.3 Game loop and determinism: ?seed=N starts a known game", () => {
  test("the same seed shows the same maze every time", async ({ page }) => {
    const [seed] = quietSeeds(1);
    const first = await picture(page, `/?seed=${seed}`);
    const again = await picture(page, `/?seed=${seed}`);
    expect(again.hash).toBe(first.hash);
    expect([...first.errors, ...again.errors]).toEqual([]);
  });

  test("different seeds show different mazes", async ({ page }) => {
    const [a, b] = quietSeeds(2);
    // The test's own check: the two mazes differ in the start view.
    expect(differentViews(createGame(a), createGame(b))).toBe(true);
    const first = await picture(page, `/?seed=${a}`);
    const second = await picture(page, `/?seed=${b}`);
    expect(second.hash).not.toBe(first.hash);
    expect([...first.errors, ...second.errors]).toEqual([]);
  });

  test("accepts the smallest and the largest seeds", async ({ page }) => {
    // The quiet seeds nearest 0 and nearest 2^32 - 1.
    const [low] = quietSeeds(1, 0, 1);
    const [high] = quietSeeds(1, MAX_SEED, -1);
    expect(low).toBeLessThan(2000);
    expect(high).toBeGreaterThan(MAX_SEED - 2000);
    for (const seed of [low, high]) {
      const first = await picture(page, `/?seed=${seed}`);
      const again = await picture(page, `/?seed=${seed}`);
      expect(again.hash, `seed ${seed}`).toBe(first.hash);
      expect([...first.errors, ...again.errors], `seed ${seed}`).toEqual([]);
    }
  });
});

test.describe("4.3 Game loop and determinism: without a valid ?seed, each game gets a random seed", () => {
  test("a value that is not a whole number from 0 to 2^32 - 1 does not choose the game", async ({
    page,
  }) => {
    const [seed] = quietSeeds(1);
    const known = await picture(page, `/?seed=${seed}`);
    expect(known.errors).toEqual([]);
    // Values that careless parsing would turn into `seed`: a fraction, trailing letters, and
    // numbers just outside the range that wrap round to it.
    for (const value of [
      `${seed}.5`,
      `${seed}abc`,
      `${seed + 2 ** 32}`,
      `-${2 ** 32 - seed}`,
    ]) {
      const hash = await glance(page, `/?seed=${value}`);
      expect(hash, `?seed=${value}`).not.toBe(known.hash);
    }
  });

  test("without ?seed, or with an empty or non-numeric one, two games differ", async ({
    page,
  }) => {
    for (const path of ["/", "/?seed=", "/?seed=abc", "/?seed=-"]) {
      const first = await glance(page, path);
      const second = await glance(page, path);
      expect(second, path).not.toBe(first);
    }
  });
});
