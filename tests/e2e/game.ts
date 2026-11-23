import { cellAt, type Grid, type Point } from "../../src/core/grid";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
} from "../../src/core/state";

// Spec 3, 4.3 and 9.1 WP 09: what the page shows for `?seed=N`, worked out in Node with the
// game's own core. With `?seed=N` the page plays `createGame(N, skill)` from the title screen
// (WP 13), at the skill level shown there, A1 in a new browser context, and steps it with the
// keys held, so a game in the core with no keys held shows what the page shows while no key is
// pressed.
// The view is 80 x 44 maze cells of 16 x 16 pixels below one HUD row, with the player's 4 x 4
// footprint in its middle (2.10, 3).

export const CELL_PX = 16;
export const VIEW_COLS = 80;
export const VIEW_ROWS = 44;
export const PLAYER = 4;
export const SHOT = 2;
export const HIVE = 4;
export const SNIPE_W = 4;
export const SNIPE_H = 2;
export const MAX_SEED = 2 ** 32 - 1;
export const TICKS_PER_SECOND = 60;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Where the player's footprint is drawn on the canvas: in the middle of the view, below the
// HUD row (3). The player's eyes blink now and then (3), so tests that compare whole pictures
// leave these pixels out.
export const PLAYER_ON_CANVAS: Box = {
  x: ((VIEW_COLS - PLAYER) / 2) * CELL_PX,
  y: ((VIEW_ROWS - PLAYER) / 2 + 1) * CELL_PX,
  width: PLAYER * CELL_PX,
  height: PLAYER * CELL_PX,
};

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// The maze cell drawn at the view's top-left: as many columns left of the player's footprint
// as right of it, and as many rows above as below (3).
export function viewOrigin(maze: Grid, player: Point): Point {
  return {
    x: mod(player.x - (VIEW_COLS - PLAYER) / 2, maze.width),
    y: mod(player.y - (VIEW_ROWS - PLAYER) / 2, maze.height),
  };
}

// Where a footprint is drawn on the canvas, in canvas pixels, if all of it is in the view.
export function onCanvas(maze: Grid, origin: Point, box: Box): Box | undefined {
  const col = mod(box.x - origin.x, maze.width);
  const row = mod(box.y - origin.y, maze.height);
  if (col + box.width > VIEW_COLS || row + box.height > VIEW_ROWS) {
    return undefined;
  }
  return {
    x: col * CELL_PX,
    y: (row + 1) * CELL_PX,
    width: box.width * CELL_PX,
    height: box.height * CELL_PX,
  };
}

// Whether any cell of a footprint is in the view or within `margin` cells of it.
export function nearView(
  maze: Grid,
  origin: Point,
  box: Box,
  margin: number,
): boolean {
  const col = mod(box.x - origin.x + margin, maze.width);
  const row = mod(box.y - origin.y + margin, maze.height);
  const across = col < VIEW_COLS + 2 * margin || col + box.width > maze.width;
  const down = row < VIEW_ROWS + 2 * margin || row + box.height > maze.height;
  return across && down;
}

export function hiveBox(p: Point): Box {
  return { x: p.x, y: p.y, width: HIVE, height: HIVE };
}

export function snipeBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SNIPE_W, height: SNIPE_H };
}

export function shotBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SHOT, height: SHOT };
}

export function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
}

function cells(box: Box): Point[] {
  const result: Point[] = [];
  for (let dy = 0; dy < box.height; dy++) {
    for (let dx = 0; dx < box.width; dx++) {
      result.push({ x: box.x + dx, y: box.y + dy });
    }
  }
  return result;
}

export function overlaps(maze: Grid, a: Box, b: Box): boolean {
  const keys = new Set(
    cells(a).map((c) => `${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
  return cells(b).some((c) =>
    keys.has(`${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
}

function clear(maze: Grid, box: Box): boolean {
  return cells(box).every((c) => cellAt(maze, c) === "open");
}

// --- Quiet seeds ---------------------------------------------------------------------------

// The tests that need a still view move the player a few cells at most, so a margin of a
// whole block (2.10) around the view is kept free.
const MARGIN = 16;
const QUIET_TICKS = 60 * TICKS_PER_SECOND;

// Whether, in the game of this seed with no key held, no hive, snipe or snipe's shot (2.4,
// WP 10) is in the start view or near it for a whole minute: the page then shows only the
// maze and the player.
export function isQuiet(seed: number): boolean {
  let state = createGame(seed);
  const { maze } = state;
  const origin = viewOrigin(maze, state.player);
  if (state.hives.some((h) => nearView(maze, origin, hiveBox(h), MARGIN))) {
    return false;
  }
  for (let tick = 0; tick <= QUIET_TICKS; tick++) {
    if (state.snipes.some((s) => nearView(maze, origin, snipeBox(s), MARGIN))) {
      return false;
    }
    if (
      state.snipeShots.some((s) => nearView(maze, origin, shotBox(s), MARGIN))
    ) {
      return false;
    }
    state = step(state, NO_INPUT);
  }
  return true;
}

const quiet = new Map<string, number[]>();

// The first `count` quiet seeds counting from `from` in steps of `by` (1 or -1).
export function quietSeeds(count: number, from = 1, by = 1): number[] {
  const memo = `${count},${from},${by}`;
  const known = quiet.get(memo);
  if (known !== undefined) return known;
  const seeds: number[] = [];
  for (
    let seed = from;
    seeds.length < count && seed >= 0 && seed <= MAX_SEED;
    seed += by
  ) {
    if (Math.abs(seed - from) > 2000) {
      throw new Error(`No ${count} quiet seeds near ${from}`);
    }
    if (isQuiet(seed)) seeds.push(seed);
  }
  quiet.set(memo, seeds);
  return seeds;
}

// Whether the walls drawn in the start view of two games differ.
export function differentViews(a: GameState, b: GameState): boolean {
  const oa = viewOrigin(a.maze, a.player);
  const ob = viewOrigin(b.maze, b.player);
  for (let row = 0; row < VIEW_ROWS; row++) {
    for (let col = 0; col < VIEW_COLS; col++) {
      const wa = cellAt(a.maze, { x: oa.x + col, y: oa.y + row });
      const wb = cellAt(b.maze, { x: ob.x + col, y: ob.y + row });
      if (wa !== wb) return true;
    }
  }
  return false;
}

// --- A hive in the view --------------------------------------------------------------------

export type Axis = -1 | 0 | 1;

export interface HiveSight {
  readonly seed: number;
  /** Where the hive is drawn on the canvas. */
  readonly hive: Box;
  /** The fire direction from the start whose shots hit that hive first. */
  readonly fireX: Axis;
  readonly fireY: Axis;
}

const STRAIGHT: [Axis, Axis][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// Spec 2.5 and 2.10, the test's own model of a straight shot fired from the player at
// `player`: it appears just outside the footprint and moves one cell at a time until its
// footprint would cover a wall. Returns the index of the first hive it enters, or -1.
function shotHits(
  maze: Grid,
  player: Point,
  dx: Axis,
  dy: Axis,
  hives: readonly Point[],
): number {
  let p = {
    x: dx < 0 ? player.x - SHOT : dx > 0 ? player.x + PLAYER : player.x + 1,
    y: dy < 0 ? player.y - SHOT : dy > 0 ? player.y + PLAYER : player.y + 1,
  };
  const shot = (q: Point): Box => ({
    x: q.x,
    y: q.y,
    width: SHOT,
    height: SHOT,
  });
  if (!clear(maze, shot(p))) return -1;
  if (hives.some((h) => overlaps(maze, shot(p), hiveBox(h)))) return -1;
  for (let n = 0; n < 1000; n++) {
    p = { x: p.x + dx, y: p.y + dy };
    if (!clear(maze, shot(p))) return -1;
    const hit = hives.findIndex((h) => overlaps(maze, shot(p), hiveBox(h)));
    if (hit >= 0) return hit;
  }
  return -1;
}

let sight: HiveSight | undefined;

// The first seed whose start view shows the whole of a hive, clear of the player, that the
// player can shoot from the start without moving.
export function hiveInSight(): HiveSight {
  if (sight !== undefined) return sight;
  for (let seed = 1; seed <= 20000; seed++) {
    const game = createGame(seed);
    const { maze, player, hives } = game;
    const origin = viewOrigin(maze, player);
    for (const [dx, dy] of STRAIGHT) {
      const hit = shotHits(maze, player, dx, dy, hives);
      if (hit < 0) continue;
      const box = hiveBox(hives[hit]);
      const drawn = onCanvas(maze, origin, box);
      if (drawn === undefined) continue;
      if (
        overlaps(maze, box, {
          ...playerBox(player),
          x: player.x - 1,
          y: player.y - 1,
          width: PLAYER + 2,
          height: PLAYER + 2,
        })
      ) {
        continue;
      }
      sight = { seed, hive: drawn, fireX: dx, fireY: dy };
      return sight;
    }
  }
  throw new Error("No seed with a hive in sight of the start");
}

export interface SnipeSight {
  readonly seed: number;
  /** Where on the canvas the snipe is drawn while it is in sight. */
  readonly snipe: Box;
  /** The tick it is spawned on, counted from the start of the game. */
  readonly tick: number;
}

// Spec 2.4 (WP 10): snipes move, one cell every 10 or 13 ticks, so the snipe is followed for
// SIGHT_TICKS after it appears. The area it covers in that time, at most SIGHT_CELLS on a side,
// must be open, in the view, and clear of the player, the hives, the other snipes and the
// snipes' shots all that time, so that only this snipe is drawn there.
const SIGHT_TICKS = 2 * TICKS_PER_SECOND;
const SIGHT_CELLS = 12;

// The smallest box, not wrapped, that holds both boxes, measured the short way round.
function union(maze: Grid, a: Box, b: Box): Box {
  const dx = mod(b.x - a.x + maze.width / 2, maze.width) - maze.width / 2;
  const dy = mod(b.y - a.y + maze.height / 2, maze.height) - maze.height / 2;
  const x = Math.min(a.x, a.x + dx);
  const y = Math.min(a.y, a.y + dy);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, a.x + dx + b.width) - x,
    height: Math.max(a.y + a.height, a.y + dy + b.height) - y,
  };
}

let snipeSight: SnipeSight | undefined;

// The first seed in which, with no key held, a snipe is spawned within the first 20 seconds
// and stays in sight in the start view for SIGHT_TICKS, alone in the area it covers.
export function snipeInSight(): SnipeSight {
  if (snipeSight !== undefined) return snipeSight;
  for (let seed = 1; seed <= 20000; seed++) {
    let state = createGame(seed);
    const { maze, player } = state;
    const origin = viewOrigin(maze, player);
    if (!state.hives.some((h) => nearView(maze, origin, hiveBox(h), 4))) {
      continue;
    }
    for (let tick = 1; tick <= 20 * TICKS_PER_SECOND; tick++) {
      const before = state.snipes.length;
      state = step(state, NO_INPUT);
      if (state.snipes.length <= before) continue;
      // The new snipe is the last to appear (2.4: the snipes are in the order they appeared).
      const index = state.snipes.length - 1;
      const states = [state];
      let later = state;
      for (let t = 0; t < SIGHT_TICKS; t++) {
        later = step(later, NO_INPUT);
        states.push(later);
      }
      let area = snipeBox(state.snipes[index]);
      for (const s of states) {
        if (s.snipes.length <= index) break;
        area = union(maze, area, snipeBox(s.snipes[index]));
      }
      const drawn = onCanvas(maze, origin, area);
      const alone = states.every(
        (s) =>
          s.snipes.length > index &&
          s.snipes.every(
            (o, i) => i === index || !overlaps(maze, area, snipeBox(o)),
          ) &&
          !s.snipeShots.some((o) => overlaps(maze, area, shotBox(o))) &&
          !s.hives.some((h) => overlaps(maze, area, hiveBox(h))) &&
          !overlaps(maze, area, playerBox(s.player)),
      );
      if (
        drawn !== undefined &&
        area.width <= SIGHT_CELLS &&
        area.height <= SIGHT_CELLS &&
        clear(maze, area) &&
        alone
      ) {
        snipeSight = { seed, snipe: drawn, tick };
        return snipeSight;
      }
    }
  }
  throw new Error("No seed with a snipe that stays in sight in the start view");
}

// --- The player out of play ----------------------------------------------------------------

export interface DeathSight {
  readonly seed: number;
  /** Where the player's footprint is drawn on the canvas, in the middle of the view. */
  readonly player: Box;
  /** The tick it dies on and the tick it comes back on, counted from the start of the game. */
  readonly died: number;
  readonly back: number;
}

// Spec 2.2 and 9.1 WP 11: the player, out of play, stays where it died, so the view does not
// move. The out-of-play time must be long enough to see, at least half a second.
const DEATH_TICKS = 30 * TICKS_PER_SECOND;
const MIN_OUT = TICKS_PER_SECOND / 2;

let deathSight: DeathSight | undefined;

// The first seed in which, with no key held, the player dies after 5 and within 30 seconds
// and, until it comes back, nothing is drawn on its footprint or next to it: no hive, snipe
// or snipe's shot.
export function deathInSight(): DeathSight {
  if (deathSight !== undefined) return deathSight;
  for (let seed = 1; seed <= 20000; seed++) {
    let state = createGame(seed);
    const lives = state.lives;
    let died = -1;
    for (let tick = 1; tick <= DEATH_TICKS && died < 0; tick++) {
      state = step(state, NO_INPUT);
      if (state.lives !== lives) died = tick;
    }
    // Not too early, so that the page is surely showing the game before it.
    if (died < 5 * TICKS_PER_SECOND) continue;
    const { maze, player } = state;
    const near: Box = {
      x: player.x - 1,
      y: player.y - 1,
      width: PLAYER + 2,
      height: PLAYER + 2,
    };
    let clearAll = true;
    let back = died;
    while (
      state.respawn > 0 &&
      clearAll &&
      back - died <= 60 * TICKS_PER_SECOND
    ) {
      clearAll =
        !state.hives.some((h) => overlaps(maze, near, hiveBox(h))) &&
        !state.snipes.some((s) => overlaps(maze, near, snipeBox(s))) &&
        !state.snipeShots.some((s) => overlaps(maze, near, shotBox(s)));
      state = step(state, NO_INPUT);
      back++;
    }
    if (!clearAll || state.respawn > 0 || back - died < MIN_OUT) continue;
    const drawn = onCanvas(maze, viewOrigin(maze, player), playerBox(player));
    if (drawn === undefined) continue;
    deathSight = { seed, player: drawn, died, back };
    return deathSight;
  }
  throw new Error(
    "No seed in which the player dies early with nothing near it",
  );
}
