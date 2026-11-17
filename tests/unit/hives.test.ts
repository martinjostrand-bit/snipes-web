import { describe, expect, it } from "vitest";
import { cellAt, createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";
import { hiveColour } from "../../src/render/view";

// Spec 2.3, 2.5, 2.6, 2.10, 4.3, 6.2 and 9.1 WP 09: hives.
//
// - `createGame(seed, skill)` starts a game at a skill level such as "A1" or "M5" (2.6): a
//   letter A to Z and a digit 1 to 9. Without `skill` it starts at a valid level of the
//   developer's choice, so the earlier tests keep working. Any other skill level is a
//   RangeError.
// - `state.hives` holds the hives that are alive, each a 4 x 4 footprint whose position
//   (`x`, `y`) is its top-left cell (2.10), with `hits`, the number of hits it has taken. They
//   are placed at random open spots when the game starts; how many is set by the digit.
// - `state.snipes` holds the snipes on the map, each a 4 x 2 footprint whose position is its
//   top-left cell (2.10). Every hive spawns a new one at a fixed interval while the number of
//   enemies is below the digit's maximum. Ghosts come with WP 15, so the tests use letters
//   without ghosts (A to C) wherever they count enemies.
// - A player's shot that enters a cell of a hive's footprint hits it and disappears (2.5).
//   The 20th hit destroys the hive: it leaves `state.hives`, never spawns again, and the
//   snipes it spawned stay.
// - `hiveColour(hits)` in the renderer gives the colour a hive that has taken `hits` hits is
//   drawn in; it changes as the hive takes damage (2.3).
//
// The fixed spawn interval is a tunable constant the spec does not give, so the tests measure
// it, and allow up to 10 minutes of game time for spawning to fill the map.

type Axis = InputState["moveX"];
type Direction = [name: string, dx: Axis, dy: Axis];
type Hive = GameState["hives"][number];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)
const HIVE = 4; // a hive's footprint is HIVE x HIVE cells (2.10)
const SNIPE_W = 4; // a snipe's footprint is SNIPE_W x SNIPE_H cells (2.10)
const SNIPE_H = 2;
const HITS = 20; // a hive withstands 19 hits; the 20th destroys it (2.3)
const FIRE_TICKS = 13; // ticks from one shot to the next while a fire key is held (2.5)
const MINUTE = 60 * 60; // ticks in a minute at 60 ticks/s (4.3)
const PATIENCE = 10 * MINUTE; // the longest the tests wait for spawning
// Spec 2.6, the digit table: hives and max enemies on the map, for digits 1 to 9.
const HIVES = [3, 3, 4, 4, 5, 5, 6, 8, 10];
const MAX_ENEMIES = [10, 20, 30, 40, 60, 80, 100, 120, 150];
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const SLOW = 120_000;

const DIRECTIONS: Direction[] = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
  ["up-left", -1, -1],
  ["up-right", 1, -1],
  ["down-left", -1, 1],
  ["down-right", 1, 1],
];

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

// Whether the footprint has no wall cell, with wrap-around (2.10).
function clear(maze: Grid, box: Box): boolean {
  return cells(box).every((c) => cellAt(maze, c) === "open");
}

// Whether two footprints share a cell, with wrap-around.
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

function hiveBox(p: Point): Box {
  return { x: p.x, y: p.y, width: HIVE, height: HIVE };
}

function snipeBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SNIPE_W, height: SNIPE_H };
}

function shotBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SHOT, height: SHOT };
}

function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
}

function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function fire(dx: Axis, dy: Axis): InputState {
  return { ...NO_INPUT, fireX: dx, fireY: dy };
}

// Spec 2.10: where a player's shot appears, not wrapped.
function spawnFor(player: Point, dx: number, dy: number): Point {
  return {
    x: dx < 0 ? player.x - SHOT : dx > 0 ? player.x + PLAYER : player.x + 1,
    y: dy < 0 ? player.y - SHOT : dy > 0 ? player.y + PLAYER : player.y + 1,
  };
}

// A hive the shot appearing at `spawn` and going (dx, dy) enters on its first move, by the
// cell of its footprint that leads; the shot's starting cells are not on the hive. Between
// the hive and the player there is only the 2-cell-wide place where the shot appears.
function hiveAhead(spawn: Point, dx: number, dy: number): Point {
  const lead = {
    x: spawn.x + dx + (dx > 0 ? 1 : 0),
    y: spawn.y + dy + (dy > 0 ? 1 : 0),
  };
  return {
    x: dx < 0 ? lead.x - HIVE + 1 : lead.x,
    y: dy < 0 ? lead.y - HIVE + 1 : lead.y,
  };
}

// A room whose walls are its top row and left column; the grid wraps, so they are also its
// bottom and right walls, and every shot ends at a wall.
const room = createGrid(64, 48, ({ x, y }) =>
  x === 0 || y === 0 ? "wall" : "open",
);
const centre = { x: 30, y: 22 };

// A game at `skill` in `maze` with the player at `player` and new hives at `hives`, each with
// `hits` hits taken, and no snipes or shots. The hives are copies of a new game's hive, so
// that anything else a hive holds is as at the start of a game.
function arena(
  maze: Grid,
  player: Point,
  hives: readonly Point[],
  skill = "A1",
  hits = 0,
): GameState {
  const game = createGame(1, skill);
  const template: Hive = game.hives[0];
  return {
    ...game,
    maze,
    player: { ...game.player, x: player.x, y: player.y },
    shots: [],
    hives: hives.map((h) => ({ ...template, x: h.x, y: h.y, hits })),
    snipes: [],
  };
}

function hiveAt(state: GameState, p: Point): Hive | undefined {
  return state.hives.find((h) => same(h, p));
}

// Whether `after` has a shot that was not in flight in `before`, that is, one fired this tick.
function firedThisTick(before: GameState, after: GameState): boolean {
  return after.shots.length > before.shots.length;
}

// Steps with NO_INPUT until `state.snipes` has `count` snipes, at most `limit` ticks.
function until(state: GameState, count: number, limit = PATIENCE): GameState {
  let current = state;
  for (let tick = 0; tick < limit && current.snipes.length < count; tick++) {
    current = step(current, NO_INPUT);
  }
  return current;
}

// The ticks (counted from 1) on which a lone hive in the room spawned, and how many it spawned
// on each, until it had spawned `count` times.
function loneSpawns(count: number): { ticks: number[]; added: number[] } {
  let state = arena(room, { x: 4, y: 4 }, [{ x: 40, y: 30 }], "A9");
  const ticks: number[] = [];
  const added: number[] = [];
  for (let tick = 1; tick <= PATIENCE && ticks.length < count; tick++) {
    const before = state.snipes.length;
    state = step(state, NO_INPUT);
    if (state.snipes.length !== before) {
      ticks.push(tick);
      added.push(state.snipes.length - before);
    }
  }
  return { ticks, added };
}

// The fixed spawn interval, measured once from a lone hive.
let measured: number | undefined;
function spawnInterval(): number {
  if (measured !== undefined) return measured;
  const { ticks } = loneSpawns(3);
  if (ticks.length < 3) throw new Error("A lone hive does not spawn");
  measured = ticks[2] - ticks[1];
  return measured;
}

// Seeds drawn from the seeded PRNG, so the run is repeatable.
function randomSeeds(count: number, start: number): number[] {
  const seeds: number[] = [];
  let rng: Rng = createRng(start);
  while (seeds.length < count) {
    const [value, next] = nextFloat(rng);
    seeds.push(Math.floor(value * 2 ** 32));
    rng = next;
  }
  return seeds;
}

// ===========================================================================================

describe("2.6 Skill level: createGame(seed, skill)", () => {
  it.each(["A1", "M5", "Z9", "C3", "W7"])("starts a game at %s", (skill) => {
    const game = createGame(42, skill);
    const digit = Number(skill[1]);
    expect(game.hives).toHaveLength(HIVES[digit - 1]);
    expect(Array.isArray(game.snipes)).toBe(true);
    expect(game.snipes.length).toBeLessThanOrEqual(MAX_ENEMIES[digit - 1]);
  });

  it("starts a game without a skill level, as the earlier work packages do", () => {
    const game = createGame(42);
    expect(HIVES).toContain(game.hives.length);
  });

  it.each(["A0", "A10", "", "A", "5", "AA", "1A", "@5", "[5", "A1 ", "A-1"])(
    "rejects the skill level %j",
    (skill) => {
      expect(() => createGame(1, skill)).toThrow(RangeError);
    },
  );

  it("is the same game for the same seed and skill level", () => {
    for (const skill of ["A1", "K4", "Z9"]) {
      const game = createGame(77, skill);
      expect(game.hives).toHaveLength(HIVES[Number(skill[1]) - 1]);
      expect(createGame(77, skill)).toEqual(game);
    }
  });

  it("keeps the game plain data that can be copied, with its hives and snipes", () => {
    const state = until(createGame(7, "C9"), 1);
    expect(state.hives).toHaveLength(10);
    expect(state.snipes.length).toBeGreaterThan(0);
    expect(structuredClone(state)).toEqual(state);
  });
});

describe("2.3 Hives / 2.6 Skill level: the digit sets how many hives there are", () => {
  it.each(DIGITS)("digit %d, every letter", (digit) => {
    for (const [i, letter] of LETTERS.entries()) {
      const game = createGame(1000 * digit + i, `${letter}${digit}`);
      expect(game.hives, `${letter}${digit}`).toHaveLength(HIVES[digit - 1]);
    }
  });

  it("does not depend on the letter for the same seed", () => {
    for (const digit of DIGITS) {
      const counts = LETTERS.map(
        (letter) => createGame(5, `${letter}${digit}`).hives.length,
      );
      expect(new Set(counts)).toEqual(new Set([HIVES[digit - 1]]));
    }
  });
});

describe("2.3 Hives: placed at random open spots when the game starts (2.10, 6.2)", () => {
  const seeds = randomSeeds(200, 20261116);

  it(
    "never covers a wall with a hive's 4 x 4 footprint, for 200 seeds at digit 9",
    () => {
      const problems: string[] = [];
      for (const seed of seeds) {
        const { maze, hives } = createGame(seed, "A9");
        for (const h of hives) {
          if (!inside(maze, h)) {
            problems.push(`seed ${seed}: hive outside at ${h.x},${h.y}`);
          } else if (!clear(maze, hiveBox(h))) {
            problems.push(`seed ${seed}: hive on a wall at ${h.x},${h.y}`);
          }
        }
      }
      expect(problems).toEqual([]);
    },
    SLOW,
  );

  it.each(DIGITS)(
    "never covers a wall at digit %d, for every letter",
    (digit) => {
      for (const [i, letter] of LETTERS.entries()) {
        const { maze, hives } = createGame(seeds[i], `${letter}${digit}`);
        for (const h of hives) {
          expect(inside(maze, h), `${letter}${digit}`).toBe(true);
          expect(clear(maze, hiveBox(h)), `${letter}${digit}`).toBe(true);
        }
      }
    },
    SLOW,
  );

  it(
    "puts each hive on a spot of its own: no two hives share a cell",
    () => {
      const problems: string[] = [];
      for (const seed of seeds) {
        const { maze, hives } = createGame(seed, "A9");
        for (let i = 0; i < hives.length; i++) {
          for (let j = i + 1; j < hives.length; j++) {
            if (overlaps(maze, hiveBox(hives[i]), hiveBox(hives[j]))) {
              problems.push(
                `seed ${seed}: hives at ${hives[i].x},${hives[i].y} and ${hives[j].x},${hives[j].y}`,
              );
            }
          }
        }
      }
      expect(problems).toEqual([]);
    },
    SLOW,
  );

  it("starts every hive with no hits taken", () => {
    for (const seed of seeds.slice(0, 20)) {
      for (const h of createGame(seed, "Z9").hives) {
        expect(h.hits).toBe(0);
      }
    }
  });

  it("puts the hives in the same places for the same seed and skill level", () => {
    for (const seed of seeds.slice(0, 20)) {
      const a = createGame(seed, "B6").hives.map(({ x, y }) => ({ x, y }));
      const b = createGame(seed, "B6").hives.map(({ x, y }) => ({ x, y }));
      expect(a).toEqual(b);
    }
  });

  it(
    "puts the hives in different places for different seeds, all over the maze",
    () => {
      const firsts = new Set<string>();
      const blocks = new Set<string>();
      for (const seed of seeds) {
        const { hives } = createGame(seed, "A9");
        firsts.add(`${hives[0].x},${hives[0].y}`);
        // The maze is 16 x 20 blocks of 16 x 12 cells (2.10).
        for (const h of hives) {
          blocks.add(`${Math.floor(h.x / 16)},${Math.floor(h.y / 12)}`);
        }
      }
      expect(firsts.size).toBeGreaterThan(180);
      expect(blocks.size).toBeGreaterThan(160);
    },
    SLOW,
  );
});

describe("2.3 Hives: withstand 19 hits, the 20th destroys the hive (2.5, 6.2)", () => {
  // The player stands still and holds a fire key. The hive is right beyond the place where
  // the shot appears, so every shot hits it on its first move, until it is destroyed.
  it.each(DIRECTIONS)(
    "fired at %s, it survives 19 hits and is destroyed by the 20th",
    (_name, dx, dy) => {
      const spawn = spawnFor(centre, dx, dy);
      const at = hiveAhead(spawn, dx, dy);
      // The test's own checks: the hive is open, off the player and off the shot's start.
      expect(clear(room, hiveBox(at))).toBe(true);
      expect(overlaps(room, hiveBox(at), playerBox(centre))).toBe(false);
      expect(overlaps(room, hiveBox(at), shotBox(spawn))).toBe(false);

      let state = arena(room, centre, [at]);
      const seen: number[] = [];
      let fired = 0;
      let destroyedAt = -1;
      for (let tick = 1; tick <= (HITS + 5) * FIRE_TICKS; tick++) {
        const before = state;
        state = step(state, fire(dx, dy));
        const was = hiveAt(before, at);
        const now = hiveAt(state, at);
        if (was === undefined) {
          expect(now, `tick ${tick}: a destroyed hive came back`).toBe(
            undefined,
          );
          continue;
        }
        // Until the hive is destroyed, every shot appears where 2.10 says and hits on its
        // first move, so at most one is in flight.
        expect(state.shots.length, `tick ${tick}`).toBeLessThanOrEqual(1);
        if (firedThisTick(before, state)) {
          fired++;
          expect(state.shots[0], `tick ${tick}`).toMatchObject(spawn);
        }
        const hit = now === undefined || now.hits > was.hits;
        if (hit) {
          // Hit by the shot in flight, which disappears.
          expect(before.shots, `tick ${tick}`).toHaveLength(1);
          expect(state.shots, `tick ${tick}`).toEqual([]);
        }
        if (now === undefined) {
          // Destroyed: only by the 20th hit.
          expect(was.hits, `tick ${tick}`).toBe(HITS - 1);
          destroyedAt = tick;
          continue;
        }
        expect(now.hits - was.hits, `tick ${tick}`).toBeGreaterThanOrEqual(0);
        expect(now.hits - was.hits, `tick ${tick}`).toBeLessThanOrEqual(1);
        if (hit) seen.push(now.hits);
      }

      // It survived 19 hits, taking them one at a time, and the 20th shot destroyed it.
      expect(seen).toEqual(Array.from({ length: HITS - 1 }, (_, i) => i + 1));
      expect(destroyedAt).toBeGreaterThan(0);
      expect(fired).toBe(HITS);
    },
  );

  it.each(Array.from({ length: HITS }, (_, k) => k))(
    "a hive that has taken %d hits takes one more from one shot",
    (k) => {
      const spawn = spawnFor(centre, 1, 0);
      const at = hiveAhead(spawn, 1, 0);
      let state = arena(room, centre, [at], "A1", k);
      let shots = 0;
      for (let tick = 0; tick < FIRE_TICKS - 1; tick++) {
        const before = state;
        // Holds the fire key only until one shot is fired.
        state = step(state, shots === 0 ? fire(1, 0) : NO_INPUT);
        if (firedThisTick(before, state)) shots++;
      }
      expect(shots).toBe(1);
      expect(state.shots).toEqual([]);
      if (k + 1 < HITS) {
        expect(state.hives).toHaveLength(1);
        expect(state.hives[0]).toMatchObject({ x: at.x, y: at.y, hits: k + 1 });
      } else {
        expect(state.hives).toEqual([]);
      }
    },
  );

  it("is hit by a shot that enters only one cell of its footprint", () => {
    // Fired up, the shot covers the two columns spawn.x and spawn.x + 1. A hive whose
    // footprint shares one of them is hit; one just beside them is passed.
    const spawn = spawnFor(centre, 0, -1);
    const above = hiveAhead(spawn, 0, -1);
    const cases: [x: number, hit: boolean][] = [
      [spawn.x + 1, true],
      [spawn.x - HIVE + 1, true],
      [spawn.x + 2, false],
      [spawn.x - HIVE, false],
    ];
    for (const [x, hit] of cases) {
      const at = { x, y: above.y };
      let state = arena(room, centre, [at]);
      let passed = false;
      for (let tick = 0; tick < 60; tick++) {
        state = step(state, tick === 0 ? fire(0, -1) : NO_INPUT);
        if (state.shots.some((s) => s.y < at.y)) passed = true;
      }
      const where = `hive at x ${x}`;
      expect(state.hives[0].hits, where).toBe(hit ? 1 : 0);
      expect(passed, where).toBe(!hit);
    }
  });

  it("does not stop shots once destroyed", () => {
    const spawn = spawnFor(centre, 1, 0);
    const at = hiveAhead(spawn, 1, 0);
    let state = arena(room, centre, [at], "A1", HITS - 1);
    let destroyed = false;
    let through = false;
    for (let tick = 0; tick < 4 * FIRE_TICKS; tick++) {
      state = step(state, fire(1, 0));
      if (state.hives.length === 0) destroyed = true;
      if (
        destroyed &&
        state.shots.some((s) => overlaps(room, shotBox(s), hiveBox(at)))
      ) {
        through = true;
      }
    }
    expect(destroyed).toBe(true);
    expect(through).toBe(true);
  });

  it("takes no hit from a shot that a wall stops before it", () => {
    const spawn = spawnFor(centre, 1, 0);
    const at = { x: spawn.x + SHOT + 3, y: centre.y };
    // A wall column between the place where the shot appears and the hive.
    const walled = createGrid(64, 48, ({ x, y }) =>
      x === 0 || y === 0 || x === spawn.x + SHOT + 1 ? "wall" : "open",
    );
    let state = arena(walled, centre, [at]);
    for (let tick = 0; tick < 5 * FIRE_TICKS; tick++) {
      state = step(state, fire(1, 0));
    }
    expect(state.hives).toHaveLength(1);
    expect(state.hives[0].hits).toBe(0);
  });

  it("counts the hits of each hive on its own", () => {
    const right = hiveAhead(spawnFor(centre, 1, 0), 1, 0);
    const left = hiveAhead(spawnFor(centre, -1, 0), -1, 0);
    let state = arena(room, centre, [right, left]);
    // Three shots to the right, then two to the left.
    for (let tick = 0; tick < 5 * FIRE_TICKS; tick++) {
      state = step(state, tick < 3 * FIRE_TICKS ? fire(1, 0) : fire(-1, 0));
    }
    expect(hiveAt(state, right)?.hits).toBe(3);
    expect(hiveAt(state, left)?.hits).toBe(2);
  });

  it(
    "keeps every hive in its place",
    () => {
      for (const seed of [1, 2, 3]) {
        const game = createGame(seed, "C9");
        let state = game;
        for (let tick = 0; tick < MINUTE; tick++) {
          state = step(state, NO_INPUT);
        }
        expect(state.hives.map(({ x, y }) => ({ x, y }))).toEqual(
          game.hives.map(({ x, y }) => ({ x, y })),
        );
      }
    },
    SLOW,
  );
});

describe("2.3 Hives: spawn continuously, at a fixed interval", () => {
  it(
    "a lone hive spawns one snipe at a time, at a fixed interval",
    () => {
      const { ticks, added } = loneSpawns(6);
      expect(ticks).toHaveLength(6);
      expect(added).toEqual([1, 1, 1, 1, 1, 1]);
      const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
      expect(gaps[0]).toBeGreaterThan(0);
      expect(new Set(gaps)).toEqual(new Set([gaps[0]]));
    },
    SLOW,
  );

  it.each([1, 2, 3, 5])(
    "%d hives each spawn once per interval",
    (n) => {
      const interval = spawnInterval();
      const at = Array.from({ length: n }, (_, i) => ({
        x: 8 + 10 * i,
        y: 30,
      }));
      let state = arena(room, { x: 4, y: 4 }, at, "A9");
      const rounds = 4;
      for (let tick = 0; tick < rounds * interval; tick++) {
        state = step(state, NO_INPUT);
      }
      // In 4 intervals each hive spawns 4 times, or 3 or 5 depending on where in its
      // interval it started.
      expect(state.snipes.length).toBeGreaterThanOrEqual(n * (rounds - 1));
      expect(state.snipes.length).toBeLessThanOrEqual(n * (rounds + 1));
    },
    SLOW,
  );

  it(
    "every hive of a new game spawns, all over the maze",
    () => {
      const interval = spawnInterval();
      const game = createGame(11, "A9");
      let state = game;
      for (let tick = 0; tick < 3 * interval; tick++) {
        state = step(state, NO_INPUT);
      }
      const n = game.hives.length;
      expect(state.snipes.length).toBeGreaterThanOrEqual(2 * n);
      expect(state.snipes.length).toBeLessThanOrEqual(4 * n);
    },
    SLOW,
  );

  it(
    "keeps spawning after the enemies drop below the maximum again",
    () => {
      const interval = spawnInterval();
      // Digit 1 allows 10 enemies.
      let state = until(arena(room, { x: 4, y: 4 }, [{ x: 40, y: 30 }]), 10);
      expect(state.snipes).toHaveLength(10);
      // Three snipes leave the map.
      state = { ...state, snipes: state.snipes.slice(3) };
      for (let tick = 0; tick < 5 * interval; tick++) {
        state = step(state, NO_INPUT);
        expect(state.snipes.length).toBeLessThanOrEqual(10);
      }
      expect(state.snipes).toHaveLength(10);
    },
    SLOW,
  );
});

describe("2.3 Hives / 2.6 Skill level: the number of enemies never exceeds the digit's maximum (6.2)", () => {
  it(
    "fills the map up to the maximum and no further, with one hive",
    () => {
      const interval = spawnInterval();
      let state = arena(room, { x: 4, y: 4 }, [{ x: 40, y: 30 }]);
      let most = 0;
      for (let tick = 0; tick < 15 * interval; tick++) {
        state = step(state, NO_INPUT);
        most = Math.max(most, state.snipes.length);
      }
      expect(most).toBe(MAX_ENEMIES[0]);
      expect(state.snipes).toHaveLength(MAX_ENEMIES[0]);
    },
    SLOW,
  );

  it(
    "does not exceed it when more hives are due to spawn than there is room for",
    () => {
      // Ten hives (those of a digit 9 game) under the maximum of digit 1, 10 enemies: when
      // they all spawn on the same tick, only as many snipes appear as the maximum allows.
      const interval = spawnInterval();
      const nine = createGame(31, "A9");
      for (const [skill, max] of [
        ["A1", 10],
        ["B2", 20],
        ["C3", 30],
      ] as const) {
        let state: GameState = {
          ...createGame(31, skill),
          maze: nine.maze,
          player: nine.player,
          hives: nine.hives,
          snipes: [],
          shots: [],
        };
        expect(state.hives).toHaveLength(10);
        let most = 0;
        for (let tick = 0; tick < 6 * interval; tick++) {
          state = step(state, NO_INPUT);
          most = Math.max(most, state.snipes.length);
          expect(
            state.snipes.length,
            `${skill}, tick ${tick}`,
          ).toBeLessThanOrEqual(max);
        }
        expect(most, skill).toBe(max);
        expect(state.snipes, skill).toHaveLength(max);
      }
    },
    SLOW,
  );

  it("spawns nothing while the map is at the maximum", () => {
    const interval = spawnInterval();
    let state = until(arena(room, { x: 4, y: 4 }, [{ x: 40, y: 30 }]), 10);
    expect(state.snipes).toHaveLength(10);
    // More hives join; the map is still full.
    state = {
      ...state,
      hives: [
        ...state.hives,
        ...arena(room, { x: 4, y: 4 }, [
          { x: 10, y: 30 },
          { x: 20, y: 30 },
        ]).hives,
      ],
    };
    for (let tick = 0; tick < 4 * interval; tick++) {
      state = step(state, NO_INPUT);
      expect(state.snipes).toHaveLength(10);
    }
  });
});

describe("2.3 Hives: a destroyed hive stops spawning; the snipes it spawned stay (6.2)", () => {
  it(
    "spawns no more after the 20th hit, while an undamaged twin keeps spawning",
    () => {
      const interval = spawnInterval();
      const spawn = spawnFor(centre, 1, 0);
      const at = hiveAhead(spawn, 1, 0);
      // Digit 9 allows 150 enemies, so the map is never full here.
      let state = until(arena(room, centre, [at], "A9"), 2);
      expect(state.snipes.length).toBeGreaterThanOrEqual(2);
      let twin = state;

      // Fire until the hive is destroyed.
      let destroyedAt = -1;
      for (let tick = 0; tick < (HITS + 5) * FIRE_TICKS; tick++) {
        const before = state;
        state = step(state, fire(1, 0));
        twin = step(twin, NO_INPUT);
        if (before.hives.length === 1 && state.hives.length === 0) {
          destroyedAt = tick;
          // The snipes it spawned stay.
          expect(state.snipes.length).toBe(before.snipes.length);
        }
        if (destroyedAt >= 0) break;
      }
      expect(destroyedAt).toBeGreaterThanOrEqual(0);

      const left = state.snipes.length;
      const twinBefore = twin.snipes.length;
      for (let tick = 0; tick < 5 * interval; tick++) {
        state = step(state, NO_INPUT);
        twin = step(twin, NO_INPUT);
        expect(state.snipes.length, `tick ${tick}`).toBeLessThanOrEqual(left);
        expect(state.hives).toEqual([]);
      }
      expect(state.snipes).toHaveLength(left);
      // Guard: without the hits, the hive would have spawned in that time.
      expect(twin.snipes.length).toBeGreaterThan(twinBefore);
    },
    SLOW,
  );

  it(
    "the other hives keep spawning",
    () => {
      const interval = spawnInterval();
      const spawn = spawnFor(centre, 1, 0);
      const target = hiveAhead(spawn, 1, 0);
      const other = { x: 8, y: 36 };
      let state = arena(room, centre, [target, other], "A9", 0);
      state = {
        ...state,
        hives: state.hives.map((h) =>
          same(h, target) ? { ...h, hits: HITS - 1 } : h,
        ),
      };
      for (let tick = 0; tick < FIRE_TICKS; tick++) {
        state = step(state, tick === 0 ? fire(1, 0) : NO_INPUT);
      }
      expect(state.hives.map(({ x, y }) => ({ x, y }))).toEqual([other]);
      const before = state.snipes.length;
      for (let tick = 0; tick < 3 * interval; tick++) {
        state = step(state, NO_INPUT);
      }
      expect(state.snipes.length - before).toBeGreaterThanOrEqual(2);
      expect(state.snipes.length - before).toBeLessThanOrEqual(4);
    },
    SLOW,
  );
});

describe("2.3 Hives / 2.10 Sizes: a spawned snipe's footprint never covers a wall (6.2)", () => {
  // Hives in tight places, some across the edges of the grid. Every snipe on the map is
  // checked on every tick.
  function check(
    name: string,
    maze: Grid,
    player: Point,
    hives: readonly Point[],
  ): number {
    for (const h of hives) {
      expect(clear(maze, hiveBox(h)), `${name}: the test's hive`).toBe(true);
    }
    expect(clear(maze, playerBox(player)), `${name}: the test's player`).toBe(
      true,
    );
    const interval = spawnInterval();
    let state = arena(maze, player, hives, "A9");
    let most = 0;
    for (let tick = 0; tick < 6 * interval; tick++) {
      state = step(state, NO_INPUT);
      for (const s of state.snipes) {
        expect(inside(maze, s), `${name}: snipe at ${s.x},${s.y}`).toBe(true);
        expect(
          clear(maze, snipeBox(s)),
          `${name}: snipe on a wall at ${s.x},${s.y}, tick ${tick}`,
        ).toBe(true);
      }
      most = Math.max(most, state.snipes.length);
    }
    return most;
  }

  it(
    "in a corridor exactly 4 cells wide, across the bottom edge",
    () => {
      const maze = createGrid(40, 30, ({ x }) =>
        x >= 10 && x <= 13 ? "open" : "wall",
      );
      expect(
        check("vertical", maze, { x: 10, y: 10 }, [{ x: 10, y: 28 }]),
      ).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "in a corridor exactly 4 cells high, across the right edge",
    () => {
      const maze = createGrid(40, 30, ({ y }) =>
        y >= 5 && y <= 8 ? "open" : "wall",
      );
      expect(
        check("horizontal", maze, { x: 15, y: 5 }, [{ x: 38, y: 5 }]),
      ).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "in a pocket that only just holds the hive",
    () => {
      // A 4 x 4 pocket for the hive, and a room for the player far from it.
      const maze = createGrid(40, 30, ({ x, y }) =>
        (x >= 20 && x <= 23 && y >= 10 && y <= 13) ||
        (x >= 2 && x <= 9 && y >= 2 && y <= 9)
          ? "open"
          : "wall",
      );
      check("pocket", maze, { x: 3, y: 3 }, [{ x: 20, y: 10 }]);
    },
    SLOW,
  );

  it(
    "in rough grids full of single wall cells",
    () => {
      let spawned = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        let rng: Rng = createRng(seed);
        const draw = (n: number): number => {
          const [value, next] = nextFloat(rng);
          rng = next;
          return Math.floor(value * n);
        };
        const maze = createGrid(48, 40, () =>
          draw(8) === 0 ? "wall" : "open",
        );
        // The open spots for the player and three hives, none sharing a cell.
        const spots: Point[] = [];
        for (let y = 0; y < maze.height && spots.length < 4; y++) {
          for (let x = 0; x < maze.width && spots.length < 4; x++) {
            const p = { x, y };
            if (
              clear(maze, hiveBox(p)) &&
              spots.every((q) => !overlaps(maze, hiveBox(p), hiveBox(q)))
            ) {
              spots.push(p);
            }
          }
        }
        expect(spots, `seed ${seed}`).toHaveLength(4);
        spawned += check(`rough ${seed}`, maze, spots[0], spots.slice(1));
      }
      expect(spawned).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "in generated mazes, with many snipes on the map",
    () => {
      for (const [seed, skill] of [
        [5, "A4"],
        [6, "B9"],
      ] as const) {
        let state = createGame(seed, skill);
        for (let tick = 0; tick < 10 * spawnInterval(); tick++) {
          state = step(state, NO_INPUT);
        }
        expect(state.snipes.length).toBeGreaterThan(0);
        for (const s of state.snipes) {
          expect(inside(state.maze, s)).toBe(true);
          expect(clear(state.maze, snipeBox(s)), `${s.x},${s.y}`).toBe(true);
        }
      }
    },
    SLOW,
  );
});

describe("2.3 Hives: the colour changes as a hive takes damage", () => {
  // The colours for 0 to 19 hits taken, the hits a live hive can have.
  function colours(): string[] {
    return Array.from({ length: HITS }, (_, hits) => hiveColour(hits));
  }

  it("gives a colour for every number of hits a live hive can have taken", () => {
    for (const colour of colours()) {
      expect(typeof colour).toBe("string");
      expect(colour.length).toBeGreaterThan(0);
    }
  });

  it("draws a hive close to breaking in another colour than a new one", () => {
    const all = colours();
    expect(all[HITS - 1]).not.toBe(all[0]);
  });

  it("moves through its colour stages one way: a colour once left never comes back", () => {
    const all = colours();
    const stages = all.filter((c, i) => i === 0 || c !== all[i - 1]);
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(stages).size).toBe(stages.length);
  });

  it("gives the same colour for the same number of hits", () => {
    expect(colours()).toEqual(colours());
  });
});
