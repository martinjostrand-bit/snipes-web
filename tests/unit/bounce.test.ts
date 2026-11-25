import { describe, expect, it } from "vitest";
import { cellAt, createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  type GameState,
  type InputState,
} from "../../src/core/state";
// Spec 2.7 (WP 13): these tests go on after a level is cleared; see play-on.ts.
import { playOn as step } from "../play-on";

// Spec 2.2, 2.4, 2.5, 2.6, 2.10, 4.3 and 9.1 WP 16: bouncing diagonal shots.
//
// - At the letters with bouncing shots (G to L and Q to Z, 2.6) a diagonal shot the player
//   fires draws N, from 1 to 8, with one `nextFloat` from `state.rng` on the tick it is fired.
//   Nothing is drawn for a straight shot, for a snipe's shot, at the other letters, or when no
//   shot is fired. The tests do not assume which value gives which N: they find out, per
//   eighth of the PRNG's range, how often the shot bounces, and check that the eight
//   eighths give each N from 1 to 8 once.
// - The shots in flight stay in `state.shots`, each with its position (`x`, `y`, its top-left
//   cell) and direction (`dx`, `dy`), as in the WP 08 tests. How a shot keeps its bounces left
//   is the implementation's, but it is plain data in the state.
// - A bounce uses the tick's move (2.5): on that tick the shot stays where it is and its
//   direction changes. Only the horizontal straight position blocked: dx reverses; only the
//   vertical one: dy reverses; both (a corner or a corner gap) or neither (the end of a wall):
//   both reverse. With no bounces left it stops at the next wall, or corner gap, like any
//   shot: it disappears on the tick it would move there.
// - A shot that has bounced hits the player in play, who comes last in the order of 2.5, and
//   kills it (2.2): `state.lives` drops by one and `state.respawn` is above 0.
//
// The games have no hives, snipes or ghosts unless a test says so, so nothing else draws from
// the PRNG.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Shot = GameState["shots"][number];

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)
const KEEP = 3 / 4; // a snipe's keep chance (2.4)
const MOST = 8; // 2.5: N is at most 8
const PATIENCE = 10 * 60 * 60; // ten minutes of ticks, the longest a test waits for a spawn

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
// Spec 2.6: the letters with bouncing diagonal shots.
const BOUNCING = [..."GHIJKLQRSTUVWXYZ"];
const NOT_BOUNCING = LETTERS.filter((l) => !BOUNCING.includes(l));

const UP: Dir = [0, -1];
const UP_RIGHT: Dir = [1, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const DOWN_LEFT: Dir = [-1, 1];
const LEFT: Dir = [-1, 0];
const UP_LEFT: Dir = [-1, -1];
const DIAGONALS: [name: string, d: Dir][] = [
  ["up-right", UP_RIGHT],
  ["down-right", DOWN_RIGHT],
  ["down-left", DOWN_LEFT],
  ["up-left", UP_LEFT],
];
const STRAIGHTS: [name: string, d: Dir][] = [
  ["up", UP],
  ["right", RIGHT],
  ["down", DOWN],
  ["left", LEFT],
];
const EIGHT = [...STRAIGHTS, ...DIAGONALS];

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function plus(p: Point, [dx, dy]: Dir, k = 1): Point {
  return { x: p.x + k * dx, y: p.y + k * dy };
}

function wrapped(maze: Grid, p: Point): Point {
  return { x: mod(p.x, maze.width), y: mod(p.y, maze.height) };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

// The direction of a shot, with -0 read as 0.
function dirOf(s: { readonly dx: number; readonly dy: number }): Dir {
  return [(s.dx + 0) as Axis, (s.dy + 0) as Axis];
}

function same(a: Dir, b: Dir): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function opposite([dx, dy]: Dir): Dir {
  return [(0 - dx) as Axis, (0 - dy) as Axis];
}

function fire([fireX, fireY]: Dir, keys: Partial<InputState> = {}): InputState {
  return { ...NO_INPUT, fireX, fireY, ...keys };
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

// Spec 2.10: whether a shot's footprint at p covers no wall, with wrap-around.
function fits(maze: Grid, p: Point): boolean {
  for (let dy = 0; dy < SHOT; dy++) {
    for (let dx = 0; dx < SHOT; dx++) {
      if (cellAt(maze, { x: p.x + dx, y: p.y + dy }) === "wall") return false;
    }
  }
  return true;
}

// Spec 2.10: where a player's shot fired d appears, next to the player at p.
function spawnFor(p: Point, [dx, dy]: Dir): Point {
  return {
    x: dx < 0 ? p.x - SHOT : dx > 0 ? p.x + PLAYER : p.x + 1,
    y: dy < 0 ? p.y - SHOT : dy > 0 ? p.y + PLAYER : p.y + 1,
  };
}

// --- The test's own model of a shot's flight (2.5, 2.10) -----------------------------------

interface Flying {
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
}

// Spec 2.10: whether a shot at p going d may not move on, and which straight positions on
// the way are blocked.
function blockedAt(maze: Grid, p: Point, [dx, dy]: Dir) {
  const across = !fits(maze, { x: p.x + dx, y: p.y });
  const down = !fits(maze, { x: p.x, y: p.y + dy });
  const diagonal = dx !== 0 && dy !== 0;
  const blocked =
    !fits(maze, { x: p.x + dx, y: p.y + dy }) || (diagonal && across && down);
  return { blocked, across, down, diagonal };
}

// Spec 2.5: the direction a diagonal shot at p going d bounces to.
function bounced(maze: Grid, p: Point, d: Dir): Dir {
  const { across, down } = blockedAt(maze, p, d);
  if (across && !down) return [(0 - d[0]) as Axis, d[1]];
  if (down && !across) return [d[0], (0 - d[1]) as Axis];
  return opposite(d);
}

// Where a shot that starts at `start` going d with n bounces is on each tick, from the tick
// it appears to the last tick before it disappears at a wall. Nothing else is in its way.
function model(maze: Grid, start: Point, d: Dir, n: number): Flying[] {
  const path: Flying[] = [{ ...wrapped(maze, start), dir: d }];
  let left = n;
  while (path.length < 5000) {
    const at = path[path.length - 1];
    const { blocked, diagonal } = blockedAt(maze, at, at.dir);
    if (!blocked) {
      path.push({ ...wrapped(maze, plus(at, at.dir)), dir: at.dir });
      continue;
    }
    if (!diagonal || left === 0) return path;
    left--;
    path.push({ x: at.x, y: at.y, dir: bounced(maze, at, at.dir) });
  }
  throw new Error("The test's flight never ends");
}

function bounces(path: readonly Flying[]): number {
  return path.filter((p, i) => i > 0 && !same(p.dir, path[i - 1].dir)).length;
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

// A PRNG whose next values lie in the given ranges [from, to), one range per draw.
function rngIn(...ranges: (readonly [number, number])[]): Rng {
  const key = JSON.stringify(ranges);
  const known = found.get(key);
  if (known !== undefined) return known;
  for (let seed = 0; seed < 20_000_000; seed++) {
    const rng = createRng(seed);
    const v = values(rng, ranges.length);
    if (ranges.every(([from, to], i) => v[i] >= from && v[i] < to)) {
      found.set(key, rng);
      return rng;
    }
  }
  throw new Error(`No PRNG state for ${key}`);
}

// The bottom and the top of the b-th eighth of the PRNG's range.
function low(b: number): readonly [number, number] {
  return [b / 8, b / 8 + 1 / 64];
}

function high(b: number): readonly [number, number] {
  return [(b + 1) / 8 - 1 / 64, (b + 1) / 8];
}

const KEEPS = [0, KEEP] as const; // a snipe's keep chance succeeds (2.4)
const SURE = [0, 1 / 4096] as const; // below every fire chance 2.4 can give

// --- Games ---------------------------------------------------------------------------------

const games = new Map<string, GameState>();

function game(skill: string): GameState {
  let g = games.get(skill);
  if (g === undefined) {
    g = createGame(1, skill);
    games.set(skill, g);
  }
  return g;
}

interface Setup {
  readonly maze: Grid;
  readonly player: Point;
  readonly skill?: string;
  readonly rng?: Rng;
  readonly snipes?: readonly Snipe[];
  readonly respawn?: number;
}

// A game at `skill` (G1, bouncing and no other feature, if not given) in `maze` with the
// player at `player`, in play, and nothing else.
function arena(setup: Setup): GameState {
  const g = game(setup.skill ?? "G1");
  return {
    ...g,
    maze: setup.maze,
    player: { ...g.player, x: setup.player.x, y: setup.player.y },
    hives: [],
    snipes: setup.snipes ?? [],
    ghosts: [],
    shots: [],
    snipeShots: [],
    rng: setup.rng ?? g.rng,
    respawn: setup.respawn ?? 0,
  };
}

interface Watched {
  /** The shot after each tick from the one it was fired on, while it is there. */
  readonly path: Flying[];
  /** The state after each tick, the first being the tick it was fired on. */
  readonly states: GameState[];
  /** The shot was gone before `limit` ticks had passed. */
  readonly ended: boolean;
}

// Holds the fire keys d on the first tick, then nothing (or `keys(tick)` from the second tick
// on), and follows the one shot fired until it is gone or `limit` ticks have passed.
// `change`, if given, may change the state after a tick.
function watch(
  state: GameState,
  d: Dir,
  options: {
    readonly limit?: number;
    readonly keys?: (tick: number) => InputState;
    readonly change?: (s: GameState, tick: number) => GameState;
  } = {},
): Watched {
  const limit = options.limit ?? 400;
  const states: GameState[] = [];
  const path: Flying[] = [];
  let s = state;
  for (let tick = 1; tick <= limit; tick++) {
    s = step(s, tick === 1 ? fire(d) : (options.keys?.(tick) ?? NO_INPUT));
    if (options.change) s = options.change(s, tick);
    states.push(s);
    expect(s.shots.length, `tick ${tick}`).toBeLessThanOrEqual(1);
    if (s.shots.length === 0) {
      expect(tick, "no shot was fired").toBeGreaterThan(1);
      return { path, states, ended: true };
    }
    path.push({ ...where(s.shots[0]), dir: dirOf(s.shots[0]) });
  }
  return { path, states, ended: false };
}

// A corridor 200 cells long, open from row 1 to row 8, with walls on rows 0 and 9: a shot
// fired diagonally along it bounces off its two walls, away from the player at its left end.
const corridor = createGrid(200, 10, ({ y }) =>
  y === 0 || y === 9 ? "wall" : "open",
);
const IN_CORRIDOR = { x: 10, y: 1 };
const CORRIDOR_SHOT = spawnFor(IN_CORRIDOR, DOWN_RIGHT);

let table: number[] | undefined;

// How often a shot bounces for a draw in the bottom of each eighth of the PRNG's range.
function bounceTable(): number[] {
  if (table !== undefined) return table;
  table = range(0, 7).map((b) => {
    const seen = watch(
      arena({ maze: corridor, player: IN_CORRIDOR, rng: rngIn(low(b)) }),
      DOWN_RIGHT,
    );
    return seen.ended ? bounces(seen.path) : -1;
  });
  return table;
}

// A PRNG whose next draw gives a bouncing shot n bounces.
function rngFor(n: number): Rng {
  const b = bounceTable().indexOf(n);
  if (b < 0) throw new Error(`No draw gives ${n} bounces`);
  return rngIn(low(b));
}

// --- Walls that a diagonal shot at q going d meets on its next step ------------------------

// The column and row just beyond the shot's footprint at q in the direction d.
function beyond(q: Point, [dx, dy]: Dir): { cx: number; ry: number } {
  return {
    cx: dx > 0 ? q.x + SHOT : q.x - 1,
    ry: dy > 0 ? q.y + SHOT : q.y - 1,
  };
}

interface Kind {
  readonly name: string;
  /** The wall cells. */
  readonly walls: (q: Point, d: Dir) => Point[];
  /** The direction a shot at q going d bounces to. */
  readonly turned: (d: Dir) => Dir;
}

// A horizontal wall across its way: only the vertical straight position is blocked.
const ROW: Kind = {
  name: "a horizontal wall: only the vertical straight position blocked, dy reverses",
  walls: (q, d) =>
    range(-10, 10).map((i) => ({ x: q.x + i, y: beyond(q, d).ry })),
  turned: ([dx, dy]) => [dx, (0 - dy) as Axis],
};

// A vertical wall across its way: only the horizontal straight position is blocked.
const COLUMN: Kind = {
  name: "a vertical wall: only the horizontal straight position blocked, dx reverses",
  walls: (q, d) =>
    range(-10, 10).map((i) => ({ x: beyond(q, d).cx, y: q.y + i })),
  turned: ([dx, dy]) => [(0 - dx) as Axis, dy],
};

const CORNER: Kind = {
  name: "an inside corner: both straight positions blocked, both reverse",
  walls: (q, d) => [...ROW.walls(q, d), ...COLUMN.walls(q, d)],
  turned: opposite,
};

// Two wall cells that touch at a corner: the diagonal position is open, both straight
// positions are blocked (2.1, 2.10).
const GAP: Kind = {
  name: "a corner gap: both straight positions blocked, both reverse",
  walls: (q, [dx, dy]) => {
    const { cx, ry } = beyond(q, [dx, dy]);
    return [
      { x: cx, y: dy > 0 ? q.y : q.y + 1 },
      { x: dx > 0 ? q.x : q.x + 1, y: ry },
    ];
  },
  turned: opposite,
};

// A horizontal wall whose end is the diagonal position's far corner: neither straight
// position is blocked.
const WALL_END: Kind = {
  name: "the end of a wall: neither straight position blocked, both reverse",
  walls: (q, [dx, dy]) => {
    const { cx, ry } = beyond(q, [dx, dy]);
    return range(0, 10).map((i) => ({ x: cx + i * dx, y: ry }));
  },
  turned: opposite,
};

const KINDS = [ROW, COLUMN, CORNER, GAP, WALL_END];
const BACK_KINDS = [CORNER, GAP, WALL_END];

// The player in an open field; a shot it fires d reaches Q after K moves, and meets the walls
// of a kind on its next step.
const P = { x: 100, y: 100 };
const K = 8;

function layout(kind: Kind, d: Dir) {
  const start = spawnFor(P, d);
  const q = plus(start, d, K);
  const maze = grid(240, 240, kind.walls(q, d));
  return { start, q, maze };
}

// ===========================================================================================

// Guards on the test's own places: the model agrees with what each layout is meant to be.
describe("2.10 Sizes: the places the bounce tests use", () => {
  it.each(KINDS.map((k) => [k.name, k] as const))("%s", (_, kind) => {
    for (const [name, d] of DIAGONALS) {
      const { start, q, maze } = layout(kind, d);
      const path = model(maze, start, d, 1);
      for (let t = 0; t <= K; t++) {
        expect(path[t], name).toEqual({ ...plus(start, d, t), dir: d });
      }
      expect(path[K + 1], name).toEqual({ ...q, dir: kind.turned(d) });
      const { across, down, blocked } = blockedAt(maze, q, d);
      expect(blocked, name).toBe(true);
      if (kind === ROW) expect([across, down], name).toEqual([false, true]);
      if (kind === COLUMN) expect([across, down], name).toEqual([true, false]);
      if (kind === CORNER || kind === GAP) {
        expect([across, down], name).toEqual([true, true]);
      }
      if (kind === GAP) expect(fits(maze, plus(q, d)), name).toBe(true);
      if (kind === WALL_END) {
        expect([across, down], name).toEqual([false, false]);
      }
      // The player's footprint is open and away from every wall.
      for (let y = P.y - 1; y <= P.y + PLAYER; y++) {
        for (let x = P.x - 1; x <= P.x + PLAYER; x++) {
          expect(cellAt(maze, { x, y }), name).toBe("open");
        }
      }
    }
  });

  it("the corridor's flights end, away from the player", () => {
    for (let n = 0; n <= MOST; n++) {
      const path = model(corridor, CORRIDOR_SHOT, DOWN_RIGHT, n);
      expect(bounces(path)).toBe(n);
      for (const p of path) expect(p.x).toBeGreaterThan(IN_CORRIDOR.x + 3);
      expect(path[path.length - 1].x).toBeLessThan(corridor.width - SHOT);
    }
  });
});

describe("2.5 Bullets: a bouncing shot bounces exactly its drawn N times, then stops", () => {
  it("draws N from 1 to 8: each eighth of the PRNG's range gives a different N", () => {
    const counts: number[] = [];
    for (let b = 0; b < 8; b++) {
      const seen = [low(b), high(b)].map((r) => {
        const watched = watch(
          arena({ maze: corridor, player: IN_CORRIDOR, rng: rngIn(r) }),
          DOWN_RIGHT,
        );
        expect(watched.ended, `eighth ${b}: the shot never stopped`).toBe(true);
        const n = bounces(watched.path);
        expect(n, `eighth ${b}`).toBeGreaterThanOrEqual(1);
        expect(n, `eighth ${b}`).toBeLessThanOrEqual(MOST);
        return n;
      });
      expect(seen[1], `the top and bottom of eighth ${b}`).toBe(seen[0]);
      counts.push(seen[0]);
    }
    expect([...counts].sort((a, b) => a - b)).toEqual(range(1, MOST));
  });

  it("follows its path exactly: N bounces, each on its own tick, then it stops at the next wall", () => {
    for (let b = 0; b < 8; b++) {
      for (const r of [low(b), high(b)]) {
        const watched = watch(
          arena({ maze: corridor, player: IN_CORRIDOR, rng: rngIn(r) }),
          DOWN_RIGHT,
        );
        const n = bounces(watched.path);
        expect(watched.ended).toBe(true);
        expect(watched.path, `eighth ${b}, ${n} bounces`).toEqual(
          model(corridor, CORRIDOR_SHOT, DOWN_RIGHT, n),
        );
      }
    }
  });

  it("draws once, on the tick it is fired, and nothing while it flies and bounces", () => {
    for (let b = 0; b < 8; b++) {
      const start = arena({
        maze: corridor,
        player: IN_CORRIDOR,
        rng: rngIn(low(b)),
      });
      const { states } = watch(start, DOWN_RIGHT);
      expect(drawsUsed(start.rng, states[0].rng)).toBe(1);
      for (const s of states) expect(s.rng).toEqual(states[0].rng);
    }
  });

  it("with no bounces left it stops at the next wall, also at a corner gap", () => {
    // Fired down-right, the shot bounces off a horizontal wall at Q to go up-right, and meets
    // a corner gap at Q2. With N = 1 it stops there; with N = 2 it bounces back the way it
    // came, down-left to Q, and stops at the horizontal wall.
    const d = DOWN_RIGHT;
    const start = spawnFor(P, d);
    const q = plus(start, d, K);
    const up: Dir = [1, -1];
    const q2 = plus(q, up, 6);
    const maze = grid(240, 240, [...ROW.walls(q, d), ...GAP.walls(q2, up)]);
    const once = model(maze, start, d, 1);
    const twice = model(maze, start, d, 2);
    // Guards on the test's own layout.
    expect(once[once.length - 1]).toEqual({ ...q2, dir: up });
    expect(twice[twice.length - 1]).toEqual({ ...q, dir: DOWN_LEFT });
    expect(bounces(twice)).toBe(2);

    for (const [n, expected] of [
      [1, once],
      [2, twice],
    ] as const) {
      const watched = watch(arena({ maze, player: P, rng: rngFor(n) }), d);
      expect(watched.ended, `N = ${n}`).toBe(true);
      expect(watched.path, `N = ${n}`).toEqual(expected);
    }
  });

  it("can bounce 8 times, the most", () => {
    const watched = watch(
      arena({ maze: corridor, player: IN_CORRIDOR, rng: rngFor(MOST) }),
      DOWN_RIGHT,
    );
    expect(watched.ended).toBe(true);
    expect(bounces(watched.path)).toBe(MOST);
  });

  it("keeps its bounces left in the state, as plain data that can be copied", () => {
    for (const n of [1, 5, MOST]) {
      const start = arena({
        maze: corridor,
        player: IN_CORRIDOR,
        rng: rngFor(n),
      });
      const fired = step(start, fire(DOWN_RIGHT));
      // A copy of the state partway through the flight flies on the same.
      let a = fired;
      for (let t = 0; t < 4; t++) a = step(a, NO_INPUT);
      let b = structuredClone(a);
      expect(b).toEqual(a);
      const path: Flying[] = [];
      for (let t = 0; t < 200 && a.shots.length > 0; t++) {
        a = step(a, NO_INPUT);
        b = step(b, NO_INPUT);
        expect(b.shots).toEqual(a.shots);
        path.push(...a.shots.map((s) => ({ ...where(s), dir: dirOf(s) })));
      }
      expect(a.shots).toEqual([]);
      expect(b.shots).toEqual([]);
      const whole = model(corridor, CORRIDOR_SHOT, DOWN_RIGHT, n);
      expect(path).toEqual(whole.slice(5));
    }
  });
});

describe("2.5 Bullets / 2.10 Sizes: how a diagonal shot bounces", () => {
  it.each(KINDS.map((k) => [k.name, k] as const))(
    "at %s, staying put on the tick it bounces",
    (_, kind) => {
      for (const [name, d] of DIAGONALS) {
        const { start, q, maze } = layout(kind, d);
        const begin = arena({ maze, player: P });
        const { states, path } = watch(begin, d, { limit: K + 3 });
        for (let t = 0; t <= K; t++) {
          expect(path[t], `${name}, tick ${t + 1}`).toEqual({
            ...plus(start, d, t),
            dir: d,
          });
        }
        const turned = kind.turned(d);
        expect(path[K + 1], `${name}: the bounce`).toEqual({
          ...q,
          dir: turned,
        });
        expect(path[K + 2], `${name}: after the bounce`).toEqual({
          ...plus(q, turned),
          dir: turned,
        });
        for (const s of states) expect(s.lives).toBe(begin.lives);
      }
    },
  );

  it.each(BOUNCING.map((l) => `${l}1`))(
    "bounces at %s, a letter with bouncing shots",
    (skill) => {
      for (const kind of [ROW, CORNER]) {
        for (const [name, d] of DIAGONALS) {
          const { q, maze } = layout(kind, d);
          const { path } = watch(arena({ maze, player: P, skill }), d, {
            limit: K + 3,
          });
          expect(path[K], `${kind.name}, ${name}`).toEqual({ ...q, dir: d });
          expect(path[K + 1], `${kind.name}, ${name}`).toEqual({
            ...q,
            dir: kind.turned(d),
          });
        }
      }
    },
  );

  it.each(BACK_KINDS.map((k) => [k.name, k] as const))(
    "at %s, it comes back the way it came",
    (_, kind) => {
      for (const [name, d] of DIAGONALS) {
        const { start, q, maze } = layout(kind, d);
        const { path } = watch(arena({ maze, player: P }), d, {
          limit: 2 * K + 3,
        });
        const back = opposite(d);
        expect(path[K + 1], name).toEqual({ ...q, dir: back });
        for (let t = 1; t <= K; t++) {
          expect(path[K + 1 + t], `${name}, ${t} back`).toEqual({
            ...plus(q, back, t),
            dir: back,
          });
        }
        expect(where(path[2 * K + 1]), name).toEqual(start);
      }
    },
  );
});

describe("2.2 Player / 2.5 Bullets: a bounced shot kills the player", () => {
  it.each(BACK_KINDS.map((k) => [k.name, k] as const))(
    "its own shot, back from %s, kills it",
    (_, kind) => {
      for (const [name, d] of DIAGONALS) {
        const { maze } = layout(kind, d);
        const begin = arena({ maze, player: P });
        // The shot is back next to the player after 2K + 2 ticks, and enters its footprint on
        // the next tick. On that tick the player holds a movement key and a fire key.
        const hit = 2 * K + 3;
        const { states } = watch(begin, d, {
          limit: hit + 2,
          keys: (tick) =>
            tick === hit
              ? { ...NO_INPUT, moveX: 1, moveY: 0, fireX: 0, fireY: 1 }
              : NO_INPUT,
        });
        for (let t = 1; t < hit; t++) {
          expect(states[t - 1].lives, `${name}, tick ${t}`).toBe(begin.lives);
          expect(states[t - 1].respawn, `${name}, tick ${t}`).toBe(0);
          expect(states[t - 1].shots, `${name}, tick ${t}`).toHaveLength(1);
        }
        const after = states[hit - 1];
        expect(after.lives, name).toBe(begin.lives - 1);
        expect(after.respawn, name).toBeGreaterThan(0);
        // Out of play at once: it neither moves nor fires on that tick (2.4).
        expect(where(after.player), name).toEqual(P);
        expect(after.shots, name).toEqual([]);
      }
    },
  );

  it.each(BOUNCING.map((l) => `${l}1`))("at %s", (skill) => {
    const d = DOWN_LEFT;
    const { maze } = layout(CORNER, d);
    const begin = arena({ maze, player: P, skill });
    const hit = 2 * K + 3;
    const { states } = watch(begin, d, { limit: hit + 1 });
    expect(states.length, "the shot stopped too early").toBe(hit);
    expect(states[hit - 2].lives).toBe(begin.lives);
    expect(states[hit - 1].lives).toBe(begin.lives - 1);
    expect(states[hit - 1].respawn).toBeGreaterThan(0);
  });

  it("does not hit a player out of play, and flies on through where it is", () => {
    // A room whose walls are its top row and left column. The shot goes down-right into the
    // corner, comes back up-left through the player's place and, with N = 1, stops at the
    // opposite corner. The player is out of play from the tick after it fired.
    const room = createGrid(40, 40, ({ x, y }) =>
      x === 0 || y === 0 ? "wall" : "open",
    );
    const at = { x: 10, y: 10 };
    const start = spawnFor(at, DOWN_RIGHT);
    const expected = model(room, start, DOWN_RIGHT, 1);
    expect(expected[expected.length - 1]).toEqual({ x: 1, y: 1, dir: UP_LEFT });
    const begin = arena({ maze: room, player: at, rng: rngFor(1) });
    const watched = watch(begin, DOWN_RIGHT, {
      change: (s, tick) => (tick === 1 ? { ...s, respawn: 200 } : s),
    });
    expect(watched.ended).toBe(true);
    expect(watched.path).toEqual(expected);
    for (const s of watched.states) expect(s.lives).toBe(begin.lives);
  });
});

describe("2.5 Bullets: only the player's diagonal shots bounce", () => {
  // A room whose walls are its top row and left column; the grid wraps, so they are also its
  // bottom and right walls.
  const room = createGrid(40, 40, ({ x, y }) =>
    x === 0 || y === 0 ? "wall" : "open",
  );
  const at = { x: 18, y: 18 };

  it.each(BOUNCING.map((l) => `${l}1`))(
    "a straight shot stops at the first wall at %s, and draws nothing",
    (skill) => {
      for (const [name, d] of STRAIGHTS) {
        const begin = arena({ maze: room, player: at, skill });
        const watched = watch(begin, d);
        expect(watched.ended, name).toBe(true);
        expect(watched.path, name).toEqual(
          model(room, spawnFor(at, d), d, MOST),
        );
        expect(bounces(watched.path), name).toBe(0);
        for (const s of watched.states) expect(s.rng, name).toEqual(begin.rng);
      }
    },
  );

  it.each(NOT_BOUNCING.map((l) => `${l}1`))(
    "a diagonal shot stops at the first wall at %s, a letter without bouncing",
    (skill) => {
      for (const kind of KINDS) {
        for (const [name, d] of DIAGONALS) {
          const { start, q, maze } = layout(kind, d);
          const begin = arena({ maze, player: P, skill });
          const watched = watch(begin, d, { limit: K + 3 });
          expect(watched.ended, `${kind.name}, ${name}`).toBe(true);
          expect(watched.path, `${kind.name}, ${name}`).toEqual(
            model(maze, start, d, 0),
          );
          expect(watched.path[K], `${kind.name}, ${name}`).toEqual({
            ...q,
            dir: d,
          });
          for (const s of watched.states) expect(s.rng).toEqual(begin.rng);
        }
      }
    },
  );

  it.each(BOUNCING.map((l) => `${l}1`))(
    "a snipe's diagonal shot stops at the first wall at %s, and draws nothing",
    (skill) => {
      // A horizontal wall on row 112 between a snipe going down-right and the player below
      // it. The snipe keeps on to (101, 101), fires down-right at the player and is then
      // taken away. Its shot meets the wall as the player's shot in the ROW layout does.
      const maze = createGrid(320, 320, ({ y }) =>
        y === 112 ? "wall" : "open",
      );
      const rng = rngIn(KEEPS, SURE);
      const begin = arena({
        maze,
        player: { x: 121, y: 121 },
        skill,
        snipes: [snipe({ x: 100, y: 100 }, DOWN_RIGHT)],
        rng,
      });
      let state = step(begin, NO_INPUT);
      expect(state.snipeShots.map(look)).toEqual([
        { x: 105, y: 103, dir: DOWN_RIGHT },
      ]);
      // The keep chance and the fire chance, and no draw for the shot.
      expect(drawsUsed(rng, state.rng)).toBe(2);
      const drawn = state.rng;
      state = { ...state, snipes: [] };
      const path: Flying[] = [look(state.snipeShots[0])];
      for (let tick = 0; tick < 40 && state.snipeShots.length > 0; tick++) {
        state = step(state, NO_INPUT);
        path.push(...state.snipeShots.map(look));
        expect(state.rng).toEqual(drawn);
      }
      expect(state.snipeShots).toEqual([]);
      expect(path).toEqual(model(maze, { x: 105, y: 103 }, DOWN_RIGHT, 0));
      expect(path[path.length - 1]).toEqual({
        x: 112,
        y: 110,
        dir: DOWN_RIGHT,
      });
      expect(state.lives).toBe(begin.lives);
    },
  );
});

describe("2.5 Bullets / 4.3: the bounce draw", () => {
  const field = grid(240, 240);

  it.each(LETTERS.map((l) => `${l}1`))(
    "at %s, one draw for a diagonal shot only when the letter has bouncing",
    (skill) => {
      const bouncing = BOUNCING.includes(skill[0]);
      for (const [name, d] of EIGHT) {
        const begin = arena({ maze: field, player: P, skill });
        const after = step(begin, fire(d));
        expect(after.shots.map(look), name).toEqual([
          { ...spawnFor(P, d), dir: d },
        ]);
        const diagonal = d[0] !== 0 && d[1] !== 0;
        expect(drawsUsed(begin.rng, after.rng), name).toBe(
          bouncing && diagonal ? 1 : 0,
        );
      }
    },
  );

  it("draws nothing when no shot is fired: Space held, reloading, or the start on a wall", () => {
    for (const [name, d] of DIAGONALS) {
      const begin = arena({ maze: field, player: P });
      // Space held.
      const fast = step(begin, fire(d, { fast: true }));
      expect(fast.shots, name).toEqual([]);
      expect(drawsUsed(begin.rng, fast.rng), name).toBe(0);
      // Holding the key on, while the last shot reloads.
      let s = step(begin, fire(d));
      const fired = s.rng;
      for (let t = 0; t < 5; t++) {
        s = step(s, fire(d));
        expect(s.shots, name).toHaveLength(1);
        expect(s.rng, name).toEqual(fired);
      }
      // The start position covers a wall.
      const spot = spawnFor(P, d);
      const walled = arena({ maze: grid(240, 240, [spot]), player: P });
      const blocked = step(walled, fire(d));
      expect(blocked.shots, name).toEqual([]);
      expect(drawsUsed(walled.rng, blocked.rng), name).toBe(0);
    }
  });

  it("draws once for each diagonal shot, as each is fired", () => {
    // Holding a diagonal fire key fires again as soon as the reload is over.
    const begin = arena({ maze: field, player: P });
    let s = begin;
    let draws = 0;
    let shotsFired = 0;
    for (let t = 0; t < 60; t++) {
      const before = s;
      s = step(s, fire(UP_LEFT));
      const fresh = s.shots.filter(
        (x) => x.x === spawnFor(P, UP_LEFT).x && x.y === spawnFor(P, UP_LEFT).y,
      ).length;
      shotsFired += fresh;
      draws += drawsUsed(before.rng, s.rng);
    }
    expect(shotsFired).toBeGreaterThan(2);
    expect(draws).toBe(shotsFired);
  });
});

describe("2.6 Skill level: bouncing changes only the player's diagonal shots", () => {
  // Pairs of letters that differ only in bouncing: the same other features, accuracy and
  // burst chance.
  const PAIRS = [
    ["B", "G"],
    ["C", "H"],
    ["D", "I"],
    ["E", "J"],
    ["F", "K"],
    ["M", "Q"],
    ["N", "R"],
    ["O", "S"],
    ["P", "T"],
  ] as const;
  const room = createGrid(40, 40, ({ x, y }) =>
    x === 0 || y === 0 ? "wall" : "open",
  );

  // What the rules decide in a tick, the shots as positions and directions only.
  function plain(s: GameState) {
    return {
      rng: s.rng,
      player: where(s.player),
      shots: s.shots.map(look),
      snipeShots: s.snipeShots.map(look),
      lives: s.lives,
      respawn: s.respawn,
      score: s.score,
      cleared: s.cleared,
      gameOver: s.gameOver,
    };
  }

  it.each(PAIRS)(
    "%s and %s give the same game while only straight shots are fired",
    (off, on) => {
      for (const [name, d] of STRAIGHTS) {
        let a = arena({
          maze: room,
          player: { x: 18, y: 18 },
          skill: `${off}1`,
        });
        let b = arena({
          maze: room,
          player: { x: 18, y: 18 },
          skill: `${on}1`,
        });
        for (let t = 1; t <= 40; t++) {
          const keys = t <= 20 ? fire(d) : NO_INPUT;
          a = step(a, keys);
          b = step(b, keys);
          expect(plain(b), `${name}, tick ${t}`).toEqual(plain(a));
        }
      }
    },
  );

  it.each(PAIRS)(
    "%s and %s fly a diagonal shot the same way until it meets a wall",
    (off, on) => {
      for (const [name, d] of DIAGONALS) {
        const { maze } = layout(ROW, d);
        const a = watch(arena({ maze, player: P, skill: `${off}1` }), d, {
          limit: K + 1,
        });
        const b = watch(arena({ maze, player: P, skill: `${on}1` }), d, {
          limit: K + 1,
        });
        expect(b.path, name).toEqual(a.path);
        for (let t = 0; t <= K; t++) {
          expect(drawsUsed(a.states[t].rng, b.states[t].rng), name).toBe(1);
          expect({ ...plain(b.states[t]), rng: null }, name).toEqual({
            ...plain(a.states[t]),
            rng: null,
          });
        }
      }
    },
  );
});

// --- Snipes ---------------------------------------------------------------------------------

function look(s: Shot): Flying {
  return { ...where(s), dir: dirOf(s) };
}

let snipeTemplate: Snipe | undefined;

// A snipe that has just appeared, spawned by a lone hive in an open room.
function newSnipe(): Snipe {
  if (snipeTemplate !== undefined) return snipeTemplate;
  const room = createGrid(64, 48, ({ x, y }) =>
    x === 0 || y === 0 ? "wall" : "open",
  );
  const g = createGame(1, "A9");
  let state: GameState = {
    ...g,
    maze: room,
    player: { ...g.player, x: 4, y: 4 },
    hives: [{ ...g.hives[0], x: 40, y: 30, hits: 0 }],
    snipes: [],
    shots: [],
    snipeShots: [],
  };
  for (let t = 0; t < PATIENCE && state.snipes.length === 0; t++) {
    state = step(state, NO_INPUT);
  }
  if (state.snipes.length === 0) throw new Error("No snipe appeared");
  snipeTemplate = state.snipes[0];
  return snipeTemplate;
}

// A snipe at `p` going d, that takes its first step on the next tick.
function snipe(p: Point, d: Dir): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx: d[0], dy: d[1], turn: 1 };
}
