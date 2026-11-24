import { expect, test, type Page } from "@playwright/test";
import {
  floorPixel,
  OPEN_MS,
  openTitleWithClock,
  openWithClock,
  pixelsIn,
} from "./canvas";
import { CELL_PX, TICKS_PER_SECOND, type Box } from "./game";
import {
  GHOST,
  ghostInSight,
  ghostsOnHud,
  snipeFacing,
  type InSight,
} from "./ghosts";
import { shown, type Screen } from "./screens";

// Spec 2.4, 2.6, 3 and 9.1 WP 15: ghosts on the page. The games are worked out in Node with
// the game's own core (ghosts.ts) and played on the page from `?seed=N` at the skill level
// typed on the title screen, on Playwright's fake clock (canvas.ts), with a fire key held from
// the game's first tick where the game needs one.
//
// - The HUD's enemies left (3) count the snipes and the ghosts on the map.
// - A ghost is drawn over its 2 x 2 cells (3).
// - A snipe is drawn with its face on its face half (2.4, 3): the right half when it goes
//   down-left, left or up-left, else the left half. The face is a round face and the other
//   half holds a thin spear, so of the snipe's drawn pixels more are on its face side.

// Page time, in ms, for `ticks` ticks of the game.
function ms(ticks: number): number {
  return (1000 * ticks) / TICKS_PER_SECOND;
}

// Opens the page at `seed` on the fake clock, types the skill level on the title screen,
// starts the game and holds `key` from its first tick. Returns the errors the page reports.
async function start(
  page: Page,
  seed: number,
  skill: string,
  key: string | undefined,
): Promise<string[]> {
  const errors = await openTitleWithClock(page, `/?seed=${seed}`);
  for (const c of skill) await page.keyboard.press(c.toLowerCase());
  await page.keyboard.press("Enter");
  if (key !== undefined) await page.keyboard.down(key);
  return errors;
}

// The pixels of `area` that are not floor, as columns counted from the area's left edge.
async function drawnColumns(page: Page, area: Box): Promise<number[]> {
  const floor = await floorPixel(page, CELL_PX);
  const pixels = await pixelsIn(page, area);
  const columns: number[] = [];
  pixels.forEach((p, i) => {
    if (p !== floor) columns.push(i % area.width);
  });
  return columns;
}

// Of the pixels drawn in `area`, how many are left and right of the middle of the columns
// they span.
async function sides(
  page: Page,
  area: Box,
): Promise<{ left: number; right: number; all: number }> {
  const columns = await drawnColumns(page, area);
  const middle = (Math.min(...columns) + Math.max(...columns)) / 2;
  return {
    left: columns.filter((c) => c < middle).length,
    right: columns.filter((c) => c > middle).length,
    all: columns.length,
  };
}

test.describe("3 Presentation: the HUD counts ghosts among the enemies left", () => {
  test("enemies left is the snipes and the ghosts on the map", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const sight = ghostsOnHud();
    const errors = await start(page, sight.seed, sight.skill, sight.key);
    await page.clock.runFor(ms(sight.tick));
    const hud = await shown(page);
    await page.keyboard.up(sight.key);
    expect(sight.state.ghosts.length).toBeGreaterThan(0);
    expect(hud).toMatchObject({
      screen: "playing" satisfies Screen,
      skill: sight.skill,
      score: sight.state.score,
      lives: sight.state.lives,
      hives: sight.state.hives.length,
      enemies: sight.state.snipes.length + sight.state.ghosts.length,
    });
    expect(errors).toEqual([]);
  });
});

test.describe("3 Presentation: ghosts are drawn", () => {
  test("a ghost alone in the view is drawn over its cells", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const sight = ghostInSight();
    const errors = await start(page, sight.seed, sight.skill, sight.key);
    await page.clock.runFor(ms(sight.tick));
    const columns = await drawnColumns(page, sight.area);
    if (sight.key !== undefined) await page.keyboard.up(sight.key);
    // The area holds only the ghost (and floor) around this tick: a good part of a ghost's
    // own cells is drawn.
    expect(columns.length).toBeGreaterThan(
      (GHOST * GHOST * CELL_PX * CELL_PX) / 8,
    );
    expect(errors).toEqual([]);
  });
});

test.describe("2.4 Snipes and ghosts / 3 Presentation: a snipe's face is drawn on its face half", () => {
  async function look(page: Page, sight: InSight) {
    const errors = await openWithClock(page, `/?seed=${sight.seed}`);
    await page.clock.runFor(ms(sight.tick) - OPEN_MS);
    const drawn = await sides(page, sight.area);
    // Guard: the snipe is drawn in the area.
    expect(drawn.all).toBeGreaterThan((4 * 2 * CELL_PX * CELL_PX) / 16);
    expect(errors).toEqual([]);
    return drawn;
  }

  test("on its right half going down-left, left or up-left; on its left half going any other way", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const right = await look(page, snipeFacing(true));
    expect(
      right.right,
      `drawn pixels left ${right.left}, right ${right.right}`,
    ).toBeGreaterThan(right.left);
    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      const left = await look(other, snipeFacing(false));
      expect(
        left.left,
        `drawn pixels left ${left.left}, right ${left.right}`,
      ).toBeGreaterThan(left.right);
    } finally {
      await context.close();
    }
  });
});
