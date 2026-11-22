import { fits, overlaps, wrap, type Box, type Grid, type Point } from "./grid";
import { nextFloat, type Rng } from "./rng";
import { createSnipe, SNIPE_H, SNIPE_W, type Snipe } from "./snipes";

// Spec 2.10: a hive covers HIVE_SIZE x HIVE_SIZE cells; its position is its top-left cell.
export const HIVE_SIZE = 4;

// Spec 2.3: the 20th hit destroys a hive.
export const HIVE_HITS = 20;

// Spec 2.3: ticks from one snipe a hive spawns to the next (a tunable constant).
const SPAWN_TICKS = 120;

// Spec 2.10: where a new snipe may appear, relative to its hive: touching one of its sides.
const SPAWN_OFFSETS: readonly Point[] = [
  { x: 0, y: -SNIPE_H },
  { x: 0, y: HIVE_SIZE },
  { x: -SNIPE_W, y: 0 },
  { x: -SNIPE_W, y: SNIPE_H },
  { x: HIVE_SIZE, y: 0 },
  { x: HIVE_SIZE, y: SNIPE_H },
];

export interface Hive {
  readonly x: number;
  readonly y: number;
  /** The hits taken so far. */
  readonly hits: number;
  /** Ticks left before the hive spawns its next snipe. */
  readonly wait: number;
}

export function hiveBox(hive: Point): Box {
  return { x: hive.x, y: hive.y, width: HIVE_SIZE, height: HIVE_SIZE };
}

// Spec 2.3 and 2.10: `count` hives at random open spots, none sharing a cell with another
// hive or with `keepClear` (the player).
export function placeHives(
  maze: Grid,
  start: Rng,
  count: number,
  keepClear: Box,
): [hives: Hive[], next: Rng] {
  const hives: Hive[] = [];
  let rng = start;
  while (hives.length < count) {
    let fx: number;
    let fy: number;
    [fx, rng] = nextFloat(rng);
    [fy, rng] = nextFloat(rng);
    const at = hiveBox({
      x: Math.floor(fx * maze.width),
      y: Math.floor(fy * maze.height),
    });
    if (
      fits(maze, at) &&
      !overlaps(maze, at, keepClear) &&
      hives.every((h) => !overlaps(maze, at, hiveBox(h)))
    ) {
      hives.push({ x: at.x, y: at.y, hits: 0, wait: SPAWN_TICKS - 1 });
    }
  }
  return [hives, rng];
}

// Spec 2.3: each hit adds one to the hive's hits; the 20th destroys it. `hits` holds the index
// of the hive each hit landed on.
export function hitHives(
  hives: readonly Hive[],
  hits: readonly number[],
): readonly Hive[] {
  if (hits.length === 0) return hives;
  return hives
    .map((h, i) => ({
      ...h,
      hits: h.hits + hits.filter((j) => j === i).length,
    }))
    .filter((h) => h.hits < HIVE_HITS);
}

// Spec 2.3, 2.4 and 2.10: every hive counts down to its next spawn. When it is due and there
// are fewer than `max` enemies on the map, a snipe appears at a random place touching the
// hive where its footprint covers no wall, and draws its direction and turning sense; with no
// such place, none appears.
export function spawnSnipes(
  maze: Grid,
  start: Rng,
  hives: readonly Hive[],
  snipes: readonly Snipe[],
  max: number,
): { rng: Rng; hives: Hive[]; snipes: readonly Snipe[] } {
  let rng = start;
  let all = snipes;
  const next = hives.map((hive) => {
    if (hive.wait > 0) return { ...hive, wait: hive.wait - 1 };
    if (all.length < max) {
      const places = SPAWN_OFFSETS.map((o) =>
        wrap(maze, { x: hive.x + o.x, y: hive.y + o.y }),
      ).filter((p) => fits(maze, { ...p, width: SNIPE_W, height: SNIPE_H }));
      if (places.length > 0) {
        let f: number;
        let snipe: Snipe;
        [f, rng] = nextFloat(rng);
        [snipe, rng] = createSnipe(rng, places[Math.floor(f * places.length)]);
        all = [...all, snipe];
      }
    }
    return { ...hive, wait: SPAWN_TICKS - 1 };
  });
  return { rng, hives: next, snipes: all };
}
