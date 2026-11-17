import { describe, expect, it } from "vitest";
import { cellAt, wrap, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.3, 2.5, 2.6, 2.10, 4.3, 6.2 and 9.1 WP 09: whole games with hives, run headless from
// a seed, a skill level and scripted input. `createGame(seed, skill)` starts a game at a skill
// level such as "A1"; `state.hives` are the live hives (4 x 4 footprints with `hits`, the hits
// taken) and `state.snipes` the snipes on the map (4 x 2 footprints). Every tick:
//
// - no cell covered by a hive or a snipe is a wall (2.10, 6.2);
// - the number of enemies is at most the digit's maximum (2.6, 6.2);
// - hives never move or appear, their hits only grow, one per shot that hits, and a hive
//   disappears only on its 20th hit (2.3, 6.2);
// - each live hive spawns at most one snipe a tick, and a destroyed hive spawns no more.
//
// Ghosts come with WP 15, so the games here use letters without ghosts (A to C).

type Axis = InputState["moveX"];
type Hive = GameState["hives"][number];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4;
const SHOT = 2;
const HIVE = 4;
const SNIPE_W = 4;
const SNIPE_H = 2;
const HITS = 20;
const FIRE_TICKS = 13;
const MINUTE = 60 * 60; // ticks in a minute at 60 ticks/s (4.3)
const PATIENCE = 10 * MINUTE; // the longest the tests wait for spawning to fill the map
const HIVES = [3, 3, 4, 4, 5, 5, 6, 8, 10]; // 2.6, digits 1 to 9
const MAX_ENEMIES = [10, 20, 30, 40, 60, 80, 100, 120, 150]; // 2.6, digits 1 to 9
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const AXES: Axis[] = [-1, 0, 1];
const STRAIGHT: [Axis, Axis][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
const SLOW = 120_000;

// Draws whole numbers in [0, n) from the seeded PRNG, so a script is the same on every run.
function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
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

function clear(maze: Grid, box: Box): boolean {
  return cells(box).every((c) => cellAt(maze, c) === "open");
}

function overlaps(maze: Grid, a: Box, b: Box): boolean {
  const keys = new Set(
    cells(a).map((c) => `${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
  return cells(b).some((c) =>
    keys.has(`${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
}

function inside(maze: Grid, { x, y }: Point): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < maze.width &&
    y >= 0 &&
    y < maze.height
  );
}

function box(p: Point, width: number, height: number): Box {
  return { x: p.x, y: p.y, width, height };
}

function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function key(p: Point): string {
  return `${p.x},${p.y}`;
}

function digitOf(skill: string): number {
  return Number(skill[1]);
}

function input(
  moveX: Axis,
  moveY: Axis,
  fireX: Axis,
  fireY: Axis,
  fast = false,
): InputState {
  return { ...NO_INPUT, moveX, moveY, fireX, fireY, fast };
}

// A fixed input log: random movement, Space and fire keys every 5 to 40 ticks.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  while (log.length < ticks) {
    const keys = input(
      AXES[draw(3)],
      AXES[draw(3)],
      AXES[draw(3)],
      AXES[draw(3)],
      draw(4) === 0,
    );
    for (let i = 5 + draw(36); i > 0 && log.length < ticks; i--) {
      log.push(keys);
    }
  }
  return log;
}

interface Watch {
  readonly problems: string[];
  /** Checks one tick, from `before` to `after`. */
  readonly tick: (before: GameState, after: GameState, tick: number) => void;
}

// Checks every tick against the invariants above, in a game in `maze` whose digit allows at
// most `max` enemies. Each snipe is checked against the walls once per place it stands on.
function watch(maze: Grid, max: number): Watch {
  const problems: string[] = [];
  const seen = new Set<string>();
  const tick = (before: GameState, after: GameState, n: number): void => {
    const report = (what: string): void => {
      if (problems.length < 20) problems.push(`tick ${n}: ${what}`);
    };

    if (after.snipes.length > max) {
      report(`${after.snipes.length} enemies, more than ${max}`);
    }
    for (const s of after.snipes) {
      const k = key(s);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!inside(maze, s)) report(`snipe outside at ${k}`);
      else if (!clear(maze, box(s, SNIPE_W, SNIPE_H))) {
        report(`snipe on a wall at ${k}`);
      }
    }

    const was = new Map(before.hives.map((h) => [key(h), h]));
    let hitsTaken = 0;
    for (const h of after.hives) {
      const k = key(h);
      const old = was.get(k);
      if (!inside(maze, h)) report(`hive outside at ${k}`);
      else if (!clear(maze, box(h, HIVE, HIVE))) {
        report(`hive on a wall at ${k}`);
      }
      if (!Number.isInteger(h.hits) || h.hits < 0 || h.hits >= HITS) {
        report(`a live hive at ${k} with ${h.hits} hits`);
      }
      if (old === undefined) {
        report(`a hive appeared at ${k}`);
        continue;
      }
      if (h.hits < old.hits) report(`hive at ${k} lost hits`);
      hitsTaken += Math.max(0, h.hits - old.hits);
      was.delete(k);
    }
    // The hives left in `was` were destroyed this tick, each by its 20th hit; every hit is a
    // shot that was in flight, so a hive is never destroyed early.
    for (const old of was.values()) hitsTaken += HITS - old.hits;
    if (hitsTaken > before.shots.length) {
      report(
        `${hitsTaken} hits needed (${was.size} hives destroyed) from ${before.shots.length} shots in flight`,
      );
    }
    // Each live hive spawns at most one snipe a tick; with no hive, none appears.
    const added = after.snipes.length - before.snipes.length;
    if (added > before.hives.length) {
      report(`${added} snipes spawned by ${before.hives.length} hives`);
    }
  };
  return { problems, tick };
}

// --- A player that hunts the hives down ----------------------------------------------------

// Whether the player's footprint fits at each position, row-major.
function playerFits(maze: Grid): Uint8Array {
  const fits = new Uint8Array(maze.width * maze.height);
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      fits[y * maze.width + x] = clear(maze, box({ x, y }, PLAYER, PLAYER))
        ? 1
        : 0;
    }
  }
  return fits;
}

// The positions where the player fits and touches no hive.
function walkable(maze: Grid, fits: Uint8Array, hives: readonly Hive[]) {
  const ok = Uint8Array.from(fits);
  for (const h of hives) {
    for (let dy = -PLAYER + 1; dy < HIVE; dy++) {
      for (let dx = -PLAYER + 1; dx < HIVE; dx++) {
        const p = wrap(maze, { x: h.x + dx, y: h.y + dy });
        ok[p.y * maze.width + p.x] = 0;
      }
    }
  }
  return ok;
}

// Distances by straight steps from `from` over walkable positions; -1 where unreachable.
function distances(maze: Grid, ok: Uint8Array, from: Point): Int32Array {
  const dist = new Int32Array(maze.width * maze.height).fill(-1);
  const start = from.y * maze.width + from.x;
  if (ok[start] === 0) return dist;
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % maze.width;
    const y = Math.floor(i / maze.width);
    for (const [dx, dy] of STRAIGHT) {
      const p = wrap(maze, { x: x + dx, y: y + dy });
      const j = p.y * maze.width + p.x;
      if (ok[j] === 1 && dist[j] === -1) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

// Spec 2.5 and 2.10, the test's own model of a straight shot from `start`: one cell at a time
// until its footprint would cover a wall. Returns the index of the first hive it enters, or -1.
function shotHits(
  maze: Grid,
  start: Point,
  dx: number,
  dy: number,
  hives: readonly Hive[],
): number {
  let p = start;
  for (let n = 0; n < 1000; n++) {
    const next = { x: p.x + dx, y: p.y + dy };
    if (!clear(maze, box(next, SHOT, SHOT))) return -1;
    const hit = hives.findIndex((h) =>
      overlaps(maze, box(next, SHOT, SHOT), box(h, HIVE, HIVE)),
    );
    if (hit >= 0) return hit;
    p = next;
  }
  return -1;
}

interface Spot {
  readonly at: Point;
  readonly dx: Axis;
  readonly dy: Axis;
}

// A walkable position from which a straight shot hits hive `target` first, and its firing
// direction; the reachable one nearest the player, or undefined.
function firingSpot(
  maze: Grid,
  ok: Uint8Array,
  hives: readonly Hive[],
  target: number,
  fromPlayer: Int32Array,
): Spot | undefined {
  const h = hives[target];
  let best: Spot | undefined;
  let bestDistance = Infinity;
  for (const [dx, dy] of STRAIGHT) {
    for (let gap = 0; gap <= 8; gap++) {
      for (let side = -2; side <= 2; side++) {
        // The player beyond the hive's side opposite (dx, dy), `gap` cells from the place where
        // the shot appears, and `side` cells along that side.
        const at = wrap(maze, {
          x:
            dx > 0
              ? h.x - PLAYER - SHOT - gap
              : dx < 0
                ? h.x + HIVE + SHOT + gap
                : h.x + side,
          y:
            dy > 0
              ? h.y - PLAYER - SHOT - gap
              : dy < 0
                ? h.y + HIVE + SHOT + gap
                : h.y + side,
        });
        const i = at.y * maze.width + at.x;
        if (ok[i] === 0 || fromPlayer[i] < 0 || fromPlayer[i] >= bestDistance) {
          continue;
        }
        const spawn = {
          x: dx < 0 ? at.x - SHOT : dx > 0 ? at.x + PLAYER : at.x + 1,
          y: dy < 0 ? at.y - SHOT : dy > 0 ? at.y + PLAYER : at.y + 1,
        };
        if (!clear(maze, box(spawn, SHOT, SHOT))) continue;
        if (
          hives.some((o) =>
            overlaps(maze, box(spawn, SHOT, SHOT), box(o, HIVE, HIVE)),
          )
        ) {
          continue;
        }
        if (shotHits(maze, spawn, dx, dy, hives) !== target) continue;
        best = { at, dx, dy };
        bestDistance = fromPlayer[i];
      }
    }
  }
  return best;
}

interface Hunt {
  readonly problems: string[];
  readonly hives: number;
  readonly destroyed: number;
  /** For each destroyed hive, the hits it was seen to take, in order, before it went. */
  readonly hitRuns: number[][];
  /** For each destroyed hive, the shots fired at it until it went. */
  readonly shotsFired: number[];
  /** Snipes spawned by the end of the hunt, and after another minute with no hive. */
  readonly snipesAtEnd: number;
  readonly snipesLater: number;
  readonly spawnedDuringHunt: number;
}

// Walks to each hive in turn, along the shortest way that touches no hive, and fires at it
// from a spot where every shot hits it, until it is destroyed. Then waits a minute.
function hunt(seed: number, skill: string): Hunt {
  let state = createGame(seed, skill);
  const { maze } = state;
  const checks = watch(maze, MAX_ENEMIES[digitOf(skill) - 1]);
  const fits = playerFits(maze);
  const hitRuns: number[][] = [];
  const shotsFired: number[] = [];
  const hives = state.hives.length;
  let tick = 0;
  let spawned = 0;
  const advance = (keys: InputState): void => {
    const before = state;
    state = step(state, keys);
    tick++;
    checks.tick(before, state, tick);
    spawned += Math.max(0, state.snipes.length - before.snipes.length);
  };

  while (state.hives.length > 0 && checks.problems.length === 0) {
    const ok = walkable(maze, fits, state.hives);
    const here = { x: state.player.x, y: state.player.y };
    const fromPlayer = distances(maze, ok, here);
    let target = -1;
    let spot: Spot | undefined;
    for (let i = 0; i < state.hives.length && spot === undefined; i++) {
      spot = firingSpot(maze, ok, state.hives, i, fromPlayer);
      target = i;
    }
    if (spot === undefined) {
      checks.problems.push(`seed ${seed}: the test found no spot to fire from`);
      break;
    }
    const aim = { x: state.hives[target].x, y: state.hives[target].y };

    // Walk there.
    const toSpot = distances(maze, ok, spot.at);
    const limit =
      tick + 3 * fromPlayer[spot.at.y * maze.width + spot.at.x] + 30;
    while (!same(state.player, spot.at) && tick < limit) {
      const { x, y } = state.player;
      const d = toSpot[y * maze.width + x];
      const [mx, my]: [Axis, Axis] = STRAIGHT.find(([dx, dy]) => {
        const p = wrap(maze, { x: x + dx, y: y + dy });
        return toSpot[p.y * maze.width + p.x] === d - 1;
      }) ?? [0, 0];
      advance(input(mx, my, 0, 0));
    }
    if (!same(state.player, spot.at)) {
      checks.problems.push(`seed ${seed}: the player did not get to the spot`);
      break;
    }

    // Fire until the hive is gone.
    const run: number[] = [];
    let fired = 0;
    const stop = tick + (HITS + 10) * FIRE_TICKS;
    while (tick < stop) {
      const before = state;
      advance(input(0, 0, spot.dx, spot.dy));
      if (state.shots.length > before.shots.length) fired++;
      const now = state.hives.find((h) => same(h, aim));
      if (now === undefined) break;
      const was = before.hives.find((h) => same(h, aim));
      if (was !== undefined && now.hits !== was.hits) run.push(now.hits);
      // The other hives take no hits.
      for (const h of state.hives) {
        const old = before.hives.find((o) => same(o, h));
        if (!same(h, aim) && old !== undefined && old.hits !== h.hits) {
          checks.problems.push(`tick ${tick}: hive at ${key(h)} was hit`);
        }
      }
    }
    if (state.hives.some((h) => same(h, aim))) {
      checks.problems.push(`seed ${seed}: hive at ${key(aim)} not destroyed`);
      break;
    }
    hitRuns.push(run);
    shotsFired.push(fired);
  }

  const snipesAtEnd = state.snipes.length;
  const spawnedDuringHunt = spawned;
  for (let t = 0; t < MINUTE && checks.problems.length === 0; t++) {
    const before = state.snipes.length;
    advance(NO_INPUT);
    if (state.snipes.length > before) {
      checks.problems.push(`tick ${tick}: a snipe spawned with no hive left`);
    }
  }
  return {
    problems: checks.problems,
    hives,
    destroyed: hitRuns.length,
    hitRuns,
    shotsFired,
    snipesAtEnd,
    snipesLater: state.snipes.length,
    spawnedDuringHunt,
  };
}

// ===========================================================================================

describe("2.6 Skill level / 6.2 Invariants: the enemies fill the map up to the digit's maximum and no further", () => {
  it.each(DIGITS)(
    "digit %d, standing still",
    (digit) => {
      const skill = `${"ABC"[digit % 3]}${digit}`;
      const max = MAX_ENEMIES[digit - 1];
      const game = createGame(101 * digit, skill);
      expect(game.hives).toHaveLength(HIVES[digit - 1]);
      const checks = watch(game.maze, max);
      let state = game;
      let reached = -1;
      for (let tick = 1; tick <= PATIENCE; tick++) {
        const before = state;
        state = step(state, NO_INPUT);
        checks.tick(before, state, tick);
        if (state.snipes.length === max) {
          reached = tick;
          break;
        }
      }
      expect(checks.problems).toEqual([]);
      expect(reached, `${skill} never reached ${max} enemies`).toBeGreaterThan(
        0,
      );
      // It stays full: nothing is spawned beyond the maximum.
      for (let tick = 1; tick <= MINUTE; tick++) {
        const before = state;
        state = step(state, NO_INPUT);
        checks.tick(before, state, reached + tick);
      }
      expect(checks.problems).toEqual([]);
      expect(state.snipes).toHaveLength(max);
      expect(state.hives).toHaveLength(HIVES[digit - 1]);
    },
    SLOW,
  );
});

describe("6.2 Invariants: hives and snipes every tick of a game with random moving and firing (2.3, 2.10)", () => {
  const cases = [3, 4, 5].flatMap((seed) =>
    ["A1", "B5", "C9"].map((skill) => [seed * 7919, skill] as const),
  );

  it.each(cases)(
    "seed %d at %s, for two minutes",
    (seed, skill) => {
      let state = createGame(seed, skill);
      const checks = watch(state.maze, MAX_ENEMIES[digitOf(skill) - 1]);
      let shotTicks = 0;
      for (const [tick, keys] of inputLog(seed + 1, 2 * MINUTE).entries()) {
        const before = state;
        state = step(state, keys);
        checks.tick(before, state, tick + 1);
        if (state.shots.length > 0) shotTicks++;
      }
      expect(checks.problems).toEqual([]);
      // Guards: shots flew and snipes spawned.
      expect(shotTicks).toBeGreaterThan(100);
      expect(state.snipes.length).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe("2.3 Hives / 6.2 Invariants: hunting down every hive", () => {
  it.each([
    [1, "A1"],
    [2, "B3"],
    [3, "C9"],
  ] as const)(
    "seed %d at %s: each hive takes exactly 20 hits, then no more snipes spawn",
    (seed, skill) => {
      const result = hunt(seed, skill);
      expect(result.problems).toEqual([]);
      expect(result.hives).toBe(HIVES[digitOf(skill) - 1]);
      expect(result.destroyed).toBe(result.hives);
      // Every hive survived 19 hits, taken one shot at a time, and the 20th shot destroyed it.
      const nineteen = Array.from({ length: HITS - 1 }, (_, i) => i + 1);
      for (const run of result.hitRuns) expect(run).toEqual(nineteen);
      expect(result.shotsFired).toEqual(
        new Array<number>(result.hives).fill(HITS),
      );
      // The snipes they spawned stayed; no hive is left to spawn more.
      expect(result.spawnedDuringHunt).toBeGreaterThan(0);
      expect(result.snipesLater).toBe(result.snipesAtEnd);
    },
    SLOW,
  );
});

describe("6.2 Determinism with hives", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "seed %d and the same input log give the same hives and snipes",
    (seed) => {
      const log = inputLog(seed + 9, 2 * MINUTE);
      let a = createGame(seed, "C7");
      let b = createGame(seed, "C7");
      for (const keys of log) {
        a = step(a, keys);
        b = step(b, keys);
        expect(a.hives).toEqual(b.hives);
        expect(a.snipes).toEqual(b.snipes);
      }
      expect(a).toEqual(b);
      expect(a.snipes.length).toBeGreaterThan(0);
    },
    SLOW,
  );

  it("different skill levels give different games for the same seed", () => {
    expect(createGame(1, "A1")).not.toEqual(createGame(1, "A9"));
    expect(createGame(1, "A1").hives).toHaveLength(3);
    expect(createGame(1, "A9").hives).toHaveLength(10);
  });
});
