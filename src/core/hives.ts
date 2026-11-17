import { cellAt, wrap, type Grid, type Point } from "./grid";
import { nextFloat, type Rng } from "./rng";

// Spec 2.10: a hive covers HIVE_SIZE x HIVE_SIZE cells and a snipe SNIPE_W x SNIPE_H; the
// position of each is its top-left cell.
export const HIVE_SIZE = 4;
export const SNIPE_W = 4;
export const SNIPE_H = 2;

// Spec 2.3: the 20th hit destroys a hive.
const HIVE_HITS = 20;

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

export interface Snipe {
  readonly x: number;
  readonly y: number;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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

// Spec 2.3 and 2.10: every hive counts down to its next spawn. When it is due and there are
// fewer than `max` enemies on the map, a snipe appears at a random place touching the hive
// where its footprint covers no wall; with no such place, none appears.
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
        [f, rng] = nextFloat(rng);
        all = [...all, places[Math.floor(f * places.length)]];
      }
    }
    return { ...hive, wait: SPAWN_TICKS - 1 };
  });
  return { rng, hives: next, snipes: all };
}

// Spec 2.10: whether every cell of the box is open, with wrap-around.
function fits(maze: Grid, box: Box): boolean {
  for (let dy = 0; dy < box.height; dy++) {
    for (let dx = 0; dx < box.width; dx++) {
      if (cellAt(maze, { x: box.x + dx, y: box.y + dy }) === "wall") {
        return false;
      }
    }
  }
  return true;
}

// Whether two boxes share a cell, with wrap-around.
function overlaps(maze: Grid, a: Box, b: Box): boolean {
  return (
    spans(a.x, a.width, b.x, b.width, maze.width) &&
    spans(a.y, a.height, b.y, b.height, maze.height)
  );
}

// Whether [a, a + aLength) and [b, b + bLength) meet on an axis that wraps after `size`.
function spans(
  a: number,
  aLength: number,
  b: number,
  bLength: number,
  size: number,
): boolean {
  const offset = (((a - b) % size) + size) % size;
  return offset < bLength || offset > size - aLength;
}
