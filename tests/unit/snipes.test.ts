import { describe, expect, it } from "vitest";
import { createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  type GameState,
  type InputState,
} from "../../src/core/state";
// Spec 2.7 (WP 13): these tests go on after a level is cleared; see play-on.ts.
import { playOn as step } from "../play-on";

// Spec 2.4, 2.5, 2.6, 2.10, 4.3, 6.2 and 9.1 WP 10: snipes move, turn and fire.
//
// - `state.snipes` holds the snipes on the map in the order they appeared, oldest first. Each
//   is a 4 x 2 footprint whose position (`x`, `y`) is its top-left cell (2.10), with its
//   direction (`dx`, `dy`), one of the 8 (each -1, 0 or 1, never both 0; y grows downwards,
//   so up is dy = -1), and its turning sense `turn`: 1 is clockwise on the screen (up, then
//   up-right, right, down-right, down, ...), -1 anticlockwise. Anything else a snipe holds is
//   the implementation's: the tests copy it from a snipe that has just appeared, so a copy
//   takes its first step on the next tick, as a new snipe does (2.4).
// - `state.snipeShots` holds the snipes' shots in flight, each `{ x, y, dx, dy }` like a
//   player's shot in `state.shots`: a 2 x 2 footprint and its direction. A new game has none.
// - `state.rng` is the game's PRNG (`createRng`, `nextFloat`); every random draw in 2.4 is one
//   `nextFloat` from it, in the order 2.4 gives, and nothing else is drawn. The tests choose a
//   PRNG state whose next values are what a case needs, and count the draws a tick used.
//
// 2.4 does not fix the order of the list of 8 directions that a random direction is taken
// from, only that it is fixed, so the tests learn it from the game and check that it is one.
// Spec 2.2 and 9.1 WP 11: a snipe's shot that reaches the player, and a snipe that touches it,
// kill the player: `state.lives` goes down by one and `state.respawn` is above 0 while the
// player waits to come back (tests/unit/death.test.ts checks this in full).

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Shot = GameState["snipeShots"][number];
type Turn = Snipe["turn"];

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
const KEEP = 3 / 4; // the keep chance (2.4)
const RANDOM_TURN = 1 / 4; // the random-turn chance (2.4)
const STRAIGHT_WAIT = 10; // ticks from a straight step to the next (2.4)
const DIAGONAL_WAIT = 13; // ticks from a diagonal step to the next (2.4)
const PATIENCE = 10 * 60 * 60; // ten minutes of ticks, the longest a test waits for a spawn
// Spec 2.6: snipe accuracy by letter, A to Z.
const ACCURACY: Record<string, number> = Object.fromEntries(
  [
    2, 3, 4, 3, 4, 4, 3, 4, 3, 4, 4, 5, 3, 4, 3, 4, 3, 4, 3, 4, 4, 5, 4, 4, 5,
    5,
  ].map((a, i) => [String.fromCharCode(65 + i), a]),
);
const LETTERS = Object.keys(ACCURACY);

const UP: Dir = [0, -1];
const UP_RIGHT: Dir = [1, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const DOWN_LEFT: Dir = [-1, 1];
const LEFT: Dir = [-1, 0];
const UP_LEFT: Dir = [-1, -1];
// The 8 directions clockwise on the screen, the test's own list for turning.
const CLOCKWISE: readonly Dir[] = [
  UP,
  UP_RIGHT,
  RIGHT,
  DOWN_RIGHT,
  DOWN,
  DOWN_LEFT,
  LEFT,
  UP_LEFT,
];
const NAMES = [
  "up",
  "up-right",
  "right",
  "down-right",
  "down",
  "down-left",
  "left",
  "up-left",
];

function name(d: Dir): string {
  return NAMES[CLOCKWISE.findIndex((c) => same(c, d))];
}

function same(a: Dir, b: Dir): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// The direction k eighths of a turn from d: clockwise for k > 0.
function rotate(d: Dir, k: number): Dir {
  const i = CLOCKWISE.findIndex((c) => same(c, d));
  return CLOCKWISE[(((i + k) % 8) + 8) % 8];
}

function dirOf(s: { readonly dx: number; readonly dy: number }): Dir {
  return [s.dx as Axis, s.dy as Axis];
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

function overlaps(maze: Grid, a: Box, b: Box): boolean {
  const keys = new Set(
    cells(a).map((c) => `${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
  return cells(b).some((c) =>
    keys.has(`${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
}

function snipeBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SNIPE_W, height: SNIPE_H };
}

function hiveBox(p: Point): Box {
  return { x: p.x, y: p.y, width: HIVE, height: HIVE };
}

function at(maze: Grid, p: Point): Point {
  return { x: mod(p.x, maze.width), y: mod(p.y, maze.height) };
}

function plus(maze: Grid, p: Point, [dx, dy]: Dir, k = 1): Point {
  return at(maze, { x: p.x + k * dx, y: p.y + k * dy });
}

function where(s: Point): Point {
  return { x: s.x, y: s.y };
}

// Spec 2.4: where a snipe at `p` firing in direction d puts its shot, not wrapped: just
// outside its footprint, over its middle two columns straight up or down, over its two rows
// straight left or right, touching the matching corner diagonally.
function shotStart(p: Point, [dx, dy]: Dir): Point {
  return {
    x: dx < 0 ? p.x - SHOT : dx > 0 ? p.x + SNIPE_W : p.x + 1,
    y: dy < 0 ? p.y - SHOT : dy > 0 ? p.y + SNIPE_H : p.y,
  };
}

// An open grid, walls at the given cells.
function grid(width: number, height: number, walls: readonly Point[] = []) {
  const set = new Set(
    walls.map((w) => `${mod(w.x, width)},${mod(w.y, height)}`),
  );
  return createGrid(width, height, ({ x, y }) =>
    set.has(`${x},${y}`) ? "wall" : "open",
  );
}

// --- The PRNG ------------------------------------------------------------------------------

function values(rng: Rng, n: number): number[] {
  const result: number[] = [];
  let r = rng;
  for (let i = 0; i < n; i++) {
    let v: number;
    [v, r] = nextFloat(r);
    result.push(v);
  }
  return result;
}

// How many draws lead from `before` to `after`; -1 if not 0 to 64.
function drawsUsed(before: Rng, after: Rng): number {
  let r = before;
  for (let n = 0; n <= 64; n++) {
    if (r.state === after.state) return n;
    r = nextFloat(r)[1];
  }
  return -1;
}

const found = new Map<string, Rng>();

// A PRNG whose next `n` values pass `ok`. `key` names the condition, for reuse.
function rngWhere(key: string, n: number, ok: (v: number[]) => boolean): Rng {
  const known = found.get(key);
  if (known !== undefined) return known;
  for (let seed = 0; seed < 20_000_000; seed++) {
    const rng = createRng(seed);
    if (ok(values(rng, n))) {
      found.set(key, rng);
      return rng;
    }
  }
  throw new Error(`No PRNG state for ${key}`);
}

// A PRNG whose next values lie in the given ranges [from, to), one range per draw.
function rngIn(...ranges: (readonly [number, number])[]): Rng {
  return rngWhere(JSON.stringify(ranges), ranges.length, (v) =>
    ranges.every(([from, to], i) => v[i] >= from && v[i] < to),
  );
}

const KEEPS = [0, KEEP] as const; // the keep chance succeeds
const LEAVES = [KEEP, 1] as const; // it fails
const RANDOMLY = [0, RANDOM_TURN] as const; // the random-turn chance succeeds
const TOWARD = [RANDOM_TURN, 1] as const; // it fails: the direction to the player
const ANY = [0, 1] as const;
const SURE = [0, 1 / 4096] as const; // below every fire chance 2.4 can give

// --- Games ---------------------------------------------------------------------------------

// An open room whose walls are its top row and left column, as in the WP 09 tests.
const room = createGrid(64, 48, ({ x, y }) =>
  x === 0 || y === 0 ? "wall" : "open",
);

let template: Snipe | undefined;

// A snipe that has just appeared, spawned by a lone hive.
function newSnipe(): Snipe {
  if (template !== undefined) return template;
  const game = createGame(1, "A9");
  let state: GameState = {
    ...game,
    maze: room,
    player: { ...game.player, x: 4, y: 4 },
    hives: [{ ...game.hives[0], x: 40, y: 30, hits: 0 }],
    snipes: [],
    shots: [],
    snipeShots: [],
  };
  for (let t = 0; t < PATIENCE && state.snipes.length === 0; t++) {
    state = step(state, NO_INPUT);
  }
  if (state.snipes.length === 0) throw new Error("No snipe appeared");
  template = state.snipes[0];
  return template;
}

// A snipe at `p` going d, that takes its first step on the next tick.
function snipe(p: Point, d: Dir, turn: Turn = 1): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx: d[0], dy: d[1], turn };
}

function shot(p: Point, [dx, dy]: Dir): Shot {
  return { x: p.x, y: p.y, dx, dy };
}

interface Setup {
  readonly maze: Grid;
  readonly player: Point;
  readonly snipes?: readonly Snipe[];
  readonly hives?: readonly (Point & { readonly hits?: number })[];
  readonly skill?: string;
  readonly rng?: Rng;
  readonly snipeShots?: readonly Shot[];
}

// A game at `skill` (A1 if not given) in `maze` with only what the setup names. Hives are
// copies of a new game's hive.
function arena(setup: Setup): GameState {
  const game = createGame(1, setup.skill ?? "A1");
  const hive = game.hives[0];
  return {
    ...game,
    maze: setup.maze,
    player: { ...game.player, x: setup.player.x, y: setup.player.y },
    hives: (setup.hives ?? []).map((h) => ({
      ...hive,
      x: h.x,
      y: h.y,
      hits: h.hits ?? 0,
    })),
    snipes: setup.snipes ?? [],
    shots: [],
    snipeShots: setup.snipeShots ?? [],
    rng: setup.rng ?? game.rng,
  };
}

function run(state: GameState, ticks: number, input = NO_INPUT): GameState {
  let current = state;
  for (let t = 0; t < ticks; t++) current = step(current, input);
  return current;
}

// A big open field. A snipe in the middle with the player FAR below it heads down when it
// goes toward the player, and at that distance a snipe at letter A never fires (2.4: with
// accuracy 2, s = floor(D / 8) > 10 from D = 88 on).
const field = grid(320, 320);
const S = { x: 150, y: 150 };
const FAR = 150;
const below = { x: S.x, y: S.y + FAR };

// The direction a random draw in bucket b (floor(value * 8) = b) gives a snipe that turns at
// random in the open field, learned from the game: the PRNG makes the keep chance fail, the
// random-turn chance succeed, and the third value fall in bucket b.
function randomDirection(b: number): Dir {
  const state = arena({
    maze: field,
    player: below,
    snipes: [snipe(S, UP_LEFT)],
    rng: rngIn(LEAVES, RANDOMLY, [b / 8, (b + 1) / 8]),
  });
  const after = step(state, NO_INPUT);
  return dirOf(after.snipes[0]);
}

// The bucket whose random direction is d.
function bucketFor(d: Dir): number {
  for (let b = 0; b < 8; b++) if (same(randomDirection(b), d)) return b;
  throw new Error(`No bucket gives ${name(d)}`);
}

function bucketRange(d: Dir): readonly [number, number] {
  const b = bucketFor(d);
  return [b / 8 + 1e-6, (b + 1) / 8 - 1e-6];
}

// ===========================================================================================

describe("4.3 GameState: snipes and their shots", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "a new game has no snipe shots (seed %d)",
    (seed) => {
      expect(createGame(seed).snipeShots).toEqual([]);
      expect(createGame(seed, "Z9").snipeShots).toEqual([]);
    },
  );

  it("gives every snipe one of the 8 directions and a turning sense", () => {
    let state = createGame(3, "A9");
    let seen = 0;
    const problems: string[] = [];
    for (let tick = 0; tick < 20 * 60; tick++) {
      state = step(state, NO_INPUT);
      for (const s of state.snipes) {
        if (
          !CLOCKWISE.some((d) => same(d, dirOf(s))) ||
          (s.turn !== 1 && s.turn !== -1)
        ) {
          problems.push(`tick ${tick}: ${JSON.stringify(s)}`);
        }
        seen++;
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(seen).toBeGreaterThan(0);
  });

  it("keeps snipes and their shots plain data that can be copied", () => {
    const state = run(
      arena({
        maze: field,
        player: { x: S.x + 1, y: S.y - 30 },
        snipes: [snipe(S, UP)],
        rng: rngIn(KEEPS, SURE),
      }),
      1,
    );
    expect(state.snipeShots).toHaveLength(1);
    expect(structuredClone(state)).toEqual(state);
  });

  it("does not change the state it is given while snipes step and fire", () => {
    const state = arena({
      maze: field,
      player: { x: S.x + 1, y: S.y - 30 },
      snipes: [snipe(S, UP), snipe({ x: 40, y: 40 }, DOWN_RIGHT, -1)],
      snipeShots: [shot({ x: 100, y: 100 }, LEFT)],
      rng: rngIn(KEEPS, SURE),
    });
    const before = structuredClone(state);
    const after = step(state, NO_INPUT);
    expect(state).toEqual(before);
    expect(step(before, NO_INPUT)).toEqual(after);
    // Guards: the shot in flight moved on and the first snipe fired.
    expect(after.snipeShots).toHaveLength(2);
    expect(after.snipeShots).toContainEqual(shot({ x: 99, y: 100 }, LEFT));
  });
});

describe("2.4 Snipes: a new snipe draws its direction, then its turning sense", () => {
  // A lone hive in the room spawns; each time, the snipes already on the map are removed
  // first, so the tick's draws are the spawn's alone. Its direction is item floor(v * 8) of a
  // fixed list of the 8 directions and its sense item floor(w * 2) of a fixed list of the
  // two, for two values v and w drawn one after the other. Which of the tick's draws they are
  // depends on the hive's own draws (WP 09), so every candidate pair is tried; one must fit
  // every spawn.
  interface Spawn {
    readonly draws: number[];
    readonly dir: Dir;
    readonly turn: Turn;
    readonly next: GameState;
  }

  let spawns: Spawn[] | undefined;
  function collect(): Spawn[] {
    if (spawns !== undefined) return spawns;
    const result: Spawn[] = [];
    let state = arena({
      maze: room,
      player: { x: 4, y: 4 },
      hives: [{ x: 40, y: 30 }],
      skill: "A9",
    });
    for (let tick = 0; tick < 200 * 200 && result.length < 120; tick++) {
      const before: GameState = { ...state, snipes: [], snipeShots: [] };
      state = step(before, NO_INPUT);
      if (state.snipes.length === 1) {
        const n = drawsUsed(before.rng, state.rng);
        const s = state.snipes[0];
        result.push({
          draws: values(before.rng, n),
          dir: dirOf(s),
          turn: s.turn,
          next: state,
        });
      }
    }
    spawns = result;
    return result;
  }

  it("draws the direction and the sense as two values in a row, the same ones every spawn", () => {
    const all = collect();
    expect(all.length).toBeGreaterThanOrEqual(100);
    const n = all[0].draws.length;
    expect(n).toBeGreaterThanOrEqual(2);
    for (const s of all) expect(s.draws).toHaveLength(n);
    const fits: number[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const dirs = new Map<number, string>();
      const turns = new Map<number, Turn>();
      let ok = true;
      for (const s of all) {
        const b = Math.floor(s.draws[i] * 8);
        const c = Math.floor(s.draws[i + 1] * 2);
        const d = name(s.dir);
        if ((dirs.get(b) ?? d) !== d || (turns.get(c) ?? s.turn) !== s.turn) {
          ok = false;
          break;
        }
        dirs.set(b, d);
        turns.set(c, s.turn);
      }
      // A fixed list: every bucket gives its own direction and sense.
      if (ok && new Set(dirs.values()).size === dirs.size) {
        if (new Set(turns.values()).size === turns.size) fits.push(i);
      }
    }
    expect(
      fits.length,
      "no pair of draws gives the direction and the sense",
    ).toBe(1);
  });

  it("gives new snipes every one of the 8 directions and both senses", () => {
    const all = collect();
    expect(new Set(all.map((s) => name(s.dir))).size).toBe(8);
    expect(new Set(all.map((s) => s.turn))).toEqual(new Set([1, -1]));
  });

  it("takes its first step on the tick after it appears, not on that tick", () => {
    for (const s of collect().slice(0, 20)) {
      const appeared = s.next.snipes[0];
      // The tick it appeared drew nothing for a step: its draws were all the spawn's, the
      // same number every time (above). The next tick it steps, in the open room.
      const after = step({ ...s.next, hives: [] }, NO_INPUT);
      expect(drawsUsed(s.next.rng, after.rng)).toBeGreaterThanOrEqual(1);
      expect(where(after.snipes[0])).not.toEqual(where(appeared));
    }
  });
});

describe("2.4 Snipes: steps (10 ticks after a straight step, 13 after a diagonal one)", () => {
  it.each([1, 2, 3, 4, 5])(
    "in the open field, every step is one cell, on the tick its wait is over (PRNG seed %d)",
    (seed) => {
      let state = arena({
        maze: field,
        player: below,
        snipes: [snipe(S, RIGHT)],
        rng: createRng(seed),
      });
      const steps: { tick: number; dir: Dir }[] = [];
      for (let tick = 1; tick <= 800; tick++) {
        const before = state;
        // Its shots are removed as they appear: in the open field nothing would stop them, and
        // one could come round the edges and hit the snipe.
        state = { ...step(state, NO_INPUT), snipeShots: [] };
        const was = before.snipes[0];
        const now = state.snipes[0];
        const drew = drawsUsed(before.rng, state.rng);
        const moved = now.x !== was.x || now.y !== was.y;
        // It draws only on the ticks it steps, and in the open field every step moves it.
        expect(drew > 0, `tick ${tick}`).toBe(moved);
        if (!moved) {
          expect(dirOf(now), `tick ${tick}`).toEqual(dirOf(was));
          continue;
        }
        // One cell in its new direction.
        expect(where(now), `tick ${tick}`).toEqual(
          plus(field, was, dirOf(now)),
        );
        steps.push({ tick, dir: dirOf(now) });
      }
      expect(steps[0].tick).toBe(1);
      for (let i = 1; i < steps.length; i++) {
        const [dx, dy] = steps[i - 1].dir;
        const wait = dx !== 0 && dy !== 0 ? DIAGONAL_WAIT : STRAIGHT_WAIT;
        expect(steps[i].tick - steps[i - 1].tick, `step ${i}`).toBe(wait);
      }
      // Guards: both kinds of step were seen.
      const diagonal = steps.filter((s) => s.dir[0] !== 0 && s.dir[1] !== 0);
      expect(diagonal.length).toBeGreaterThan(0);
      expect(diagonal.length).toBeLessThan(steps.length);
    },
  );

  it("steps every 10 ticks going straight and every 13 going diagonally, kept on course", () => {
    for (const [d, wait] of [
      [RIGHT, STRAIGHT_WAIT],
      [UP, STRAIGHT_WAIT],
      [DOWN_LEFT, DIAGONAL_WAIT],
      [UP_RIGHT, DIAGONAL_WAIT],
    ] as const) {
      // Every value keeps it on course; the player far away keeps it from firing.
      const rng = rngWhere("keep 5", 5, (v) => v.every((x) => x < KEEP));
      let state = arena({
        maze: field,
        player: { x: S.x + 100, y: S.y - 100 },
        snipes: [snipe(S, d)],
        rng,
      });
      const ticks: number[] = [];
      for (let tick = 1; tick <= 4 * wait + 1; tick++) {
        const before = state.snipes[0];
        state = step(state, NO_INPUT);
        const now = state.snipes[0];
        if (now.x !== before.x || now.y !== before.y) ticks.push(tick);
      }
      expect(ticks, name(d)).toEqual([
        1,
        1 + wait,
        1 + 2 * wait,
        1 + 3 * wait,
        1 + 4 * wait,
      ]);
      expect(where(state.snipes[0])).toEqual(plus(field, S, d, 5));
      expect(drawsUsed(rng, state.rng)).toBe(5);
    }
  });

  it("stuck in a pocket, it stays put, draws again every 10 ticks and does nothing between", () => {
    const p = { x: 50, y: 50 };
    const walls: Point[] = [];
    for (let x = p.x - 1; x <= p.x + SNIPE_W; x++) {
      walls.push({ x, y: p.y - 1 }, { x, y: p.y + SNIPE_H });
    }
    for (let y = p.y; y < p.y + SNIPE_H; y++) {
      walls.push({ x: p.x - 1, y }, { x: p.x + SNIPE_W, y });
    }
    const maze = grid(200, 200, walls);
    let state = arena({
      maze,
      player: { x: 150, y: 150 },
      snipes: [snipe(p, RIGHT)],
      rng: createRng(9),
    });
    const drawTicks: number[] = [];
    for (let tick = 1; tick <= 61; tick++) {
      const before = state;
      state = step(state, NO_INPUT);
      expect(where(state.snipes[0])).toEqual(p);
      if (drawsUsed(before.rng, state.rng) > 0) drawTicks.push(tick);
    }
    expect(drawTicks).toEqual([1, 11, 21, 31, 41, 51, 61]);
  });
});

describe("2.4 Snipes: the direction to the player, with wrap-around", () => {
  // The keep chance fails and so does the random-turn chance, so the snipe takes the direction
  // to the player; in the open field nothing blocks it, so it steps that way. dx and dy go
  // from the snipe's top-left cell to the player's.
  const cases: [dx: number, dy: number, d: Dir][] = [
    [0, -5, UP],
    [1, -5, UP],
    [-1, -40, UP],
    [0, 5, DOWN],
    [1, 5, DOWN],
    [-1, 40, DOWN],
    [1, 0, DOWN],
    [-1, 0, DOWN],
    [0, 0, DOWN],
    [5, 0, RIGHT],
    [5, 1, RIGHT],
    [60, -1, RIGHT],
    [2, 0, RIGHT],
    [-5, 1, LEFT],
    [-2, -1, LEFT],
    [-60, 0, LEFT],
    [2, 2, DOWN_RIGHT],
    [30, 2, DOWN_RIGHT],
    [-2, -2, UP_LEFT],
    [7, -3, UP_RIGHT],
    [2, -2, UP_RIGHT],
    [-3, 9, DOWN_LEFT],
    [-2, 2, DOWN_LEFT],
    [-40, -70, UP_LEFT],
  ];

  function heading(snipeAt: Point, player: Point): Dir {
    const state = arena({
      maze: field,
      player: at(field, player),
      snipes: [snipe(snipeAt, UP_LEFT)],
      rng: rngIn(LEAVES, TOWARD, ANY),
    });
    const after = step(state, NO_INPUT);
    expect(where(after.snipes[0])).toEqual(
      plus(field, snipeAt, dirOf(after.snipes[0])),
    );
    return dirOf(after.snipes[0]);
  }

  it.each(cases)("the player at dx %d, dy %d: %j", (dx, dy, d) => {
    expect(name(heading(S, { x: S.x + dx, y: S.y + dy }))).toBe(name(d));
  });

  it("measures the shortest way round the edges", () => {
    // 320 cells wide and high: 315 to the right is 5 to the left, and so on.
    expect(name(heading({ x: 2, y: 150 }, { x: 317, y: 150 }))).toBe("left");
    expect(name(heading({ x: 317, y: 150 }, { x: 2, y: 150 }))).toBe("right");
    expect(name(heading({ x: 150, y: 2 }, { x: 150, y: 318 }))).toBe("up");
    expect(name(heading({ x: 150, y: 318 }, { x: 151, y: 3 }))).toBe("down");
    expect(name(heading({ x: 3, y: 4 }, { x: 310, y: 300 }))).toBe("up-left");
  });

  it("counts exactly half the maze as positive", () => {
    // Half of 320 is 160: right or down whichever way round it is measured.
    expect(name(heading({ x: 10, y: 150 }, { x: 170, y: 150 }))).toBe("right");
    expect(name(heading({ x: 170, y: 150 }, { x: 10, y: 150 }))).toBe("right");
    expect(name(heading({ x: 150, y: 10 }, { x: 150, y: 170 }))).toBe("down");
    expect(name(heading({ x: 150, y: 170 }, { x: 150, y: 10 }))).toBe("down");
    expect(name(heading({ x: 10, y: 10 }, { x: 170, y: 170 }))).toBe(
      "down-right",
    );
    expect(name(heading({ x: 170, y: 170 }, { x: 10, y: 10 }))).toBe(
      "down-right",
    );
  });

  it("is measured to where the player is after it moved this tick (4.3 order)", () => {
    // The player is one column right of the snipe, far above: up. Moving right this tick,
    // it is two columns right: up-right.
    const state = arena({
      maze: field,
      player: { x: S.x + 1, y: S.y - 20 },
      snipes: [snipe(S, LEFT)],
      rng: rngIn(LEAVES, TOWARD, ANY),
    });
    const still = step(state, NO_INPUT);
    expect(name(dirOf(still.snipes[0]))).toBe("up");
    const moving = step(state, { ...NO_INPUT, moveX: 1 });
    expect(moving.player.x).toBe(S.x + 2);
    expect(name(dirOf(moving.snipes[0]))).toBe("up-right");
  });
});

describe("2.4 Snipes: keeps its direction, or turns at random or toward the player", () => {
  it.each(CLOCKWISE.map((d) => [name(d), d] as const))(
    "the keep chance succeeds: it steps on %s, drawing once",
    (_name, d) => {
      const rng = rngIn(KEEPS);
      const after = step(
        arena({ maze: field, player: below, snipes: [snipe(S, d)], rng }),
        NO_INPUT,
      );
      expect(where(after.snipes[0])).toEqual(plus(field, S, d));
      expect(dirOf(after.snipes[0])).toEqual(d);
      expect(drawsUsed(rng, after.rng)).toBe(1);
    },
  );

  it("keeps its direction on a value just below 3/4, not on one just above", () => {
    const keep = rngIn([KEEP - 0.01, KEEP], TOWARD);
    const leave = rngIn([KEEP, KEEP + 0.01], TOWARD);
    const kept = step(
      arena({
        maze: field,
        player: below,
        snipes: [snipe(S, RIGHT)],
        rng: keep,
      }),
      NO_INPUT,
    );
    expect(where(kept.snipes[0])).toEqual(plus(field, S, RIGHT));
    expect(drawsUsed(keep, kept.rng)).toBe(1);
    const left = step(
      arena({
        maze: field,
        player: below,
        snipes: [snipe(S, RIGHT)],
        rng: leave,
      }),
      NO_INPUT,
    );
    // It took the direction to the player instead, down, after two draws.
    expect(where(left.snipes[0])).toEqual(plus(field, S, DOWN));
    expect(dirOf(left.snipes[0])).toEqual(DOWN);
    expect(drawsUsed(leave, left.rng)).toBe(2);
  });

  it("the keep chance fails: it takes the direction to the player, drawing twice", () => {
    for (const d of CLOCKWISE) {
      const rng = rngIn(LEAVES, TOWARD);
      const after = step(
        arena({ maze: field, player: below, snipes: [snipe(S, d)], rng }),
        NO_INPUT,
      );
      expect(where(after.snipes[0]), name(d)).toEqual(plus(field, S, DOWN));
      expect(dirOf(after.snipes[0]), name(d)).toEqual(DOWN);
      expect(drawsUsed(rng, after.rng), name(d)).toBe(2);
    }
  });

  it("the random-turn chance succeeds: a random direction from a fixed list of the 8, drawing three times", () => {
    const list = Array.from({ length: 8 }, (_, b) => randomDirection(b));
    // Each bucket gives its own direction: all 8 are in the list once.
    expect(new Set(list.map(name)).size).toBe(8);
    for (let b = 0; b < 8; b++) {
      for (const [from, to] of [
        [b / 8 + 1e-6, b / 8 + 0.01],
        [(b + 1) / 8 - 0.01, (b + 1) / 8 - 1e-6],
      ]) {
        const rng = rngIn(LEAVES, RANDOMLY, [from, to]);
        const after = step(
          arena({ maze: field, player: below, snipes: [snipe(S, LEFT)], rng }),
          NO_INPUT,
        );
        expect(name(dirOf(after.snipes[0])), `bucket ${b}`).toBe(name(list[b]));
        expect(where(after.snipes[0])).toEqual(plus(field, S, list[b]));
        expect(drawsUsed(rng, after.rng)).toBe(3);
      }
    }
  });

  it("turns at random on a value just below 1/4, toward the player on one just above", () => {
    const b = bucketFor(UP);
    const random = rngIn(
      LEAVES,
      [RANDOM_TURN - 0.01, RANDOM_TURN],
      [b / 8, (b + 1) / 8],
    );
    const toward = rngIn(
      LEAVES,
      [RANDOM_TURN, RANDOM_TURN + 0.01],
      [b / 8, (b + 1) / 8],
    );
    const a = step(
      arena({
        maze: field,
        player: below,
        snipes: [snipe(S, LEFT)],
        rng: random,
      }),
      NO_INPUT,
    );
    expect(dirOf(a.snipes[0])).toEqual(UP);
    expect(drawsUsed(random, a.rng)).toBe(3);
    const t = step(
      arena({
        maze: field,
        player: below,
        snipes: [snipe(S, LEFT)],
        rng: toward,
      }),
      NO_INPUT,
    );
    expect(dirOf(t.snipes[0])).toEqual(DOWN);
    expect(drawsUsed(toward, t.rng)).toBe(2);
  });

  it("the keep chance succeeds but its way is blocked: it draws the random-turn chance next", () => {
    // A wall cell just right of the snipe's lower row blocks right (and the diagonals beside
    // it); the player is far below.
    const maze = grid(320, 320, [{ x: S.x + SNIPE_W, y: S.y + 1 }]);
    const toward = rngIn(KEEPS, TOWARD);
    const a = step(
      arena({ maze, player: below, snipes: [snipe(S, RIGHT)], rng: toward }),
      NO_INPUT,
    );
    expect(where(a.snipes[0])).toEqual(plus(maze, S, DOWN));
    expect(dirOf(a.snipes[0])).toEqual(DOWN);
    expect(drawsUsed(toward, a.rng)).toBe(2);

    const random = rngIn(KEEPS, RANDOMLY, bucketRange(UP_LEFT));
    const r = step(
      arena({ maze, player: below, snipes: [snipe(S, RIGHT)], rng: random }),
      NO_INPUT,
    );
    expect(where(r.snipes[0])).toEqual(plus(maze, S, UP_LEFT));
    expect(dirOf(r.snipes[0])).toEqual(UP_LEFT);
    expect(drawsUsed(random, r.rng)).toBe(3);
  });

  it("when the keep chance fails it may still go its old way, if that is the one chosen", () => {
    const rng = rngIn(LEAVES, TOWARD);
    const after = step(
      arena({ maze: field, player: below, snipes: [snipe(S, DOWN)], rng }),
      NO_INPUT,
    );
    expect(where(after.snipes[0])).toEqual(plus(field, S, DOWN));
    expect(drawsUsed(rng, after.rng)).toBe(2);
  });
});

describe("2.4 Snipes: blocked, it turns one-eighth of a turn at a time in its own sense", () => {
  // A wall of two cells just right of the snipe blocks right and both diagonals beside it.
  // The player is far right, so the direction to it is right.
  const p = { x: 100, y: 100 };
  const walls = [
    { x: p.x + SNIPE_W, y: p.y },
    { x: p.x + SNIPE_W, y: p.y + 1 },
  ];
  const maze = grid(320, 320, walls);
  const far = { x: p.x + FAR, y: p.y };

  it.each([
    [1, DOWN],
    [-1, UP],
  ] as const)(
    "sense %d: right and its next diagonal are blocked, so it goes %j",
    (turn, d) => {
      const rng = rngIn(LEAVES, TOWARD);
      const after = step(
        arena({ maze, player: far, snipes: [snipe(p, UP_LEFT, turn)], rng }),
        NO_INPUT,
      );
      expect(where(after.snipes[0])).toEqual(plus(maze, p, d));
      expect(dirOf(after.snipes[0])).toEqual(d);
      expect(after.snipes[0].turn).toBe(turn);
      expect(drawsUsed(rng, after.rng)).toBe(2);
    },
  );

  it("starts turning from a random direction when that one is blocked", () => {
    // Random right is blocked; clockwise, down-right is too; then down.
    const rng = rngIn(LEAVES, RANDOMLY, bucketRange(RIGHT));
    const after = step(
      arena({
        maze,
        player: { x: p.x - FAR, y: p.y },
        snipes: [snipe(p, UP_LEFT, 1)],
        rng,
      }),
      NO_INPUT,
    );
    expect(dirOf(after.snipes[0])).toEqual(DOWN);
    expect(where(after.snipes[0])).toEqual(plus(maze, p, DOWN));
    expect(drawsUsed(rng, after.rng)).toBe(3);
  });

  it("keeps turning past blocked directions: in a corridor with one way out it finds it", () => {
    // Walls all round the snipe except a 2-row corridor going left: only left is open, the
    // fifth direction tried either way round from right.
    const q = { x: 100, y: 100 };
    const w: Point[] = [];
    for (let x = q.x - 30; x <= q.x + SNIPE_W; x++) {
      w.push({ x, y: q.y - 1 }, { x, y: q.y + SNIPE_H });
    }
    w.push({ x: q.x + SNIPE_W, y: q.y }, { x: q.x + SNIPE_W, y: q.y + 1 });
    const corridor = grid(320, 320, w);
    for (const turn of [1, -1] as const) {
      const rng = rngIn(LEAVES, TOWARD);
      const after = step(
        arena({
          maze: corridor,
          player: { x: q.x + FAR, y: q.y },
          snipes: [snipe(q, UP, turn)],
          rng,
        }),
        NO_INPUT,
      );
      expect(dirOf(after.snipes[0]), `sense ${turn}`).toEqual(LEFT);
      expect(where(after.snipes[0])).toEqual(plus(corridor, q, LEFT));
    }
  });

  it.each([1, -1] as const)(
    "sense %d: with all 8 blocked it stays put and keeps the last direction tried",
    (turn) => {
      const w: Point[] = [];
      for (let x = p.x - 1; x <= p.x + SNIPE_W; x++) {
        w.push({ x, y: p.y - 1 }, { x, y: p.y + SNIPE_H });
      }
      for (let y = p.y; y < p.y + SNIPE_H; y++) {
        w.push({ x: p.x - 1, y }, { x: p.x + SNIPE_W, y });
      }
      const pocket = grid(320, 320, w);
      for (const rng of [rngIn(LEAVES, TOWARD), rngIn(KEEPS, TOWARD)]) {
        let state = step(
          arena({
            maze: pocket,
            player: far,
            snipes: [snipe(p, UP_LEFT, turn)],
            rng,
          }),
          NO_INPUT,
        );
        expect(where(state.snipes[0])).toEqual(p);
        // Tried right first, then seven more, one-eighth of a turn each.
        expect(name(dirOf(state.snipes[0]))).toBe(
          name(rotate(RIGHT, 7 * turn)),
        );
        expect(drawsUsed(rng, state.rng)).toBe(2);
        // It waits as after a straight step.
        const drew = state.rng;
        state = run(state, STRAIGHT_WAIT - 1);
        expect(state.rng).toEqual(drew);
        state = step(state, NO_INPUT);
        expect(drawsUsed(drew, state.rng)).toBeGreaterThan(0);
      }
    },
  );
});

describe("2.4 Snipes / 2.1 Maze: no diagonal step through a corner gap", () => {
  // Wall cells just right of the snipe's top row and just below its left column: the
  // down-right position is open, but both straight positions on the way are blocked.
  const p = { x: 100, y: 100 };
  const gap = [
    { x: p.x + SNIPE_W, y: p.y },
    { x: p.x, y: p.y + SNIPE_H },
  ];
  const far = { x: p.x + FAR, y: p.y + FAR - 20 };

  it("does not keep a diagonal through the gap", () => {
    const maze = grid(320, 320, gap);
    for (const [turn, d] of [
      [1, LEFT],
      [-1, UP],
    ] as const) {
      const rng = rngIn(KEEPS, TOWARD);
      const after = step(
        arena({ maze, player: far, snipes: [snipe(p, DOWN_RIGHT, turn)], rng }),
        NO_INPUT,
      );
      // Down-right through the gap is blocked, and so is the next try either way; the
      // first open one is left clockwise and up anticlockwise.
      expect(name(dirOf(after.snipes[0])), `sense ${turn}`).toBe(name(d));
      expect(where(after.snipes[0])).toEqual(plus(maze, p, d));
    }
  });

  it("steps diagonally when one straight position on the way is open", () => {
    for (const wall of gap) {
      const maze = grid(320, 320, [wall]);
      const rng = rngIn(KEEPS);
      const after = step(
        arena({ maze, player: far, snipes: [snipe(p, DOWN_RIGHT)], rng }),
        NO_INPUT,
      );
      expect(where(after.snipes[0])).toEqual(plus(maze, p, DOWN_RIGHT));
      expect(drawsUsed(rng, after.rng)).toBe(1);
    }
  });

  // Spec 2.4 (v0.11): for a snipe, a straight position on the way counts as blocked when it
  // covers a wall or a hive cell. Each hive covers the same gap cell as one of the walls above,
  // and no cell of the down-right position or of the snipe: hiveRight covers the cell just
  // right of the snipe's top row, hiveDown the cell just below its left column.
  const hiveRight = { x: p.x + SNIPE_W, y: p.y - HIVE + 1 };
  const hiveDown = { x: p.x - HIVE + 1, y: p.y + SNIPE_H };
  const [wallRight, wallDown] = gap;

  it.each([
    ["a hive and a wall", [hiveRight], [wallDown]],
    ["a wall and a hive", [hiveDown], [wallRight]],
    ["two hives", [hiveRight, hiveDown], []],
  ] as const)(
    "does not squeeze diagonally between %s",
    (_name, hives, walls) => {
      // The test's own checks: the hives cover the gap cells, not the snipe or its way.
      const down = plus(field, p, DOWN_RIGHT);
      for (const h of hives) {
        expect(overlaps(field, hiveBox(h), snipeBox(p))).toBe(false);
        expect(overlaps(field, hiveBox(h), snipeBox(down))).toBe(false);
      }
      const maze = grid(320, 320, walls);
      for (const [turn, d] of [
        [1, LEFT],
        [-1, UP],
      ] as const) {
        const rng = rngIn(KEEPS, TOWARD);
        const after = step(
          arena({
            maze,
            player: far,
            hives,
            snipes: [snipe(p, DOWN_RIGHT, turn)],
            rng,
          }),
          NO_INPUT,
        );
        // As between two walls: down-right is refused, both on keeping it and as the
        // direction to the player, and so is the next try either way round.
        expect(name(dirOf(after.snipes[0])), `sense ${turn}`).toBe(name(d));
        expect(where(after.snipes[0])).toEqual(plus(maze, p, d));
        expect(drawsUsed(rng, after.rng)).toBe(2);
      }
    },
  );

  it.each([
    ["only the right one is blocked, by a hive", [hiveRight]],
    ["only the lower one is blocked, by a hive", [hiveDown]],
  ] as const)(
    "steps diagonally past a hive when one straight position is open: %s",
    (_name, hives) => {
      const rng = rngIn(KEEPS);
      const after = step(
        arena({
          maze: field,
          player: far,
          hives,
          snipes: [snipe(p, DOWN_RIGHT)],
          rng,
        }),
        NO_INPUT,
      );
      expect(where(after.snipes[0])).toEqual(plus(field, p, DOWN_RIGHT));
      expect(dirOf(after.snipes[0])).toEqual(DOWN_RIGHT);
      expect(drawsUsed(rng, after.rng)).toBe(1);
    },
  );
});

describe("2.4 Snipes: walls and hives block snipes; snipes may overlap each other and the player", () => {
  const h = { x: 120, y: 100 };
  const left = { x: h.x - SNIPE_W, y: h.y };

  it.each([
    [1, DOWN],
    [-1, UP],
  ] as const)(
    "a hive in its way: sense %d turns it %j, off the hive",
    (turn, d) => {
      const rng = rngIn(KEEPS, TOWARD);
      const after = step(
        arena({
          maze: field,
          player: { x: h.x + FAR, y: h.y },
          hives: [h],
          snipes: [snipe(left, RIGHT, turn)],
          rng,
        }),
        NO_INPUT,
      );
      expect(where(after.snipes[0])).toEqual(plus(field, left, d));
      expect(overlaps(field, snipeBox(after.snipes[0]), hiveBox(h))).toBe(
        false,
      );
      expect(drawsUsed(rng, after.rng)).toBe(2);
    },
  );

  it("never covers a hive cell, from any side, in any direction", () => {
    const problems: string[] = [];
    let moved = 0;
    for (const d of CLOCKWISE) {
      // Snipes all round the hive, each touching it, heading d with the PRNG keeping them on
      // course.
      const around: Snipe[] = [];
      for (let x = h.x - SNIPE_W; x <= h.x + HIVE; x++) {
        around.push(
          snipe({ x, y: h.y - SNIPE_H }, d),
          snipe({ x, y: h.y + HIVE }, d),
        );
      }
      for (let y = h.y - SNIPE_H + 1; y < h.y + HIVE; y++) {
        around.push(
          snipe({ x: h.x - SNIPE_W, y }, d),
          snipe({ x: h.x + HIVE, y }, d),
        );
      }
      let state = arena({
        maze: field,
        player: { x: h.x + FAR, y: h.y + FAR },
        hives: [h],
        snipes: around,
        rng: createRng(name(d).length),
      });
      for (let tick = 0; tick < 40; tick++) {
        const before = state;
        state = step(state, NO_INPUT);
        state = { ...state, snipes: state.snipes.slice(0, around.length) };
        if (
          state.snipes.some(
            (s, i) => s.x !== before.snipes[i].x || s.y !== before.snipes[i].y,
          )
        ) {
          moved++;
        }
        for (const s of state.snipes) {
          if (overlaps(field, snipeBox(s), hiveBox(h))) {
            problems.push(`${name(d)}: snipe on the hive at ${s.x},${s.y}`);
          }
        }
      }
      expect(state.snipes).toHaveLength(around.length);
    }
    expect(problems).toEqual([]);
    // Guard: the snipes stepped (on 4 or 5 of the 40 ticks, for each direction).
    expect(moved).toBeGreaterThanOrEqual(8 * 4);
  });

  it("steps onto another snipe and onto the player", () => {
    const other = plus(field, S, RIGHT);
    const rng = rngIn(KEEPS, KEEPS);
    const after = step(
      arena({
        maze: field,
        player: { x: S.x + 2, y: S.y - 1 },
        snipes: [snipe(S, RIGHT), snipe(other, LEFT)],
        rng,
      }),
      NO_INPUT,
    );
    // Both kept their way: the first onto the second's old place and the player, the second
    // onto the first's.
    expect(where(after.snipes[0])).toEqual(other);
    expect(where(after.snipes[1])).toEqual(S);
    expect(after.snipes).toHaveLength(2);
  });

  it("kills the player when it touches it (WP 11)", () => {
    // The snipe is inside the player's footprint, and one step leaves it there.
    const state = arena({
      maze: field,
      player: S,
      snipes: [snipe({ x: S.x, y: S.y + 1 }, RIGHT)],
      rng: createRng(4),
    });
    expect(state.respawn).toBe(0);
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.respawn).toBeGreaterThan(0);
    expect(after.snipes).toHaveLength(1);
  });

  it("goes along a corridor exactly 2 rows high and never into its walls", () => {
    // Rows 10 and 11 are open and wrap round the edges; the player is in rows 25 to 34,
    // walled off from the snipes.
    const maze = createGrid(80, 40, ({ y }) =>
      y === 10 || y === 11 || (y >= 25 && y < 35) ? "open" : "wall",
    );
    let state = arena({
      maze,
      player: { x: 20, y: 30 },
      snipes: [
        snipe({ x: 5, y: 10 }, RIGHT),
        snipe({ x: 60, y: 10 }, LEFT, -1),
      ],
      rng: createRng(12),
    });
    const xs = new Set<number>();
    for (let tick = 0; tick < 3000; tick++) {
      state = step(state, NO_INPUT);
      for (const s of state.snipes) {
        expect(s.y, `tick ${tick}`).toBe(10);
        expect([1, -1]).toContain(s.dx);
        expect(s.dy).toBe(0);
        xs.add(s.x);
      }
    }
    // It moved along the corridor, both ways.
    expect(xs.size).toBeGreaterThan(20);
  });
});

describe("2.4 Snipes: the PRNG draws are fixed in order and number", () => {
  it.each([5, 6, 7, 8])(
    "draws nothing on a tick no snipe steps (PRNG seed %d)",
    (seed) => {
      let state = run(
        arena({
          maze: field,
          player: below,
          snipes: [snipe(S, RIGHT)],
          rng: createRng(seed),
        }),
        1,
      );
      const [dx, dy] = dirOf(state.snipes[0]);
      const next = 1 + (dx !== 0 && dy !== 0 ? DIAGONAL_WAIT : STRAIGHT_WAIT);
      for (let tick = 2; tick <= next; tick++) {
        const before = state;
        state = step(state, NO_INPUT);
        expect(drawsUsed(before.rng, state.rng) > 0, `tick ${tick}`).toBe(
          tick === next,
        );
      }
    },
  );

  it("draws nothing with no snipes, also while the player moves and fires", () => {
    let state = arena({ maze: field, player: S, rng: createRng(5) });
    const rng = state.rng;
    for (let tick = 0; tick < 100; tick++) {
      state = step(state, { ...NO_INPUT, moveX: 1, fireY: 1 });
    }
    expect(state.rng).toEqual(rng);
    expect(state.shots.length).toBeGreaterThan(0);
  });

  it("steps the snipes in the order they appeared", () => {
    // The first value keeps a snipe on course; the next two send one toward the player.
    const a = snipe(S, RIGHT);
    const b = snipe({ x: S.x - 60, y: S.y }, LEFT);
    const rng = rngIn(KEEPS, LEAVES, TOWARD);
    const after = step(
      arena({ maze: field, player: below, snipes: [a, b], rng }),
      NO_INPUT,
    );
    // The first snipe drew first and kept on; the second turned toward the player, which is
    // down-right of it.
    expect(where(after.snipes[0])).toEqual(plus(field, a, RIGHT));
    expect(where(after.snipes[1])).toEqual(plus(field, b, DOWN_RIGHT));
    expect(drawsUsed(rng, after.rng)).toBe(3);

    // The other way round, the other one keeps on.
    const swapped = step(
      arena({ maze: field, player: below, snipes: [b, a], rng }),
      NO_INPUT,
    );
    expect(where(swapped.snipes[0])).toEqual(plus(field, b, LEFT));
    expect(where(swapped.snipes[1])).toEqual(plus(field, a, DOWN));
  });

  it("keeps the order of the snipes left when one is killed", () => {
    const a = snipe({ x: 40, y: 40 }, RIGHT);
    const b = snipe({ x: 100, y: 40 }, RIGHT);
    const c = snipe({ x: 160, y: 40 }, RIGHT);
    // A snipe's shot about to enter b.
    const state = arena({
      maze: field,
      player: below,
      snipes: [a, b, c],
      snipeShots: [shot({ x: b.x - SHOT, y: b.y }, RIGHT)],
      rng: rngIn(KEEPS, KEEPS),
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes.map(where)).toEqual([
      plus(field, a, RIGHT),
      plus(field, c, RIGHT),
    ]);
    expect(after.snipeShots).toEqual([]);
  });
});

describe("2.4 Snipes / 2.6 Skill level: fire only along its direction at an aligned player", () => {
  // The snipe keeps going right (first value); the second value is the fire chance's. The
  // player is d cells right of where the snipe ends up, on its row unless said otherwise.
  const lane = grid(1600, 8);
  const from = { x: 100, y: 2 };
  const moved = { x: 101, y: 2 };

  function fire(
    rng: Rng,
    player: Point,
    skill = "A1",
    maze: Grid = lane,
    start = from,
    d: Dir = RIGHT,
  ): GameState {
    return step(
      arena({
        maze,
        player: at(maze, player),
        snipes: [snipe(start, d)],
        skill,
        rng,
      }),
      NO_INPUT,
    );
  }

  it("fires right at a player on its row, from just outside its footprint", () => {
    const rng = rngIn(KEEPS, SURE);
    const after = fire(rng, { x: moved.x + 20, y: moved.y });
    expect(after.snipeShots).toEqual([shot(shotStart(moved, RIGHT), RIGHT)]);
    expect(drawsUsed(rng, after.rng)).toBe(2);
  });

  it.each([
    [1, true],
    [-1, true],
    [2, false],
    [-2, false],
    [3, false],
  ])("the player %d rows off: aligned %s", (dy, aligned) => {
    const rng = rngIn(KEEPS, SURE);
    const after = fire(rng, { x: moved.x + 20, y: moved.y + dy });
    expect(after.snipeShots).toHaveLength(aligned ? 1 : 0);
    expect(drawsUsed(rng, after.rng)).toBe(aligned ? 2 : 1);
  });

  it("does not fire at a player behind it", () => {
    const rng = rngIn(KEEPS, SURE);
    const after = fire(rng, { x: moved.x - 20, y: moved.y });
    expect(after.snipeShots).toEqual([]);
    expect(drawsUsed(rng, after.rng)).toBe(1);
  });

  it.each([
    [UP, 1, -30, true],
    [UP, -1, -30, true],
    [UP, 2, -30, false],
    [DOWN, 0, 30, true],
    [DOWN, 0, -30, false],
    [LEFT, -30, 1, true],
    [LEFT, -30, -2, false],
    [DOWN_RIGHT, 10, 7, true],
    [DOWN_RIGHT, 7, 10, true],
    [DOWN_RIGHT, 2, 2, true],
    [DOWN_RIGHT, 10, 6, false],
    [DOWN_RIGHT, 6, 10, false],
    [DOWN_RIGHT, 20, 2, false],
    [DOWN_RIGHT, -10, -10, false],
    [UP_LEFT, -13, -10, true],
    [UP_LEFT, -14, -10, false],
    [UP_RIGHT, 9, -12, true],
    [DOWN_LEFT, -30, 27, true],
    [DOWN_LEFT, -30, 26, false],
  ] as const)(
    "going %j with the player at dx %d, dy %d: fires %s",
    (d, dx, dy, fires) => {
      // Diagonally, the snipe fires only if |(|dx| - |dy|)| < 4.
      const rng = rngIn(KEEPS, SURE);
      const end = plus(field, S, d);
      const after = fire(
        rng,
        { x: end.x + dx, y: end.y + dy },
        "A1",
        field,
        S,
        d,
      );
      expect(where(after.snipes[0])).toEqual(end);
      if (fires) {
        expect(after.snipeShots).toEqual([
          shot(at(field, shotStart(end, d)), d),
        ]);
      } else {
        expect(after.snipeShots).toEqual([]);
      }
      expect(drawsUsed(rng, after.rng)).toBe(fires ? 2 : 1);
    },
  );

  it.each(CLOCKWISE.map((d) => [name(d), d] as const))(
    "a shot fired %s appears just outside its footprint (2.10)",
    (_name, d) => {
      const rng = rngIn(KEEPS, SURE);
      const end = plus(field, S, d);
      const after = fire(rng, plus(field, end, d, 30), "A1", field, S, d);
      expect(after.snipeShots).toEqual([shot(at(field, shotStart(end, d)), d)]);
      // Its footprint touches the snipe's but does not share a cell with it.
      const s = after.snipeShots[0];
      expect(
        overlaps(field, { ...s, width: SHOT, height: SHOT }, snipeBox(end)),
      ).toBe(false);
      const grown = {
        x: end.x - 1,
        y: end.y - 1,
        width: SNIPE_W + 2,
        height: SNIPE_H + 2,
      };
      expect(overlaps(field, { ...s, width: SHOT, height: SHOT }, grown)).toBe(
        true,
      );
    },
  );

  it("fires after a step in which it stayed put, measured from where it is", () => {
    // Shut in a 4 x 2 pocket with a 2-wide chimney above its middle columns: no way out for
    // its footprint, but room for a shot fired up. A random turn starting up-right goes all
    // the way round clockwise and ends on up, the direction to the player straight above.
    const p = { x: 100, y: 100 };
    const w: Point[] = [];
    for (let x = p.x - 1; x <= p.x + SNIPE_W; x++) {
      if (x !== p.x + 1 && x !== p.x + 2) w.push({ x, y: p.y - 1 });
      w.push({ x, y: p.y + SNIPE_H });
    }
    for (let y = p.y; y < p.y + SNIPE_H; y++) {
      w.push({ x: p.x - 1, y }, { x: p.x + SNIPE_W, y });
    }
    const pocket = grid(320, 320, w);
    const rng = rngIn(LEAVES, RANDOMLY, bucketRange(UP_RIGHT), SURE);
    const after = step(
      arena({
        maze: pocket,
        player: { x: p.x, y: p.y - 20 },
        snipes: [snipe(p, LEFT, 1)],
        rng,
      }),
      NO_INPUT,
    );
    expect(where(after.snipes[0])).toEqual(p);
    expect(dirOf(after.snipes[0])).toEqual(UP);
    expect(after.snipeShots).toEqual([shot(shotStart(p, UP), UP)]);
    expect(drawsUsed(rng, after.rng)).toBe(4);
  });

  it("fires through walls between it and the player; the wall stops the shot", () => {
    const wall: Point[] = [];
    for (let y = 0; y < 8; y++) wall.push({ x: moved.x + 30, y });
    const maze = grid(1600, 8, wall);
    const rng = rngIn(KEEPS, SURE);
    let state = fire(rng, { x: moved.x + 60, y: moved.y }, "A1", maze);
    expect(state.snipeShots).toEqual([shot(shotStart(moved, RIGHT), RIGHT)]);
    expect(drawsUsed(rng, state.rng)).toBe(2);
    state = { ...state, snipes: [] };
    const xs: number[] = [];
    for (let tick = 0; tick < 40 && state.snipeShots.length > 0; tick++) {
      state = step(state, NO_INPUT);
      xs.push(...state.snipeShots.map((s) => s.x));
    }
    expect(state.snipeShots).toEqual([]);
    // The last place it reached is just left of the wall.
    expect(Math.max(...xs)).toBe(moved.x + 30 - SHOT);
  });

  it("puts no shot where its start would cover a wall, but the fire chance is drawn", () => {
    const start = shotStart(moved, RIGHT);
    const maze = grid(1600, 8, [{ x: start.x + 1, y: start.y + 1 }]);
    const rng = rngIn(KEEPS, SURE);
    const after = fire(rng, { x: moved.x + 20, y: moved.y }, "A1", maze);
    expect(where(after.snipes[0])).toEqual(moved);
    expect(after.snipeShots).toEqual([]);
    expect(drawsUsed(rng, after.rng)).toBe(2);
  });

  it.each(Array.from({ length: 11 }, (_, s) => s))(
    "s = %d at letter A: fires on a value just below 1 / 2^(s + 1), not just above",
    (s) => {
      // Accuracy 2: s = floor(D / 8).
      const player = { x: moved.x + 8 * s + 4, y: moved.y };
      const p = 1 / 2 ** (s + 1);
      const below = rngIn(KEEPS, [p * 0.95, p]);
      const above = rngIn(KEEPS, [p, p * 1.05]);
      const yes = fire(below, player);
      expect(yes.snipeShots).toHaveLength(1);
      expect(drawsUsed(below, yes.rng)).toBe(2);
      const no = fire(above, player);
      expect(no.snipeShots).toEqual([]);
      expect(drawsUsed(above, no.rng)).toBe(2);
    },
  );

  it.each(LETTERS)(
    "letter %s: fires from s = 10, never when s > 10, with its accuracy",
    (letter) => {
      // s = floor(D / 2^(accuracy + 1)); the last D with s = 10 and the first with s = 11.
      const unit = 2 ** (ACCURACY[letter] + 1);
      const last = 11 * unit - 1;
      const rng = rngIn(KEEPS, SURE);
      const near = fire(rng, { x: moved.x + last, y: moved.y }, `${letter}1`);
      expect(near.snipeShots, `D = ${last}`).toHaveLength(1);
      expect(drawsUsed(rng, near.rng)).toBe(2);
      const far = fire(
        rng,
        { x: moved.x + last + 1, y: moved.y },
        `${letter}1`,
      );
      expect(far.snipeShots, `D = ${last + 1}`).toEqual([]);
      expect(drawsUsed(rng, far.rng)).toBe(1);
      // Counted with |dy| as well: one row off is one more.
      const off = fire(
        rng,
        { x: moved.x + last, y: moved.y + 1 },
        `${letter}1`,
      );
      expect(off.snipeShots, `D = ${last} + 1`).toEqual([]);
      expect(drawsUsed(rng, off.rng)).toBe(1);
    },
  );

  it("does not depend on the digit", () => {
    for (const digit of [1, 5, 9]) {
      const rng = rngIn(KEEPS, SURE);
      const after = fire(rng, { x: moved.x + 87, y: moved.y }, `A${digit}`);
      expect(after.snipeShots, `A${digit}`).toHaveLength(1);
      const far = fire(rng, { x: moved.x + 88, y: moved.y }, `A${digit}`);
      expect(far.snipeShots, `A${digit}`).toEqual([]);
    }
  });
});

describe("2.4 Snipes / 2.5 Bullets: a snipe's shot", () => {
  it.each(CLOCKWISE.map((d) => [name(d), d] as const))(
    "fired %s, it first moves on the next tick, one cell per tick",
    (_name, d) => {
      const rng = rngIn(KEEPS, SURE);
      const end = plus(field, S, d);
      let state = step(
        arena({
          maze: field,
          player: plus(field, end, d, 30),
          snipes: [snipe(S, d)],
          rng,
        }),
        NO_INPUT,
      );
      const start = at(field, shotStart(end, d));
      expect(where(state.snipeShots[0])).toEqual(start);
      // Alone from now on.
      state = { ...state, snipes: [] };
      for (let k = 1; k <= 12; k++) {
        state = step(state, NO_INPUT);
        expect(state.snipeShots, `tick ${k}`).toEqual([
          shot(plus(field, start, d, k), d),
        ]);
      }
    },
  );

  it.each(["A1", "G1", "Z9"])(
    "stops at the first wall and never bounces, at %s",
    (skill) => {
      // A room 40 x 40 whose walls are its top row and left column. Every shot hits a wall.
      const box = createGrid(40, 40, ({ x, y }) =>
        x === 0 || y === 0 ? "wall" : "open",
      );
      for (const d of CLOCKWISE) {
        // The player is off every line the shot can take.
        let state = arena({
          maze: box,
          player: { x: 30, y: 20 },
          skill,
          snipeShots: [shot({ x: 15, y: 13 }, d)],
        });
        const path: Point[] = [{ x: 15, y: 13 }];
        for (let tick = 0; tick < 80 && state.snipeShots.length > 0; tick++) {
          state = step(state, NO_INPUT);
          for (const s of state.snipeShots) {
            expect(dirOf(s), `${skill} ${name(d)}`).toEqual(d);
            path.push(where(s));
          }
        }
        expect(state.snipeShots, `${skill} ${name(d)}`).toEqual([]);
        // Every move went one cell along d, never back.
        for (let i = 1; i < path.length; i++) {
          expect(path[i]).toEqual(plus(box, path[i - 1], d));
        }
        // It stopped next to a wall: one more cell would put it on one.
        const last = path[path.length - 1];
        const next = plus(box, last, d);
        const onWall = cells({ ...next, width: SHOT, height: SHOT }).some(
          (c) => box.cells[mod(c.y, 40) * 40 + mod(c.x, 40)] === "wall",
        );
        expect(onWall, `${skill} ${name(d)}`).toBe(true);
      }
    },
  );

  it("stops at a corner gap", () => {
    // Going down-right from q, the diagonal position is open but both straight positions are
    // blocked, each by one wall cell.
    const q = { x: 20, y: 20 };
    const maze = grid(64, 64, [
      { x: q.x + 4 + SHOT, y: q.y + 4 },
      { x: q.x + 4, y: q.y + 4 + SHOT },
    ]);
    let state = arena({
      maze,
      player: { x: 50, y: 2 },
      skill: "Z1",
      snipeShots: [shot(q, DOWN_RIGHT)],
    });
    const path: Point[] = [];
    for (let tick = 0; tick < 20 && state.snipeShots.length > 0; tick++) {
      state = step(state, NO_INPUT);
      path.push(...state.snipeShots.map(where));
    }
    expect(state.snipeShots).toEqual([]);
    expect(path).toEqual([1, 2, 3, 4].map((k) => plus(maze, q, DOWN_RIGHT, k)));
  });

  it("hits a hive in its way: one more hit, and the shot is gone", () => {
    const h = { x: 60, y: 99 };
    let state = arena({
      maze: field,
      player: { x: 200, y: 250 },
      hives: [h],
      snipeShots: [shot({ x: 40, y: 100 }, RIGHT)],
    });
    for (let tick = 0; tick < 30; tick++) state = step(state, NO_INPUT);
    expect(state.hives).toHaveLength(1);
    expect(state.hives[0]).toMatchObject({ x: h.x, y: h.y, hits: 1 });
    expect(state.snipeShots).toEqual([]);
  });

  it("is hit by a shot that enters one cell of its footprint", () => {
    // The shot covers rows 100 and 101; a hive whose bottom row is 100 is hit, one whose
    // bottom row is 99 is passed.
    for (const [y, hit] of [
      [97, true],
      [96, false],
      [101, true],
      [102, false],
    ] as const) {
      let state = arena({
        maze: field,
        player: { x: 200, y: 250 },
        hives: [{ x: 60, y }],
        snipeShots: [shot({ x: 40, y: 100 }, RIGHT)],
      });
      for (let tick = 0; tick < 30; tick++) state = step(state, NO_INPUT);
      expect(state.hives[0].hits, `hive at row ${y}`).toBe(hit ? 1 : 0);
      expect(state.snipeShots.length, `hive at row ${y}`).toBe(hit ? 0 : 1);
    }
  });

  it("destroys a hive with its 20th hit", () => {
    const h = { x: 60, y: 99 };
    let state = arena({
      maze: field,
      player: { x: 200, y: 250 },
      hives: [{ ...h, hits: HITS - 1 }],
      snipeShots: [shot({ x: 40, y: 100 }, RIGHT)],
    });
    for (let tick = 0; tick < 30; tick++) state = step(state, NO_INPUT);
    expect(state.hives).toEqual([]);
    expect(state.snipeShots).toEqual([]);
  });

  it("from a snipe firing at the player, hits a hive between them", () => {
    const h = { x: 120, y: 1 };
    const lane = grid(400, 8);
    const rng = rngIn(KEEPS, SURE);
    let state = step(
      arena({
        maze: lane,
        player: { x: 140, y: 2 },
        hives: [h],
        snipes: [snipe({ x: 100, y: 2 }, RIGHT)],
        rng,
      }),
      NO_INPUT,
    );
    expect(state.snipeShots).toHaveLength(1);
    state = { ...state, snipes: [] };
    for (let tick = 0; tick < 30; tick++) state = step(state, NO_INPUT);
    expect(state.hives[0].hits).toBe(1);
    expect(state.snipeShots).toEqual([]);
  });

  it("kills a snipe in its way, and the shot is gone", () => {
    // The snipe keeps going right, away from the shot, which catches it up.
    const victim = snipe({ x: 60, y: 100 }, RIGHT);
    let state = arena({
      maze: field,
      player: below,
      snipes: [victim],
      snipeShots: [shot({ x: 40, y: 100 }, RIGHT)],
      rng: rngWhere("keep 3", 3, (v) => v.every((x) => x < KEEP)),
    });
    for (let tick = 0; tick < 25; tick++) state = step(state, NO_INPUT);
    expect(state.snipes).toEqual([]);
    expect(state.snipeShots).toEqual([]);
  });

  it("from a snipe firing at the player, kills another snipe between them", () => {
    const lane = grid(400, 8);
    // The first snipe keeps on and fires; the second keeps going left, twice.
    const rng = rngWhere(
      "keep fire keep keep",
      4,
      (v) => v[0] < KEEP && v[1] < SURE[1] && v[2] < KEEP && v[3] < KEEP,
    );
    let state = step(
      arena({
        maze: lane,
        player: { x: 160, y: 2 },
        snipes: [snipe({ x: 100, y: 2 }, RIGHT), snipe({ x: 120, y: 3 }, LEFT)],
        rng,
      }),
      NO_INPUT,
    );
    // The first fired; the second kept going left, toward the shot.
    expect(state.snipeShots).toHaveLength(1);
    expect(where(state.snipes[1])).toEqual({ x: 119, y: 3 });
    state = { ...state, snipes: [state.snipes[1]] };
    for (let tick = 0; tick < 20; tick++) state = step(state, NO_INPUT);
    expect(state.snipes).toEqual([]);
    expect(state.snipeShots).toEqual([]);
  });

  it("disappears when it reaches the player, and kills it (WP 11)", () => {
    const player = { x: 70, y: 99 };
    let state = arena({
      maze: field,
      player,
      snipeShots: [shot({ x: 40, y: 100 }, RIGHT)],
    });
    const lives = state.lives;
    let gone = -1;
    for (let tick = 1; tick <= 29; tick++) {
      state = step(state, NO_INPUT);
      if (gone < 0 && state.snipeShots.length === 0) gone = tick;
      if (tick < 29) {
        expect(state.lives, `tick ${tick}`).toBe(lives);
        expect(state.respawn, `tick ${tick}`).toBe(0);
      }
      for (const s of state.snipeShots) {
        expect(
          overlaps(
            field,
            { ...s, width: SHOT, height: SHOT },
            { ...player, width: PLAYER, height: PLAYER },
          ),
          `tick ${tick}`,
        ).toBe(false);
      }
    }
    // It entered the player's footprint on its 29th move, from x 40 to 69, and killed it.
    expect(gone).toBe(29);
    expect(state.lives).toBe(lives - 1);
    expect(state.respawn).toBeGreaterThan(0);
  });

  it("is not stopped by the player's shots, nor stops them", () => {
    // A player's shot and a snipe's shot cross; both fly on to the walls.
    const box = createGrid(64, 64, ({ x, y }) =>
      x === 0 || y === 0 ? "wall" : "open",
    );
    // They cover the same cells about 28 ticks after the player fires.
    let state = arena({
      maze: box,
      player: { x: 30, y: 50 },
      snipeShots: [shot({ x: 60, y: 20 }, LEFT)],
    });
    state = step(state, { ...NO_INPUT, fireY: -1 });
    expect(state.shots).toHaveLength(1);
    let both = 0;
    for (let tick = 0; tick < 50; tick++) {
      state = step(state, NO_INPUT);
      if (state.shots.length === 1 && state.snipeShots.length === 1) both++;
    }
    expect(both).toBeGreaterThan(15);
    // The snipe's shot moved one cell a tick all along: 51 cells by now.
    expect(state.snipeShots).toEqual([shot({ x: 60 - 51, y: 20 }, LEFT)]);
  });
});

describe("2.4 Snipes / 2.5 Bullets: one shot from the player kills a snipe", () => {
  // The player fires right once. Its shot covers rows 101 and 102. The snipes keep going right,
  // away from it, on the rows they start on.
  const player = { x: 50, y: 100 };
  const keep = rngWhere("keep 6", 6, (v) => v.every((x) => x < KEEP));

  function shootAt(snipes: Snipe[]): { state: GameState; passed: boolean } {
    let state = arena({ maze: field, player, snipes, rng: keep });
    let passed = false;
    for (let tick = 0; tick < 40; tick++) {
      state = step(state, tick === 0 ? { ...NO_INPUT, fireX: 1 } : NO_INPUT);
      if (state.shots.some((s) => s.x > 80)) passed = true;
    }
    return { state, passed };
  }

  it("kills a snipe whose footprint the shot enters by one row", () => {
    for (const y of [102, 100]) {
      const { state, passed } = shootAt([snipe({ x: 60, y }, RIGHT)]);
      expect(state.snipes, `snipe at row ${y}`).toEqual([]);
      expect(state.shots, `snipe at row ${y}`).toEqual([]);
      expect(passed).toBe(false);
    }
  });

  it("passes a snipe just beside its way", () => {
    for (const y of [103, 99]) {
      const { state, passed } = shootAt([snipe({ x: 60, y }, RIGHT)]);
      expect(state.snipes, `snipe at row ${y}`).toHaveLength(1);
      expect(passed, `snipe at row ${y}`).toBe(true);
      // It kept going right, on ticks 1, 11, 21 and 31.
      expect(where(state.snipes[0])).toEqual({ x: 64, y });
    }
  });

  it("kills only the first snipe in its way", () => {
    const { state } = shootAt([
      snipe({ x: 75, y: 101 }, RIGHT),
      snipe({ x: 60, y: 101 }, RIGHT),
    ]);
    // The one further on is left, after its steps on ticks 1, 11, 21 and 31.
    expect(state.snipes.map(where)).toEqual([{ x: 79, y: 101 }]);
    expect(state.shots).toEqual([]);
  });

  it("kills a snipe on the tick the shot enters it, before the snipe steps (4.3 order)", () => {
    // The shot is two cells left of the snipe, which would step right, out of its way, this
    // tick. Shots move first.
    const s = snipe({ x: 60, y: 101 }, RIGHT);
    const state = arena({ maze: field, player, snipes: [s], rng: keep });
    const shotAt = {
      ...state,
      shots: [shot({ x: s.x - SHOT, y: 101 }, RIGHT)],
    };
    const after = step(shotAt, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.shots).toEqual([]);
  });

  it("does not hurt a snipe out of its way", () => {
    const { state } = shootAt([
      snipe({ x: 60, y: 101 }, RIGHT),
      snipe({ x: 60, y: 120 }, RIGHT),
    ]);
    expect(state.snipes).toHaveLength(1);
    expect(state.snipes[0].y).toBe(120);
  });
});
