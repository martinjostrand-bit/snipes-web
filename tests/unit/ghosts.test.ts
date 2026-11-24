import { describe, expect, it } from "vitest";
import { createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import { levelBonus } from "../../src/core/score";
import {
  createGame,
  NO_INPUT,
  step as realStep,
  type GameState,
  type InputState,
} from "../../src/core/state";
// Spec 2.7 (WP 13): most of these tests go on after a level is cleared; see play-on.ts. The
// tests of clearing the level use the real `step`.
import { playOn as step } from "../play-on";

// Spec 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.10, 4.3, 6.2 and 9.1 WP 15: ghosts, as the original's
// "small snipes": with ghosts on, a hit on a snipe's spear half leaves a ghost on its face half.
//
// - `state.ghosts` holds the ghosts on the map in the order they appeared, oldest first. Each
//   is a 2 x 2 footprint whose position (`x`, `y`) is its top-left cell (2.10), with its
//   direction (`dx`, `dy`, as for a snipe: each -1, 0 or 1, never both 0, y growing
//   downwards), its turning sense `turn` (1 clockwise on the screen, -1 anticlockwise) and
//   `straight`, whether it is in straight mode (2.4). Anything else a ghost holds is the
//   implementation's: the tests copy it from a ghost that has just appeared, either at once
//   (a "fresh" ghost: its first step is on the 3rd tick from then) or two ticks later (a
//   "ready" ghost: it steps on the next tick, then every 5 ticks). A new game has no ghosts.
// - A snipe's halves are its left and right 2 x 2 cells. Its face half is the right half when
//   it goes down-left, left or up-left, else the left half; the other is its spear half.
// - Every random draw is one `nextFloat` from `state.rng`, in the order 2.4 gives, and nothing
//   else is drawn. A random direction is item floor(v * 8) of the 8 directions clockwise from
//   up (2.4). The tests choose PRNG states whose next values are what a case needs, and count
//   the draws a tick used.
// - The letter's burst chance (2.6): 1/128 for D, E, I, J, O, P, S, T, W; 1/64 for F, K, L, U,
//   V, X, Y; 1/32 for Z. The games here are at D1 (ghosts on and no other feature) unless a test
//   says otherwise; F1 (1/64, also no other feature) where a burst is drawn.
// - `state.lives`, `state.respawn` (0 in play, above 0 while out of play, the player coming
//   back on the tick it is 1) and `state.score` are as in the WP 11 to 13 tests.
//
// Snipes are copies of one that has just appeared, as in the WP 10 tests, so a copy takes its
// first step on the next tick. Hives are copies of a new game's hive whose wait for the next
// spawn (`Hive.wait`, WP 09) never runs out, unless a test gives it one.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Ghost = GameState["ghosts"][number];
type Shot = GameState["shots"][number];
type Turn = Snipe["turn"];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const GHOST = 2; // a ghost's footprint is GHOST x GHOST cells (2.10)
const SNIPE_W = 4; // a snipe's footprint is SNIPE_W x SNIPE_H cells (2.10)
const SNIPE_H = 2;
const HIVE = 4; // a hive's footprint is HIVE x HIVE cells (2.10)
const KEEP = 3 / 4; // a snipe's keep chance (2.4)
const GHOST_POINTS = 10; // 2.7
const SNIPE_POINTS = 10; // 2.7
const FIRST_STEP = 3; // ticks from the tick a ghost appears to its first step (2.4)
const GHOST_TICKS = 5; // ticks from one step of a ghost to the next (2.4)
const PATIENCE = 10 * 60 * 60; // ten minutes of ticks, the longest a test waits for a spawn
const NEVER = Number.MAX_SAFE_INTEGER; // a hive's wait that never runs out
// Spec 2.6: the burst chance of each letter with ghosts.
const BURST: Record<string, number> = {
  ...Object.fromEntries([..."DEIJOPSTW"].map((l) => [l, 1 / 128])),
  ...Object.fromEntries([..."FKLUVXY"].map((l) => [l, 1 / 64])),
  Z: 1 / 32,
};
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const GHOST_LETTERS = Object.keys(BURST).sort();

const UP: Dir = [0, -1];
const UP_RIGHT: Dir = [1, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const DOWN_LEFT: Dir = [-1, 1];
const LEFT: Dir = [-1, 0];
const UP_LEFT: Dir = [-1, -1];
// Spec 2.4: the 8 directions clockwise from up; a random direction is item floor(v * 8).
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
const EIGHT: [string, Dir][] = CLOCKWISE.map((d, i) => [NAMES[i], d]);
// Spec 2.4: the directions whose face half is the snipe's right half.
const FACE_RIGHT: readonly Dir[] = [DOWN_LEFT, LEFT, UP_LEFT];

function same(a: Dir, b: Dir): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function index(d: Dir): number {
  return CLOCKWISE.findIndex((c) => same(c, d));
}

function name(d: Dir): string {
  return NAMES[index(d)];
}

// The direction k eighths of a turn from d: clockwise for k > 0.
function rotate(d: Dir, k: number): Dir {
  return CLOCKWISE[(((index(d) + k) % 8) + 8) % 8];
}

function dirOf(s: { readonly dx: number; readonly dy: number }): Dir {
  return [s.dx as Axis, s.dy as Axis];
}

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

function plus(p: Point, [dx, dy]: Dir, k = 1): Point {
  return { x: p.x + k * dx, y: p.y + k * dy };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
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

// Whether two footprints share a cell, with wrap-around.
function overlaps(maze: Grid, a: Box, b: Box): boolean {
  const keys = new Set(
    cells(a).map((c) => `${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
  return cells(b).some((c) =>
    keys.has(`${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
}

function ghostBox(p: Point): Box {
  return { x: p.x, y: p.y, width: GHOST, height: GHOST };
}

function snipeBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SNIPE_W, height: SNIPE_H };
}

function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
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

// The ring of wall cells around a width x height hole whose top-left cell is p.
function ring(p: Point, width = GHOST, height = GHOST): Point[] {
  const result: Point[] = [];
  for (let y = p.y - 1; y <= p.y + height; y++) {
    for (let x = p.x - 1; x <= p.x + width; x++) {
      const inside =
        x >= p.x && x < p.x + width && y >= p.y && y < p.y + height;
      if (!inside) result.push({ x, y });
    }
  }
  return result;
}

function hold(input: Partial<InputState>): InputState {
  return { ...NO_INPUT, ...input };
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

// The values that draw direction d as a random one of the 8.
function bucket(d: Dir): readonly [number, number] {
  const b = index(d);
  return [b / 8 + 1e-6, (b + 1) / 8 - 1e-6];
}

const ANY = [0, 1] as const;
const TINY = [0, 1 / 4096] as const; // below every burst chance; a random direction of up
const KEEPS = [0, KEEP] as const; // a snipe's keep chance succeeds

// A value just below and just above a chance c.
function below(c: number): readonly [number, number] {
  return [c / 4, c * 0.99];
}

function above(c: number): readonly [number, number] {
  return [c * 1.01, c * 1.5];
}

// --- Games ---------------------------------------------------------------------------------

// An open field, wrapping at its edges.
const field = grid(320, 320);
// Where ghosts are put, in the middle of the field.
const G = { x: 150, y: 150 };
// The player, far from everything near G.
const FAR = { x: 20, y: 20 };

let snipeTemplate: Snipe | undefined;

// A snipe that has just appeared, spawned by a lone hive in an open room.
function newSnipe(): Snipe {
  if (snipeTemplate !== undefined) return snipeTemplate;
  const room = createGrid(64, 48, ({ x, y }) =>
    x === 0 || y === 0 ? "wall" : "open",
  );
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
  snipeTemplate = state.snipes[0];
  return snipeTemplate;
}

// A snipe at `p` going d, that takes its first step on the next tick.
function snipe(p: Point, d: Dir, turn: Turn = 1): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx: d[0], dy: d[1], turn };
}

function shot(p: Point, [dx, dy]: Dir): Shot {
  return { x: p.x, y: p.y, dx, dy };
}

interface Setup {
  readonly maze?: Grid;
  readonly player?: Point;
  readonly skill?: string;
  readonly hives?: readonly (Point & {
    readonly hits?: number;
    readonly wait?: number;
  })[];
  readonly snipes?: readonly Snipe[];
  readonly ghosts?: readonly Ghost[];
  readonly shots?: readonly Shot[];
  readonly snipeShots?: readonly Shot[];
  readonly rng?: Rng;
  readonly lives?: number;
  readonly respawn?: number;
}

// A game at `skill` (D1 if not given) in `maze` (the field if not given) with only what the
// setup names. Nothing has been stepped yet, so the level's first `step` is its tick 1.
function arena(setup: Setup): GameState {
  const game = createGame(1, setup.skill ?? "D1");
  return {
    ...game,
    maze: setup.maze ?? field,
    player: { ...game.player, ...(setup.player ?? FAR) },
    hives: (setup.hives ?? []).map((h) => ({
      ...game.hives[0],
      x: h.x,
      y: h.y,
      hits: h.hits ?? 0,
      wait: h.wait ?? NEVER,
    })),
    snipes: setup.snipes ?? [],
    ghosts: setup.ghosts ?? [],
    shots: setup.shots ?? [],
    snipeShots: setup.snipeShots ?? [],
    rng: setup.rng ?? game.rng,
    lives: setup.lives ?? game.lives,
    respawn: setup.respawn ?? 0,
  };
}

function run(state: GameState, ticks: number, input = NO_INPUT): GameState {
  let current = state;
  for (let t = 0; t < ticks; t++) current = step(current, input);
  return current;
}

// Spec 2.4: a snipe's face half and spear half (top-left cells) at `p` going d.
function halves(p: Point, d: Dir): { face: Point; spear: Point } {
  const left = { x: p.x, y: p.y };
  const right = { x: p.x + 2, y: p.y };
  return FACE_RIGHT.some((f) => same(f, d))
    ? { face: right, spear: left }
    : { face: left, spear: right };
}

let ghostTemplates: { fresh: Ghost; ready: Ghost } | undefined;

// A ghost that has just appeared from a snipe at G going right, hit on its spear half (its
// right half) by a player's shot that already covers it, and the same ghost two ticks later.
function templates(): { fresh: Ghost; ready: Ghost } {
  if (ghostTemplates !== undefined) return ghostTemplates;
  let state = step(
    arena({
      snipes: [snipe(G, RIGHT)],
      shots: [shot({ x: G.x + 2, y: G.y }, DOWN)],
    }),
    NO_INPUT,
  );
  if (state.ghosts?.length !== 1) {
    throw new Error("No ghost appeared from a hit on a snipe's spear half");
  }
  const fresh = state.ghosts[0];
  state = run(state, 2);
  ghostTemplates = { fresh, ready: state.ghosts[0] };
  return ghostTemplates;
}

interface GhostOptions {
  readonly turn?: Turn;
  readonly straight?: boolean;
  /** A fresh ghost takes its first step on the 3rd tick; otherwise it steps on the next. */
  readonly fresh?: boolean;
}

// A ghost at `p` going d, not in straight mode unless the options say so.
function ghost(p: Point, d: Dir, options: GhostOptions = {}): Ghost {
  const t = templates();
  return {
    ...(options.fresh === true ? t.fresh : t.ready),
    x: p.x,
    y: p.y,
    dx: d[0],
    dy: d[1],
    turn: options.turn ?? 1,
    straight: options.straight ?? false,
  };
}

// A guard for the tests of hits that leave no ghost: at `skill`, the same snipe hit on its
// spear half does leave one.
function expectSpearLeavesGhost(d: Dir, skill = "D1"): void {
  const after = step(
    arena({
      skill,
      snipes: [snipe(G, d)],
      shots: [shot(halves(G, d).spear, DOWN)],
    }),
    NO_INPUT,
  );
  expect(
    after.ghosts,
    `guard: a snipe going ${name(d)} hit on its spear half at ${skill}`,
  ).toHaveLength(1);
}

// What the tests compare of a ghost.
function look(g: Ghost) {
  return { x: g.x, y: g.y, dir: name(dirOf(g)), straight: g.straight };
}

function expected(p: Point, d: Dir, straight: boolean) {
  return { x: p.x, y: p.y, dir: name(d), straight };
}

// ===========================================================================================

describe("4.3 GameState: ghosts", () => {
  it.each([
    [0, "A1"],
    [1, "D1"],
    [42, "M5"],
    [2 ** 32 - 1, "Z9"],
  ] as const)("a new game has no ghosts (seed %d, %s)", (seed, skill) => {
    expect(createGame(seed, skill).ghosts).toEqual([]);
  });

  it("keeps ghosts plain data that can be copied", () => {
    const state = run(arena({ ghosts: [ghost(G, RIGHT)] }), 1);
    expect(state.ghosts).toHaveLength(1);
    expect(structuredClone(state)).toEqual(state);
  });

  it("does not change the state it is given while ghosts appear and step", () => {
    const state = arena({
      snipes: [snipe({ x: 60, y: 60 }, RIGHT)],
      shots: [shot({ x: 62, y: 60 }, DOWN)],
      ghosts: [ghost(G, RIGHT), ghost({ x: 200, y: 90 }, UP, { turn: -1 })],
    });
    const before = structuredClone(state);
    const after = step(state, NO_INPUT);
    expect(state).toEqual(before);
    expect(step(before, NO_INPUT)).toEqual(after);
    expect(after.ghosts).toHaveLength(3);
  });

  it("is the same game for the same state and input, ghost for ghost", () => {
    const state = arena({
      ghosts: [ghost(G, LEFT), ghost({ x: 30, y: 200 }, DOWN_RIGHT)],
    });
    expect(run(state, 40)).toEqual(run(structuredClone(state), 40));
  });
});

describe("2.4 Ghosts: a hit on a snipe's spear half leaves a ghost on its face half", () => {
  const turns: Turn[] = [1, -1];
  const cases = EIGHT.flatMap(([n, d]) =>
    turns.map((turn) => [n, turn, d] as const),
  );

  it.each(cases)(
    "going %s, turning %d: a player's shot on the spear half",
    (_, turn, d) => {
      const { face, spear } = halves(G, d);
      const after = step(
        arena({ snipes: [snipe(G, d, turn)], shots: [shot(spear, DOWN)] }),
        NO_INPUT,
      );
      expect(after.snipes).toEqual([]);
      expect(after.shots).toEqual([]);
      expect(after.ghosts).toHaveLength(1);
      expect(after.ghosts[0]).toMatchObject({
        x: face.x,
        y: face.y,
        dx: d[0],
        dy: d[1],
        turn,
        straight: false,
      });
    },
  );

  it.each(EIGHT)(
    "going %s: a player's shot that enters only the spear half on its move",
    (_, d) => {
      const { face, spear } = halves(G, d);
      // From the side away from the face: it moves onto the spear half's outer column.
      const from =
        spear.x > face.x
          ? shot({ x: G.x + SNIPE_W, y: G.y }, LEFT)
          : shot({ x: G.x - 2, y: G.y }, RIGHT);
      const after = step(
        arena({ snipes: [snipe(G, d)], shots: [from] }),
        NO_INPUT,
      );
      expect(after.snipes).toEqual([]);
      expect(after.ghosts.map(look)).toEqual([expected(face, d, false)]);
    },
  );

  it.each(EIGHT)("going %s: a snipe's shot on the spear half", (_, d) => {
    const { face, spear } = halves(G, d);
    const after = step(
      arena({ snipes: [snipe(G, d)], snipeShots: [shot(spear, DOWN)] }),
      NO_INPUT,
    );
    expect(after.snipes).toEqual([]);
    expect(after.snipeShots).toEqual([]);
    expect(after.ghosts.map(look)).toEqual([expected(face, d, false)]);
  });

  it("two shots on the spear half on one tick leave one ghost", () => {
    const after = step(
      arena({
        snipes: [snipe(G, RIGHT)],
        shots: [shot({ x: G.x + 2, y: G.y }, DOWN)],
        snipeShots: [shot({ x: G.x + 2, y: G.y }, UP)],
      }),
      NO_INPUT,
    );
    expect(after.snipes).toEqual([]);
    expect(after.ghosts.map(look)).toEqual([expected(G, RIGHT, false)]);
  });

  it("the ghost takes the snipe's place, so the number of enemies does not change", () => {
    const state = arena({
      snipes: [
        snipe({ x: 40, y: 260 }, UP),
        snipe(G, LEFT),
        snipe({ x: 260, y: 40 }, DOWN),
      ],
      ghosts: [ghost({ x: 260, y: 260 }, LEFT, { fresh: true })],
      shots: [shot({ x: G.x, y: G.y }, DOWN)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toHaveLength(2);
    expect(after.ghosts).toHaveLength(2);
    expect(after.snipes.length + after.ghosts.length).toBe(
      state.snipes.length + state.ghosts.length,
    );
  });

  it("appears at exactly the letters with ghosts (2.6), at every digit", () => {
    for (const letter of LETTERS) {
      for (const digit of [1, 5, 9]) {
        const skill = `${letter}${digit}`;
        const after = step(
          arena({
            skill,
            snipes: [snipe(G, DOWN_LEFT)],
            shots: [shot(G, DOWN)],
          }),
          NO_INPUT,
        );
        expect(after.snipes, skill).toEqual([]);
        expect(after.ghosts.length, skill).toBe(letter in BURST ? 1 : 0);
      }
    }
  });
});

describe("2.4 Ghosts: no ghost from a hit on the face half, on both halves, or with ghosts off", () => {
  it.each(EIGHT)("going %s: a shot on the face half kills it only", (_, d) => {
    const { face } = halves(G, d);
    for (const s of [
      { shots: [shot(face, DOWN)] },
      { snipeShots: [shot(face, DOWN)] },
    ]) {
      const after = step(arena({ snipes: [snipe(G, d)], ...s }), NO_INPUT);
      expect(after.snipes).toEqual([]);
      expect(after.ghosts).toEqual([]);
    }
    expectSpearLeavesGhost(d);
  });

  it.each(EIGHT)(
    "going %s: different shots on both halves on one tick leave none",
    (_, d) => {
      const { face, spear } = halves(G, d);
      for (const s of [
        { shots: [shot(spear, DOWN), shot(face, UP)] },
        { shots: [shot(face, UP)], snipeShots: [shot(spear, DOWN)] },
        { shots: [shot(spear, UP)], snipeShots: [shot(face, DOWN)] },
      ]) {
        const after = step(arena({ snipes: [snipe(G, d)], ...s }), NO_INPUT);
        expect(after.snipes).toEqual([]);
        expect(after.ghosts).toEqual([]);
      }
      expectSpearLeavesGhost(d);
    },
  );

  it.each(["A1", "B5", "C9", "G1", "H2", "M3", "N4", "Q5", "R6"])(
    "with ghosts off (%s) a shot on the spear half just kills the snipe",
    (skill) => {
      for (const [, d] of EIGHT) {
        const { spear } = halves(G, d);
        const after = step(
          arena({ skill, snipes: [snipe(G, d)], shots: [shot(spear, DOWN)] }),
          NO_INPUT,
        );
        expect(after.snipes, name(d)).toEqual([]);
        expect(after.ghosts, name(d)).toEqual([]);
        // The same hit with ghosts on: letter D, the same digit.
        expectSpearLeavesGhost(d, `D${skill[1]}`);
      }
    },
  );
});

describe("2.4 Ghosts / 2.5 Bullets: a shot over both halves counts as the half it covers more of, the left on a tie", () => {
  // A 2 x 2 shot that covers cells of both halves covers one column of each, as many cells
  // of the one as of the other: it counts as hitting the left half.
  it.each(EIGHT)(
    "going %s: a shot already over both halves counts as the left half",
    (_, d) => {
      const { face } = halves(G, d);
      const leftIsSpear = FACE_RIGHT.some((f) => same(f, d));
      const after = step(
        arena({
          snipes: [snipe(G, d)],
          shots: [shot({ x: G.x + 1, y: G.y }, DOWN)],
        }),
        NO_INPUT,
      );
      expect(after.snipes).toEqual([]);
      expect(after.ghosts.map(look)).toEqual(
        leftIsSpear ? [expected(face, d, false)] : [],
      );
      expectSpearLeavesGhost(d);
    },
  );

  it.each(EIGHT)(
    "going %s: a shot that enters both halves from above or below counts as the left half",
    (_, d) => {
      const { face } = halves(G, d);
      const leftIsSpear = FACE_RIGHT.some((f) => same(f, d));
      for (const s of [
        { shots: [shot({ x: G.x + 1, y: G.y - 2 }, DOWN)] },
        { snipeShots: [shot({ x: G.x + 1, y: G.y + SNIPE_H }, UP)] },
      ]) {
        const after = step(arena({ snipes: [snipe(G, d)], ...s }), NO_INPUT);
        expect(after.snipes).toEqual([]);
        expect(after.ghosts.map(look)).toEqual(
          leftIsSpear ? [expected(face, d, false)] : [],
        );
      }
      expectSpearLeavesGhost(d);
    },
  );

  it("a shot over one cell of a half only counts as that half", () => {
    // Going right, the spear half is the right one: one cell of it is enough for a ghost.
    const right = step(
      arena({
        snipes: [snipe(G, RIGHT)],
        shots: [shot({ x: G.x + 3, y: G.y - 1 }, UP)],
      }),
      NO_INPUT,
    );
    expect(right.ghosts.map(look)).toEqual([expected(G, RIGHT, false)]);
    // One cell of the face half is not.
    const left = step(
      arena({
        snipes: [snipe(G, RIGHT)],
        shots: [shot({ x: G.x - 1, y: G.y + 1 }, DOWN)],
      }),
      NO_INPUT,
    );
    expect(left.snipes).toEqual([]);
    expect(left.ghosts).toEqual([]);
  });
});

describe("2.4 Ghosts: the order of appearance", () => {
  const A = { x: 60, y: 200 };
  const B = { x: 200, y: 60 };
  const old = { x: 260, y: 260 };

  it("a new ghost comes after the ghosts already there; ghosts of one tick in their snipes' order", () => {
    for (const order of [
      [snipe(A, RIGHT), snipe(B, LEFT)],
      [snipe(B, LEFT), snipe(A, RIGHT)],
    ]) {
      const after = step(
        arena({
          snipes: order,
          ghosts: [ghost(old, UP, { fresh: true })],
          shots: [
            shot(halves(A, RIGHT).spear, DOWN),
            shot(halves(B, LEFT).spear, DOWN),
          ],
        }),
        NO_INPUT,
      );
      const faces = order.map((s) => halves(s, dirOf(s)).face);
      expect(after.ghosts.map(where)).toEqual([old, ...faces]);
    }
  });

  it("a ghost that appears later comes after the earlier ones", () => {
    let state = step(
      arena({
        snipes: [snipe(A, RIGHT), snipe(B, LEFT)],
        shots: [shot(halves(B, LEFT).spear, DOWN)],
      }),
      NO_INPUT,
    );
    expect(state.ghosts.map(where)).toEqual([halves(B, LEFT).face]);
    // The other snipe, wherever it went, is hit on its spear half on the next tick.
    const s = state.snipes[0];
    state = step(
      { ...state, shots: [shot(halves(s, dirOf(s)).spear, DOWN)] },
      NO_INPUT,
    );
    expect(state.ghosts).toHaveLength(2);
    expect(where(state.ghosts[1])).toEqual(halves(s, dirOf(s)).face);
  });
});

describe("2.3 Hives / 2.4 Ghosts: hives spawn only snipes, and ghosts count toward the enemy cap", () => {
  it.each(["D1", "F5", "Z9"])(
    "a hive at %s spawns snipes, never ghosts",
    (skill) => {
      let state = arena({
        skill,
        player: { x: 250, y: 250 },
        hives: [{ x: 40, y: 30, wait: 0 }],
      });
      for (let t = 0; t < PATIENCE && state.snipes.length < 3; t++) {
        const before = state.snipes.length;
        // Nothing is ever hit: the snipes' shots are taken away as they appear.
        state = { ...step(state, NO_INPUT), snipeShots: [] };
        expect(state.ghosts, `tick ${t}`).toEqual([]);
        expect(state.snipes.length - before).toBeLessThanOrEqual(1);
      }
      expect(state.snipes.length).toBeGreaterThanOrEqual(3);
      // Guard: ghosts are on, so a spawned snipe hit on its spear half leaves one.
      const s = state.snipes[0];
      const hit = step(
        { ...state, shots: [shot(halves(s, dirOf(s)).spear, DOWN)] },
        NO_INPUT,
      );
      expect(hit.ghosts).toHaveLength(1);
    },
  );

  // Ten ghosts shut in a 2 x 2 hole in the walls: they can never move (2.4) and nothing hits
  // them. At D1 at most 10 enemies are on the map (2.6).
  const hole = { x: 100, y: 100 };
  const maze = grid(320, 320, ring(hole));

  function shutIn(count: number): GameState {
    return arena({
      maze,
      player: { x: 250, y: 250 },
      hives: [{ x: 40, y: 30, wait: 0 }],
      ghosts: Array.from({ length: count }, (_, i) =>
        ghost(hole, CLOCKWISE[i % 8], { turn: i % 2 === 0 ? 1 : -1 }),
      ),
    });
  }

  function untilSpawn(state: GameState): { state: GameState; ticks: number } {
    let current = state;
    for (let t = 1; t <= PATIENCE; t++) {
      current = { ...step(current, NO_INPUT), snipeShots: [] };
      if (current.snipes.length > 0) return { state: current, ticks: t };
    }
    throw new Error("No snipe appeared");
  }

  it("with 9 ghosts at D1 a hive spawns one snipe, and no more", () => {
    const { state, ticks } = untilSpawn(shutIn(9));
    expect(state.snipes).toHaveLength(1);
    expect(state.ghosts).toHaveLength(9);
    let current = state;
    for (let t = 0; t < 3 * ticks + 600; t++) {
      current = { ...step(current, NO_INPUT), snipeShots: [] };
      expect(current.snipes.length + current.ghosts.length).toBeLessThanOrEqual(
        10,
      );
    }
  });

  it("with 10 ghosts at D1 a hive spawns nothing", () => {
    const { ticks } = untilSpawn(shutIn(9));
    let state = shutIn(10);
    for (let t = 0; t < 3 * ticks + 600; t++) {
      state = { ...step(state, NO_INPUT), snipeShots: [] };
      expect(state.snipes, `tick ${t}`).toEqual([]);
      expect(state.ghosts).toHaveLength(10);
    }
  });
});

describe("2.1 Maze / 2.4 Ghosts: walls, hives, corner gaps and the player in play block a ghost; snipes and ghosts do not", () => {
  // A ghost at G in straight mode going down-right tries that way first, without drawing
  // anything (2.4 step 2). When it is open it moves there and stays in straight mode; when it
  // is blocked straight mode turns off and it tries down next (turning clockwise).
  const DIAGONAL = plus(G, DOWN_RIGHT);

  function tryDownRight(setup: Setup): GameState {
    return step(
      arena({
        ...setup,
        ghosts: [
          ghost(G, DOWN_RIGHT, { straight: true }),
          ...(setup.ghosts ?? []),
        ],
      }),
      NO_INPUT,
    );
  }

  it("moves diagonally in the open", () => {
    const after = tryDownRight({});
    expect(look(after.ghosts[0])).toEqual(expected(DIAGONAL, DOWN_RIGHT, true));
  });

  it("is blocked by a wall under any cell of its footprint", () => {
    const after = tryDownRight({
      maze: grid(320, 320, [{ x: G.x + 2, y: G.y + 2 }]),
    });
    expect(look(after.ghosts[0])).toEqual(expected(plus(G, DOWN), DOWN, false));
  });

  it("is blocked by a hive under any cell of its footprint", () => {
    const after = tryDownRight({ hives: [{ x: G.x + 2, y: G.y + 2 }] });
    expect(look(after.ghosts[0])).toEqual(expected(plus(G, DOWN), DOWN, false));
  });

  // Down-right, the horizontal straight position on the way covers (G.x + 2, G.y) and the
  // vertical one (G.x, G.y + 2); the diagonal position covers neither.
  const across = { x: G.x + 2, y: G.y };
  const downward = { x: G.x, y: G.y + 2 };

  it("does not go diagonally through a corner gap of two walls", () => {
    // Down and down-left are blocked by the wall below too; left is open.
    const after = tryDownRight({ maze: grid(320, 320, [across, downward]) });
    expect(look(after.ghosts[0])).toEqual(expected(plus(G, LEFT), LEFT, false));
  });

  it("counts a hive like a wall in the corner-gap test", () => {
    const withWall = tryDownRight({
      maze: grid(320, 320, [downward]),
      hives: [{ x: across.x, y: across.y - HIVE + 1 }],
    });
    expect(look(withWall.ghosts[0])).toEqual(
      expected(plus(G, LEFT), LEFT, false),
    );
    const twoHives = tryDownRight({
      hives: [
        { x: across.x, y: across.y - HIVE + 1 },
        { x: downward.x - HIVE + 1, y: downward.y },
      ],
    });
    expect(look(twoHives.ghosts[0])).toEqual(
      expected(plus(G, LEFT), LEFT, false),
    );
  });

  it("does not count the player in the corner-gap test", () => {
    // The player covers the cell only the horizontal position covers; a wall the one only the
    // vertical position covers. The diagonal position is clear of both.
    const after = tryDownRight({
      maze: grid(320, 320, [downward]),
      player: { x: across.x, y: across.y - PLAYER + 1 },
    });
    expect(look(after.ghosts[0])).toEqual(expected(DIAGONAL, DOWN_RIGHT, true));
    expect(after.respawn).toBe(0);
  });

  it("is blocked by the player in play, not by the player out of play", () => {
    const player = { x: G.x + 2, y: G.y + 2 };
    const inPlay = tryDownRight({ player });
    expect(look(inPlay.ghosts[0])).toEqual(
      expected(plus(G, DOWN), DOWN, false),
    );
    expect(inPlay.lives).toBe(arena({}).lives);
    const out = tryDownRight({ player, respawn: 60 });
    expect(look(out.ghosts[0])).toEqual(expected(DIAGONAL, DOWN_RIGHT, true));
  });

  it("is not blocked by a snipe", () => {
    // Wherever the snipe steps first, it still covers a cell of the diagonal position.
    const after = tryDownRight({ snipes: [snipe(DIAGONAL, RIGHT)] });
    expect(look(after.ghosts[0])).toEqual(expected(DIAGONAL, DOWN_RIGHT, true));
    expect(
      overlaps(field, ghostBox(after.ghosts[0]), snipeBox(after.snipes[0])),
    ).toBe(true);
  });

  it("is not blocked by another ghost", () => {
    const after = tryDownRight({
      ghosts: [ghost(DIAGONAL, UP, { fresh: true })],
    });
    expect(look(after.ghosts[0])).toEqual(expected(DIAGONAL, DOWN_RIGHT, true));
    expect(where(after.ghosts[1])).toEqual(DIAGONAL);
  });

  it("is blocked by walls in every straight direction too", () => {
    for (const [n, d] of EIGHT.filter(([, d]) => d[0] === 0 || d[1] === 0)) {
      // The cell just past the footprint in direction d.
      const wall = {
        x: d[0] > 0 ? G.x + GHOST : d[0] < 0 ? G.x - 1 : G.x,
        y: d[1] > 0 ? G.y + GHOST : d[1] < 0 ? G.y - 1 : G.y,
      };
      const after = step(
        arena({
          maze: grid(320, 320, [wall]),
          ghosts: [ghost(G, d, { straight: true })],
        }),
        NO_INPUT,
      );
      // Blocked, it turns one-eighth clockwise to a diagonal, and a quarter if the wall also
      // blocks that diagonal.
      const next = rotate(d, 1);
      const blocked = overlaps(field, ghostBox(plus(G, next)), {
        ...wall,
        width: 1,
        height: 1,
      });
      const went = blocked ? rotate(d, 2) : next;
      expect(look(after.ghosts[0]), n).toEqual(
        expected(plus(G, went), went, false),
      );
    }
  });

  it("a ghost that heads into a wall by the heading rule does not go there", () => {
    // With the player 16 cells right and down, the ghost heads down-right (2.4 sub-step 1.6).
    const player = { x: G.x + 16, y: G.y + 16 };
    const open = step(
      arena({ player, ghosts: [ghost(G, LEFT)], rng: rngIn(bucket(UP)) }),
      NO_INPUT,
    );
    expect(look(open.ghosts[0])).toEqual(expected(DIAGONAL, DOWN_RIGHT, false));
    const state = arena({
      maze: grid(320, 320, [{ x: G.x + 2, y: G.y + 2 }]),
      player,
      ghosts: [ghost(G, LEFT)],
      rng: rngIn(bucket(UP)),
    });
    const after = step(state, NO_INPUT);
    expect(look(after.ghosts[0])).toEqual(expected(plus(G, UP), UP, false));
    expect(drawsUsed(state.rng, after.rng)).toBe(1);
  });
});

describe("2.4 Ghosts: the first step 3 ticks after it appears, then one every 5", () => {
  it("in the open, it steps on the 3rd tick after it appears and every 5th after that", () => {
    // The ghost appears on tick 1 and heads for the player, far down-right, every step.
    let state = arena({
      player: { x: G.x + 60, y: G.y + 45 },
      snipes: [snipe(G, RIGHT)],
      shots: [shot({ x: G.x + 2, y: G.y }, DOWN)],
    });
    const moves: number[] = [];
    let last: Point | undefined;
    for (let tick = 1; tick <= 40; tick++) {
      state = step(state, NO_INPUT);
      expect(state.ghosts, `tick ${tick}`).toHaveLength(1);
      const now = where(state.ghosts[0]);
      if (last !== undefined && (now.x !== last.x || now.y !== last.y)) {
        expect(now, `tick ${tick}`).toEqual(plus(last, DOWN_RIGHT));
        moves.push(tick);
      }
      last = now;
    }
    expect(moves).toEqual([4, 9, 14, 19, 24, 29, 34, 39]);
    expect(1 + FIRST_STEP).toBe(moves[0]);
  });

  it("steps every 5 ticks whether or not it moves", () => {
    // Shut in a hole, near the player: every step draws a random direction (2.4 sub-step
    // 1.7) and moves nowhere.
    const hole = { x: 100, y: 100 };
    let state = arena({
      maze: grid(320, 320, ring(hole)),
      player: { x: 110, y: 108 },
      ghosts: [ghost(hole, UP)],
    });
    const draws: number[] = [];
    for (let tick = 1; tick <= 30; tick++) {
      const before = state;
      state = step(state, NO_INPUT);
      const n = drawsUsed(before.rng, state.rng);
      expect(n === 0 || n === 1, `tick ${tick}: ${n} draws`).toBe(true);
      if (n > 0) draws.push(tick);
      expect(where(state.ghosts[0])).toEqual(hole);
    }
    expect(draws).toEqual([1, 6, 11, 16, 21, 26]);
  });

  it("in straight mode, steps every 5 ticks too", () => {
    let state = arena({ ghosts: [ghost(G, RIGHT, { straight: true })] });
    const moves: number[] = [];
    for (let tick = 1; tick <= 25; tick++) {
      const before = where(state.ghosts[0]);
      state = step(state, NO_INPUT);
      if (where(state.ghosts[0]).x !== before.x) moves.push(tick);
    }
    expect(moves).toEqual([1, 1 + GHOST_TICKS, 11, 16, 21]);
  });
});

describe("2.4 Ghosts: each step of the heading rule, with straight mode off", () => {
  // The ghost at G, not in straight mode, with the player at G + (dx, dy). X = floor(|dx| / 2),
  // Y = floor(|dy| / 2), and P is the direction to the player (2.4). None of these steps draws
  // anything, and none of them is blocked or bursts.
  const cases: [rule: string, dx: number, dy: number, goes: Dir][] = [
    ["1.6: the diagonal P", 40, 30, DOWN_RIGHT],
    ["1.6: the diagonal P", -40, 30, DOWN_LEFT],
    ["1.6: the diagonal P", 40, -30, UP_RIGHT],
    ["1.6: the diagonal P", -40, -30, UP_LEFT],
    ["1.6: the diagonal P", 10, 8, DOWN_RIGHT],
    ["1.6: the diagonal P", -6, 7, DOWN_LEFT],
    ["1.2: Y = 1, P down-right", 40, 2, RIGHT],
    ["1.2: Y = 1, P down-right", 40, 3, RIGHT],
    ["1.2: Y = 1, P down-right", 5, 2, RIGHT],
    ["1.2: Y = 1, P down-left", -40, 2, LEFT],
    ["1.2: Y = 1, P up-right", 40, -2, RIGHT],
    ["1.2: Y = 1, P up-left", -40, -3, LEFT],
    ["1.2: Y = 1, P down", 0, 2, LEFT],
    ["1.2: Y = 1, P down", -1, 3, LEFT],
    ["1.3: Y = 0, P right turned clockwise", 40, 0, DOWN_RIGHT],
    ["1.3: Y = 0, P right turned clockwise", 40, 1, DOWN_RIGHT],
    ["1.3: Y = 0, P right turned clockwise", 40, -1, DOWN_RIGHT],
    ["1.3: Y = 0 comes before X = 1", 3, 1, DOWN_RIGHT],
    ["1.3: Y = 0, P left turned clockwise", -40, 0, UP_LEFT],
    ["1.3: Y = 0, P left turned clockwise", -5, 1, UP_LEFT],
    ["1.4: X = 1, P down-right", 2, 40, DOWN],
    ["1.4: X = 1, P down-right", 3, 10, DOWN],
    ["1.4: X = 1, P down-left", -3, 40, DOWN],
    ["1.4: X = 1, P up-right", 2, -40, UP],
    ["1.4: X = 1, P up-left", -2, -40, UP],
    ["1.5: X = 0, P down turned a quarter clockwise", 0, 40, LEFT],
    ["1.5: X = 0, P down turned a quarter clockwise", 1, 40, LEFT],
    ["1.5: X = 0, P down turned a quarter clockwise", -1, 40, LEFT],
    ["1.5: X = 0, P up turned a quarter clockwise", 0, -40, RIGHT],
    ["1.5: X = 0, P up turned a quarter clockwise", 1, -10, RIGHT],
  ];

  it.each(cases)("%s (dx %d, dy %d)", (_, dx, dy, goes) => {
    for (const turn of [1, -1] as const) {
      for (const [, d] of [EIGHT[0], EIGHT[3], EIGHT[6]]) {
        const state = arena({
          player: { x: G.x + dx, y: G.y + dy },
          ghosts: [ghost(G, d, { turn })],
          rng: rngIn(TINY),
        });
        const after = step(state, NO_INPUT);
        expect(look(after.ghosts[0]), `turn ${turn}, going ${name(d)}`).toEqual(
          expected(plus(G, goes), goes, false),
        );
        expect(drawsUsed(state.rng, after.rng)).toBe(0);
        expect(after.lives).toBe(state.lives);
      }
    }
  });

  // When the first try of sub-step 1.3 or 1.5 is blocked, the candidate is P turned the other
  // way, and it moves there if that is open.
  const fallbacks: [
    rule: string,
    dx: number,
    dy: number,
    wall: Point,
    goes: Dir,
  ][] = [
    [
      "1.3: P right, down-right blocked",
      40,
      0,
      { x: G.x + 2, y: G.y + 2 },
      UP_RIGHT,
    ],
    [
      "1.3: P left, up-left blocked",
      -40,
      0,
      { x: G.x - 1, y: G.y - 1 },
      DOWN_LEFT,
    ],
    ["1.5: P down, left blocked", 0, 40, { x: G.x - 1, y: G.y }, RIGHT],
    ["1.5: P up, right blocked", 0, -40, { x: G.x + 2, y: G.y }, LEFT],
  ];

  it.each(fallbacks)("%s: P turned the other way", (_, dx, dy, wall, goes) => {
    const state = arena({
      maze: grid(320, 320, [wall]),
      player: { x: G.x + dx, y: G.y + dy },
      ghosts: [ghost(G, UP)],
      rng: rngIn(TINY),
    });
    const after = step(state, NO_INPUT);
    expect(look(after.ghosts[0])).toEqual(expected(plus(G, goes), goes, false));
    expect(drawsUsed(state.rng, after.rng)).toBe(0);
  });

  it("1.7: a blocked candidate draws a random direction; straight mode stays off when X + Y < 20", () => {
    for (const [dx, dy] of [
      [10, 8],
      [25, 15], // X + Y = 12 + 7 = 19
    ]) {
      const state = arena({
        maze: grid(320, 320, [{ x: G.x + 2, y: G.y + 2 }]),
        player: { x: G.x + dx, y: G.y + dy },
        ghosts: [ghost(G, LEFT)],
        rng: rngIn(bucket(UP)),
      });
      const after = step(state, NO_INPUT);
      expect(look(after.ghosts[0]), `${dx}, ${dy}`).toEqual(
        expected(plus(G, UP), UP, false),
      );
      expect(drawsUsed(state.rng, after.rng)).toBe(1);
    }
  });

  it("1.7: a blocked candidate turns straight mode on when X + Y >= 20", () => {
    for (const [dx, dy] of [
      [26, 15], // X + Y = 13 + 7 = 20
      [24, 16], // 12 + 8 = 20
      [40, 30],
    ]) {
      const state = arena({
        maze: grid(320, 320, [{ x: G.x + 2, y: G.y + 2 }]),
        player: { x: G.x + dx, y: G.y + dy },
        ghosts: [ghost(G, LEFT)],
        rng: rngIn(bucket(UP)),
      });
      const after = step(state, NO_INPUT);
      expect(look(after.ghosts[0]), `${dx}, ${dy}`).toEqual(
        expected(plus(G, UP), UP, true),
      );
      expect(drawsUsed(state.rng, after.rng)).toBe(1);
    }
  });

  it("1.3 with both turns blocked goes on to 1.7", () => {
    const state = arena({
      maze: grid(320, 320, [
        { x: G.x + 2, y: G.y + 2 },
        { x: G.x + 2, y: G.y - 1 },
      ]),
      player: { x: G.x + 40, y: G.y },
      ghosts: [ghost(G, LEFT)],
      rng: rngIn(bucket(LEFT)),
    });
    const after = step(state, NO_INPUT);
    // X + Y = 20 + 0: straight mode on.
    expect(look(after.ghosts[0])).toEqual(expected(plus(G, LEFT), LEFT, true));
    expect(drawsUsed(state.rng, after.rng)).toBe(1);
  });

  it("2: from the random direction it turns one-eighth at a time in its own sense; the first blocked try turns straight mode off", () => {
    // A wall below the ghost blocks down-left, down and down-right; the player is down-right.
    const wall = Array.from({ length: 13 }, (_, i) => ({
      x: G.x - 6 + i,
      y: G.y + 2,
    }));
    for (const [turn, goes] of [
      [1, LEFT],
      [-1, RIGHT],
    ] as const) {
      const state = arena({
        maze: grid(320, 320, wall),
        player: { x: G.x + 40, y: G.y + 30 },
        ghosts: [ghost(G, UP, { turn })],
        rng: rngIn(bucket(DOWN)),
      });
      const after = step(state, NO_INPUT);
      expect(look(after.ghosts[0]), `turn ${turn}`).toEqual(
        expected(plus(G, goes), goes, false),
      );
      expect(drawsUsed(state.rng, after.rng)).toBe(1);
    }
  });

  it("2: with all 8 ways blocked it stays put, its direction the last one tried", () => {
    const hole = { x: 100, y: 100 };
    for (const turn of [1, -1] as const) {
      for (const [, d] of EIGHT) {
        const state = arena({
          maze: grid(320, 320, ring(hole)),
          player: { x: 110, y: 108 },
          ghosts: [ghost(hole, RIGHT, { turn })],
          rng: rngIn(bucket(d)),
        });
        const after = step(state, NO_INPUT);
        expect(look(after.ghosts[0]), `${turn} ${name(d)}`).toEqual(
          expected(hole, rotate(d, 7 * turn), false),
        );
        expect(drawsUsed(state.rng, after.rng)).toBe(1);
      }
    }
  });
});

describe("2.4 Ghosts: straight mode", () => {
  it("keeps going its way without drawing, whatever the way to the player", () => {
    let state = arena({
      player: { x: G.x + 40, y: G.y + 30 },
      ghosts: [ghost(G, LEFT, { straight: true })],
      rng: rngIn(TINY),
    });
    const rng = state.rng;
    state = run(state, 1 + 2 * GHOST_TICKS);
    expect(look(state.ghosts[0])).toEqual(
      expected(plus(G, LEFT, 3), LEFT, true),
    );
    expect(drawsUsed(rng, state.rng)).toBe(0);
  });

  it("is blocked: straight mode turns off and it turns in its own sense, without drawing", () => {
    const walls = [
      { x: G.x + 2, y: G.y },
      { x: G.x + 2, y: G.y + 1 },
    ];
    for (const [turn, goes] of [
      [1, DOWN],
      [-1, UP],
    ] as const) {
      const state = arena({
        maze: grid(320, 320, walls),
        player: { x: G.x + 40, y: G.y + 30 },
        ghosts: [ghost(G, RIGHT, { turn, straight: true })],
        rng: rngIn(TINY),
      });
      const after = step(state, NO_INPUT);
      expect(look(after.ghosts[0]), `turn ${turn}`).toEqual(
        expected(plus(G, goes), goes, false),
      );
      expect(drawsUsed(state.rng, after.rng)).toBe(0);
    }
  });

  it("with all 8 ways blocked it stays put, out of straight mode, without drawing", () => {
    const hole = { x: 100, y: 100 };
    for (const turn of [1, -1] as const) {
      const state = arena({
        maze: grid(320, 320, ring(hole)),
        player: { x: 110, y: 108 },
        ghosts: [ghost(hole, DOWN, { turn, straight: true })],
        rng: rngIn(TINY),
      });
      const after = step(state, NO_INPUT);
      expect(look(after.ghosts[0])).toEqual(
        expected(hole, rotate(DOWN, 7 * turn), false),
      );
      expect(drawsUsed(state.rng, after.rng)).toBe(0);
    }
  });

  it("turned on by a blocked candidate, it goes on until it is blocked, then follows the heading rule again", () => {
    // The player is far down-right (X + Y = 35), a wall blocks the first diagonal step, the
    // random direction is up, and a wall row three rows up stops the ghost.
    const row = Array.from({ length: 21 }, (_, i) => ({
      x: G.x - 10 + i,
      y: G.y - 3,
    }));
    let state = arena({
      maze: grid(320, 320, [{ x: G.x + 2, y: G.y + 2 }, ...row]),
      player: { x: G.x + 40, y: G.y + 30 },
      ghosts: [ghost(G, LEFT)],
      rng: rngIn(bucket(UP), TINY),
    });
    const rng = state.rng;
    const seen: ReturnType<typeof look>[] = [];
    for (let tick = 1; tick <= 1 + 3 * GHOST_TICKS; tick++) {
      state = step(state, NO_INPUT);
      if ((tick - 1) % GHOST_TICKS === 0) seen.push(look(state.ghosts[0]));
    }
    expect(seen).toEqual([
      // 1.7: blocked down-right, straight mode on, up at random.
      expected(plus(G, UP), UP, true),
      // 2: up again, though the player is down-right.
      expected(plus(G, UP, 2), UP, true),
      // 2: up is blocked by the wall row, and up-right too: straight mode off, right.
      expected({ x: G.x + 1, y: G.y - 2 }, RIGHT, false),
      // 1.6: down-right toward the player again.
      expected({ x: G.x + 2, y: G.y - 1 }, DOWN_RIGHT, false),
    ]);
    expect(drawsUsed(rng, state.rng)).toBe(1);
  });
});

describe("2.4 Ghosts / 2.2 Player: a ghost blocked by the player on a diagonal may burst", () => {
  // The player at PL covers columns and rows 100 to 103. From each of these spots, X = Y = 1,
  // the direction to the player is the diagonal named, and one step that way overlaps the
  // player's footprint. From up-left (inside the player's footprint) every way is blocked.
  const PL = { x: 100, y: 100 };
  const SPOTS: [string, Dir, Point][] = [
    ["down-right", DOWN_RIGHT, { x: 98, y: 98 }],
    ["up-right", UP_RIGHT, { x: 98, y: 102 }],
    ["down-left", DOWN_LEFT, { x: 102, y: 98 }],
    ["up-left, overlapping the player", UP_LEFT, { x: 102, y: 102 }],
  ];
  const F = BURST.F;

  it.each(SPOTS)(
    "toward the player %s: on success the ghost and the player die, with no points",
    (_, __, at) => {
      const state = arena({
        skill: "F1",
        player: PL,
        hives: [{ x: 250, y: 250 }],
        ghosts: [ghost(at, LEFT)],
        rng: rngIn(below(F), ANY),
      });
      const after = step(state, NO_INPUT);
      expect(after.ghosts).toEqual([]);
      expect(after.lives).toBe(state.lives - 1);
      expect(after.respawn).toBeGreaterThan(0);
      expect(after.score).toBe(0);
      expect(drawsUsed(state.rng, after.rng)).toBe(1);
    },
  );

  it.each(SPOTS)(
    "toward the player %s: on failure the candidate is P, blocked by the player, and it skips the side steps",
    (_, __, at) => {
      // P is blocked: 1.7 draws a random direction (up) and step 2 goes on from there. The
      // side step of sub-step 1.2 (Y = 1) is never tried.
      const state = arena({
        skill: "F1",
        player: PL,
        ghosts: [ghost(at, LEFT)],
        rng: rngIn(above(F), bucket(UP)),
      });
      const after = step(state, NO_INPUT);
      expect(after.lives).toBe(state.lives);
      expect(after.respawn).toBe(0);
      expect(drawsUsed(state.rng, after.rng)).toBe(2);
      const up = plus(at, UP);
      const free = !overlaps(field, ghostBox(up), playerBox(PL));
      expect(look(after.ghosts[0])).toEqual(
        free ? expected(up, UP, false) : expected(at, UP_LEFT, false),
      );
    },
  );

  it.each(GHOST_LETTERS)(
    "at letter %s, bursts on a draw below its chance and not above it",
    (letter) => {
      const c = BURST[letter];
      const at = { x: 98, y: 98 };
      const bursts = step(
        arena({
          skill: `${letter}1`,
          player: PL,
          ghosts: [ghost(at, LEFT)],
          rng: rngIn(below(c), ANY),
        }),
        NO_INPUT,
      );
      expect(bursts.ghosts).toEqual([]);
      expect(bursts.respawn).toBeGreaterThan(0);
      const holds = step(
        arena({
          skill: `${letter}1`,
          player: PL,
          ghosts: [ghost(at, LEFT)],
          rng: rngIn(above(c), bucket(UP)),
        }),
        NO_INPUT,
      );
      expect(holds.ghosts).toHaveLength(1);
      expect(holds.respawn).toBe(0);
    },
  );

  it("draws nothing when one step toward the player does not reach it", () => {
    for (const [at, goes, to] of [
      // X = Y = 2: 1.6, down-right.
      [{ x: 96, y: 96 }, DOWN_RIGHT, { x: 97, y: 97 }],
      // X = 2, Y = 1: 1.2, right.
      [{ x: 95, y: 98 }, RIGHT, { x: 96, y: 98 }],
    ] as const) {
      const state = arena({
        skill: "Z1",
        player: PL,
        ghosts: [ghost(at, LEFT)],
        rng: rngIn(TINY),
      });
      const after = step(state, NO_INPUT);
      expect(look(after.ghosts[0])).toEqual(expected(to, goes, false));
      expect(after.lives).toBe(state.lives);
      expect(drawsUsed(state.rng, after.rng)).toBe(0);
    }
  });

  it("draws no burst chance when the way to the player is straight, even next to it", () => {
    // P is right (dy = -1); both 1.3 tries overlap the player, so 1.7 draws a random
    // direction (up), the only draw.
    const at = { x: 98, y: 101 };
    const state = arena({
      skill: "Z1",
      player: PL,
      ghosts: [ghost(at, LEFT)],
      rng: rngIn(TINY),
    });
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives);
    expect(look(after.ghosts[0])).toEqual(expected(plus(at, UP), UP, false));
    expect(drawsUsed(state.rng, after.rng)).toBe(1);
  });

  it("draws no burst chance in straight mode", () => {
    const at = { x: 98, y: 98 };
    const state = arena({
      skill: "Z1",
      player: PL,
      ghosts: [ghost(at, UP, { straight: true })],
      rng: rngIn(TINY),
    });
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives);
    expect(look(after.ghosts[0])).toEqual(expected(plus(at, UP), UP, true));
    expect(drawsUsed(state.rng, after.rng)).toBe(0);
  });

  it("draws no burst chance and is not blocked while the player is out of play", () => {
    for (const [ghosts, to, goes, straight] of [
      // Measured to where the player died: Y = 1, so right (1.2).
      [[ghost({ x: 98, y: 98 }, LEFT)], { x: 99, y: 98 }, RIGHT, false],
      // Straight down-right, onto where the player died.
      [
        [ghost({ x: 98, y: 98 }, DOWN_RIGHT, { straight: true })],
        { x: 99, y: 99 },
        DOWN_RIGHT,
        true,
      ],
    ] as const) {
      const state = arena({
        skill: "Z1",
        player: PL,
        respawn: 60,
        ghosts,
        rng: rngIn(TINY),
      });
      const after = step(state, NO_INPUT);
      expect(after.lives).toBe(state.lives);
      expect(look(after.ghosts[0])).toEqual(expected(to, goes, straight));
      expect(drawsUsed(state.rng, after.rng)).toBe(0);
    }
  });

  it("a player killed by a snipe's shot earlier in the tick blocks no ghost and causes no draw", () => {
    const state = arena({
      skill: "Z1",
      player: PL,
      snipeShots: [shot({ x: 101, y: 101 }, RIGHT)],
      ghosts: [ghost({ x: 98, y: 98 }, DOWN_RIGHT, { straight: true })],
      rng: rngIn(TINY),
    });
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives - 1);
    expect(look(after.ghosts[0])).toEqual(
      expected({ x: 99, y: 99 }, DOWN_RIGHT, true),
    );
    expect(drawsUsed(state.rng, after.rng)).toBe(0);
  });

  it("a player killed by touching a snipe after the snipes step causes no burst draw", () => {
    // The snipe keeps its way and steps onto the player; it may fire, which is its second
    // draw. The ghost's sub-step 1.1 would draw next, and that draw would burst it.
    const state = arena({
      skill: "D1",
      player: PL,
      snipes: [snipe({ x: 96, y: 101 }, RIGHT)],
      ghosts: [ghost({ x: 98, y: 98 }, LEFT)],
      rng: rngIn(KEEPS, ANY, TINY),
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes.map(where)).toEqual([{ x: 97, y: 101 }]);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.ghosts).toHaveLength(1);
    // Measured to where the player died: Y = 1, so right (1.2).
    expect(look(after.ghosts[0])).toEqual(
      expected({ x: 99, y: 98 }, RIGHT, false),
    );
  });

  it("after a burst, the ghosts that step later in the tick find the player out of play", () => {
    const c = BURST.F;
    const state = arena({
      skill: "F1",
      player: PL,
      ghosts: [ghost({ x: 98, y: 98 }, LEFT), ghost({ x: 102, y: 98 }, LEFT)],
      rng: rngIn(below(c), TINY),
    });
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives - 1);
    // The second: Y = 1 and P down-left, so left (1.2), with no draw.
    expect(after.ghosts.map(look)).toEqual([
      expected({ x: 101, y: 98 }, LEFT, false),
    ]);
    expect(drawsUsed(state.rng, after.rng)).toBe(1);
  });

  it("the ghosts burst in the order they appeared: the first one draws first", () => {
    const c = BURST.F;
    const a = ghost({ x: 98, y: 98 }, LEFT);
    const b = ghost({ x: 102, y: 98 }, LEFT);
    // The survivor is the one that stepped second. It finds the player out of play and, with
    // Y = 1, takes its side step (1.2) toward where the player died, without drawing.
    for (const [ghosts, survivor] of [
      [[a, b], expected({ x: 101, y: 98 }, LEFT, false)],
      [[b, a], expected({ x: 99, y: 98 }, RIGHT, false)],
    ] as const) {
      const state = arena({
        skill: "F1",
        player: PL,
        ghosts,
        rng: rngIn(below(c), TINY),
      });
      const after = step(state, NO_INPUT);
      expect(after.ghosts.map(look)).toEqual([survivor]);
      expect(after.lives).toBe(state.lives - 1);
      expect(drawsUsed(state.rng, after.rng)).toBe(1);
    }
  });

  it("a player killed by a burst does not fire on that tick", () => {
    const c = BURST.F;
    const fire = hold({ fireX: 1 });
    const bursts = step(
      arena({
        skill: "F1",
        player: PL,
        hives: [{ x: 250, y: 250 }],
        ghosts: [ghost({ x: 98, y: 98 }, LEFT)],
        rng: rngIn(below(c), ANY),
      }),
      fire,
    );
    expect(bursts.respawn).toBeGreaterThan(0);
    expect(bursts.shots).toEqual([]);
    const holds = step(
      arena({
        skill: "F1",
        player: PL,
        hives: [{ x: 250, y: 250 }],
        ghosts: [ghost({ x: 98, y: 98 }, LEFT)],
        rng: rngIn(above(c), bucket(UP)),
      }),
      fire,
    );
    expect(holds.shots).toHaveLength(1);
  });

  it("a burst that removes the last enemy on the last life wins the game, with the bonus for no lives", () => {
    const state = arena({
      skill: "F1",
      player: PL,
      lives: 1,
      ghosts: [ghost({ x: 98, y: 98 }, LEFT)],
      rng: rngIn(below(BURST.F), ANY),
    });
    const after = realStep(state, NO_INPUT);
    expect(after.ghosts).toEqual([]);
    expect(after.lives).toBe(0);
    expect(after.cleared).toBe(true);
    expect(after.gameOver).toBe(false);
    expect(after.score).toBe(levelBonus(0, 1));
  });

  it("a burst that removes the last enemy with lives left wins with the lives left", () => {
    const state = arena({
      skill: "F1",
      player: PL,
      lives: 3,
      ghosts: [ghost({ x: 98, y: 98 }, LEFT)],
      rng: rngIn(below(BURST.F), ANY),
    });
    const after = realStep(state, NO_INPUT);
    expect(after.cleared).toBe(true);
    expect(after.lives).toBe(2);
    expect(after.score).toBe(levelBonus(2, 1));
  });
});

describe("2.4 Ghosts / 2.2 Player: touching a ghost does not kill, and ghosts never shoot", () => {
  const PL = { x: 100, y: 100 };

  it("the player moves onto a ghost and lives", () => {
    let state = arena({
      player: PL,
      hives: [{ x: 250, y: 250 }],
      ghosts: [ghost({ x: 104, y: 101 }, LEFT, { fresh: true })],
    });
    state = run(state, 2, hold({ moveX: 1 }));
    expect(state.player.x).toBe(PL.x + 1);
    expect(
      overlaps(field, playerBox(state.player), ghostBox(state.ghosts[0])),
    ).toBe(true);
    expect(state.respawn).toBe(0);
    expect(state.lives).toBe(arena({}).lives);
  });

  it("a ghost inside the player's footprint, straight above its middle, stays there and never kills", () => {
    // dx = dy = -1: the way to the player is up, never a diagonal, and every step overlaps it.
    const at = { x: 101, y: 101 };
    let state = arena({
      skill: "F1",
      player: PL,
      hives: [{ x: 250, y: 250 }],
      ghosts: [ghost(at, LEFT)],
    });
    for (let tick = 1; tick <= 600; tick++) {
      state = step(state, NO_INPUT);
      expect(state.respawn, `tick ${tick}`).toBe(0);
      expect(where(state.ghosts[0])).toEqual(at);
    }
    expect(state.lives).toBe(arena({ skill: "F1" }).lives);
  });

  it("never fires a shot, at any letter with ghosts", () => {
    for (const skill of ["D1", "F5", "Z9"]) {
      let state = arena({
        skill,
        player: { x: G.x, y: G.y + 100 },
        hives: [{ x: 10, y: 10 }],
        ghosts: [
          ghost(G, DOWN),
          ghost({ x: G.x + 2, y: G.y }, DOWN, { straight: true }),
          // Each is at least 80 cells from the player; in 200 ticks a ghost steps 40 times.
          ghost({ x: G.x - 100, y: G.y + 100 }, RIGHT),
          ghost({ x: G.x + 80, y: G.y + 20 }, DOWN_LEFT),
        ],
      });
      for (let tick = 1; tick <= 200; tick++) {
        state = step(state, NO_INPUT);
        expect(state.snipeShots, `${skill} tick ${tick}`).toEqual([]);
        expect(state.shots).toEqual([]);
      }
      expect(state.ghosts).toHaveLength(4);
    }
  });
});

describe("2.4 Ghosts / 4.3: ghosts step after the player moves, in the order they appeared", () => {
  it("a ghost aims at where the player is after this tick's move", () => {
    // Before the move dy = 1 (Y = 0, 1.3: down-right); after the player steps down, dy = 2
    // (Y = 1, 1.2: right).
    const at = { x: 60, y: 99 };
    const state = arena({
      player: { x: 100, y: 100 },
      ghosts: [ghost(at, LEFT)],
    });
    const after = step(state, hold({ moveY: 1 }));
    expect(after.player.y).toBe(101);
    expect(look(after.ghosts[0])).toEqual(
      expected(plus(at, RIGHT), RIGHT, false),
    );
  });

  it("while the player is out of play, ghosts aim at where it died", () => {
    const died = { x: 100, y: 100 };
    const state = arena({
      player: died,
      respawn: 60,
      ghosts: [
        ghost({ x: 60, y: 70 }, UP),
        ghost({ x: 140, y: 70 }, UP),
        ghost({ x: 60, y: 140 }, UP),
      ],
    });
    const after = step(state, NO_INPUT);
    expect(after.ghosts.map(look)).toEqual([
      expected({ x: 61, y: 71 }, DOWN_RIGHT, false),
      expected({ x: 139, y: 71 }, DOWN_LEFT, false),
      expected({ x: 61, y: 139 }, UP_RIGHT, false),
    ]);
  });

  it("two ghosts that step on one tick draw in the order they appeared", () => {
    // Each is shut in a hole near the player, and draws one random direction; with all ways
    // blocked it ends facing the last one it tried, one-eighth back from the one it drew.
    const h1 = { x: 100, y: 100 };
    const h2 = { x: 120, y: 100 };
    const maze = grid(320, 320, [...ring(h1), ...ring(h2)]);
    const a = ghost(h1, RIGHT);
    const b = ghost(h2, RIGHT);
    for (const ghosts of [
      [a, b],
      [b, a],
    ]) {
      const state = arena({
        maze,
        player: { x: 110, y: 108 },
        ghosts,
        rng: rngIn(bucket(UP), bucket(DOWN)),
      });
      const after = step(state, NO_INPUT);
      expect(after.ghosts.map(where)).toEqual(ghosts.map(where));
      expect(after.ghosts.map((g) => name(dirOf(g)))).toEqual([
        name(UP_LEFT),
        name(DOWN_RIGHT),
      ]);
      expect(drawsUsed(state.rng, after.rng)).toBe(2);
    }
  });

  it("a new ghost steps after the older ghosts on the tick both step", () => {
    // The old ghost is shut in a 2 x 2 hole near the player; the new one appears from a snipe
    // shut in a 4 x 2 hole, which leaves the ghost only its spear half to go to. Each draws one
    // random direction when they first step together; only the old one's shows.
    const h1 = { x: 160, y: 120 };
    const h2 = { x: 200, y: 100 };
    const maze = grid(320, 320, [...ring(h1), ...ring(h2, SNIPE_W, SNIPE_H)]);
    const player = { x: 150, y: 130 };
    // The old ghost steps on ticks 1, 6, 11; the new one appears on tick 3 and first steps on
    // tick 6.
    let state = arena({ maze, player, ghosts: [ghost(h1, RIGHT)] });
    state = run(state, 2);
    state = step(
      {
        ...state,
        snipes: [snipe(h2, RIGHT)],
        shots: [shot({ x: h2.x + 2, y: h2.y }, DOWN)],
      },
      NO_INPUT,
    );
    expect(state.ghosts.map(where)).toEqual([h1, h2]);
    state = run(state, 2);
    state = step({ ...state, rng: rngIn(bucket(UP), bucket(DOWN)) }, NO_INPUT);
    expect(name(dirOf(state.ghosts[0]))).toBe(name(UP_LEFT));
    expect(where(state.ghosts[1])).toEqual({ x: h2.x + 1, y: h2.y });
    expect(name(dirOf(state.ghosts[1]))).toBe(name(RIGHT));
  });
});

describe("2.7 Levels and scoring: ghosts", () => {
  const H2 = { x: 280, y: 280 }; // a hive out of every shot's way, so the level goes on
  const at = { x: 150, y: 150 };
  // A shot that enters the ghost at `at` from the left on its first move.
  const fromLeft = shot({ x: at.x - 2, y: at.y }, RIGHT);

  it("a ghost killed by the player's shot gives 10", () => {
    const after = step(
      arena({
        hives: [H2],
        ghosts: [ghost(at, UP, { fresh: true })],
        shots: [fromLeft],
      }),
      NO_INPUT,
    );
    expect(after.ghosts).toEqual([]);
    expect(after.shots).toEqual([]);
    expect(after.score).toBe(GHOST_POINTS);
  });

  it("a ghost killed by the player's shot and a snipe's shot on one tick gives 10 once", () => {
    const after = step(
      arena({
        hives: [H2],
        ghosts: [ghost(at, UP, { fresh: true })],
        shots: [fromLeft],
        snipeShots: [shot({ x: at.x + 2, y: at.y }, LEFT)],
      }),
      NO_INPUT,
    );
    expect(after.ghosts).toEqual([]);
    expect(after.shots).toEqual([]);
    expect(after.snipeShots).toEqual([]);
    expect(after.score).toBe(GHOST_POINTS);
  });

  it("a snipe's shot alone kills a ghost, with no points", () => {
    const after = step(
      arena({
        hives: [H2],
        ghosts: [ghost(at, UP, { fresh: true })],
        snipeShots: [shot({ x: at.x + 2, y: at.y }, LEFT)],
      }),
      NO_INPUT,
    );
    expect(after.ghosts).toEqual([]);
    expect(after.snipeShots).toEqual([]);
    expect(after.score).toBe(0);
  });

  it("a ghost and a snipe killed on one tick give 10 each", () => {
    const s = { x: 60, y: 60 };
    const after = step(
      arena({
        hives: [H2],
        snipes: [snipe(s, RIGHT)],
        ghosts: [ghost(at, UP, { fresh: true })],
        shots: [fromLeft, shot(halves(s, RIGHT).face, DOWN)],
      }),
      NO_INPUT,
    );
    expect(after.snipes).toEqual([]);
    expect(after.ghosts).toEqual([]);
    expect(after.score).toBe(SNIPE_POINTS + GHOST_POINTS);
  });

  it("the snipe hit on its spear half by the player's shot gives its 10, and its ghost nothing yet", () => {
    const after = step(
      arena({
        hives: [H2],
        snipes: [snipe(at, RIGHT)],
        shots: [shot(halves(at, RIGHT).spear, DOWN)],
      }),
      NO_INPUT,
    );
    expect(after.ghosts).toHaveLength(1);
    expect(after.score).toBe(SNIPE_POINTS);
  });

  it("the snipe hit on its spear half by a snipe's shot alone gives nothing", () => {
    const after = step(
      arena({
        hives: [H2],
        snipes: [snipe(at, RIGHT)],
        snipeShots: [shot(halves(at, RIGHT).spear, DOWN)],
      }),
      NO_INPUT,
    );
    expect(after.ghosts).toHaveLength(1);
    expect(after.score).toBe(0);
  });

  it("a level with a ghost left is not cleared (6.2)", () => {
    const hole = { x: 100, y: 100 };
    let state = arena({
      maze: grid(320, 320, ring(hole)),
      ghosts: [ghost(hole, UP)],
    });
    for (let tick = 1; tick <= 120; tick++) {
      state = realStep(state, NO_INPUT);
      expect(state.cleared, `tick ${tick}`).toBe(false);
    }
    expect(state.ghosts).toHaveLength(1);
  });

  it("the last snipe hit on its spear half leaves a ghost, so the level is not cleared", () => {
    const after = realStep(
      arena({
        snipes: [snipe(at, LEFT)],
        shots: [shot(halves(at, LEFT).spear, DOWN)],
      }),
      NO_INPUT,
    );
    expect(after.snipes).toEqual([]);
    expect(after.ghosts).toHaveLength(1);
    expect(after.cleared).toBe(false);
  });

  it("killing the last ghost clears the level, with its 10 and the bonus", () => {
    const state = arena({
      lives: 3,
      ghosts: [ghost(at, UP, { fresh: true })],
      shots: [fromLeft],
    });
    const after = realStep(state, NO_INPUT);
    expect(after.cleared).toBe(true);
    expect(after.score).toBe(GHOST_POINTS + levelBonus(3, 1));
  });

  it("a snipe's shot that kills the last ghost clears the level, with only the bonus", () => {
    const state = arena({
      lives: 3,
      ghosts: [ghost(at, UP, { fresh: true })],
      snipeShots: [shot({ x: at.x + 2, y: at.y }, LEFT)],
    });
    const after = realStep(state, NO_INPUT);
    expect(after.cleared).toBe(true);
    expect(after.score).toBe(levelBonus(3, 1));
  });
});

describe("2.5 Bullets: a shot hits only the first of the entities it covers", () => {
  const at = { x: 150, y: 150 };

  it("a snipe before a ghost: the player's shot entering both kills only the snipe", () => {
    // Going right, the snipe's left half is its face half: no ghost comes from it.
    const after = step(
      arena({
        hives: [{ x: 280, y: 280 }],
        snipes: [snipe(at, RIGHT)],
        ghosts: [ghost(at, UP, { fresh: true })],
        shots: [shot({ x: at.x - 2, y: at.y }, RIGHT)],
      }),
      NO_INPUT,
    );
    expect(after.snipes).toEqual([]);
    expect(after.ghosts.map(look)).toEqual([expected(at, UP, false)]);
    expect(after.shots).toEqual([]);
    expect(after.score).toBe(SNIPE_POINTS);
  });

  it("a hive before a ghost: the shot gives the hive a hit and leaves the ghost", () => {
    const after = step(
      arena({
        hives: [{ x: at.x, y: at.y }],
        ghosts: [ghost(at, UP, { fresh: true })],
        shots: [shot({ x: at.x - 2, y: at.y }, RIGHT)],
      }),
      NO_INPUT,
    );
    expect(after.hives.map((h) => h.hits)).toEqual([1]);
    expect(after.ghosts).toHaveLength(1);
    expect(after.score).toBe(0);
  });

  it("of two ghosts on the same cells, only the one that appeared first", () => {
    const a = ghost(at, UP, { fresh: true });
    const b = ghost(at, DOWN, { fresh: true });
    for (const ghosts of [
      [a, b],
      [b, a],
    ]) {
      const after = step(
        arena({
          hives: [{ x: 280, y: 280 }],
          ghosts,
          shots: [shot({ x: at.x - 2, y: at.y }, RIGHT)],
        }),
        NO_INPUT,
      );
      expect(after.ghosts.map(look)).toEqual([
        expected(at, dirOf(ghosts[1]), false),
      ]);
      expect(after.score).toBe(GHOST_POINTS);
    }
  });

  it("the player comes last: a snipe's shot over a ghost and the player kills only the ghost", () => {
    const PL = { x: 100, y: 100 };
    const after = step(
      arena({
        player: PL,
        hives: [{ x: 280, y: 280 }],
        ghosts: [ghost({ x: 98, y: 100 }, UP, { fresh: true })],
        snipeShots: [shot({ x: 99, y: 100 }, RIGHT)],
      }),
      NO_INPUT,
    );
    expect(after.ghosts).toEqual([]);
    expect(after.snipeShots).toEqual([]);
    expect(after.respawn).toBe(0);
    expect(after.lives).toBe(arena({}).lives);
  });

  it("a shot that already covers a ghost hits it there, before moving", () => {
    // Moving first, either shot would leave the ghost's cells.
    for (const s of [
      { shots: [shot({ x: at.x + 1, y: at.y }, RIGHT)] },
      { snipeShots: [shot({ x: at.x - 1, y: at.y }, LEFT)] },
    ]) {
      const after = step(
        arena({
          hives: [{ x: 280, y: 280 }],
          ghosts: [ghost(at, UP, { fresh: true })],
          ...s,
        }),
        NO_INPUT,
      );
      expect(after.ghosts).toEqual([]);
      expect(after.shots).toEqual([]);
      expect(after.snipeShots).toEqual([]);
    }
  });

  it("a ghost that steps onto a shot is hit there on the next tick", () => {
    // The ghost goes straight down onto the row the shot flies along; the shot, going right,
    // is on the ghost's right column after the ghost's step, and would leave it on its move.
    const g = { x: 150, y: 148 };
    let state = arena({
      hives: [{ x: 280, y: 280 }],
      ghosts: [ghost(g, DOWN, { straight: true })],
      shots: [shot({ x: 150, y: 150 }, RIGHT)],
    });
    state = step(state, NO_INPUT);
    expect(where(state.ghosts[0])).toEqual({ x: 150, y: 149 });
    expect(where(state.shots[0])).toEqual({ x: 151, y: 150 });
    state = step(state, NO_INPUT);
    expect(state.ghosts).toEqual([]);
    expect(state.shots).toEqual([]);
    expect(state.score).toBe(GHOST_POINTS);
  });
});

describe("2.2 Player / 2.4 Ghosts: ghosts make a respawn spot unsafe; the respawn comes last in the tick", () => {
  // The maze is open, 16 x 20 blocks of 16 x 12 cells (2.10), the first block's walls being
  // at column 8 and row 6 as in a generated maze. The player died at the start of block
  // (0, 0), so the farthest block is (8, 10), whose start position is (142, 130); it covers
  // columns 136 to 151 and rows 126 to 137, and with the 8 blocks around it, columns 120 to
  // 167 and rows 114 to 149. A hive far from there keeps the level from being cleared.
  const open = createGrid(256, 240, () => "open");
  const died = { x: 14, y: 10 };
  const SPOT = { x: 142, y: 130 };
  const BLOCK_W = 16;
  const BLOCK_H = 12;

  function dying(ghosts: readonly Ghost[], respawn = 1): GameState {
    return arena({
      maze: open,
      player: died,
      respawn,
      lives: 3,
      hives: [{ x: 40, y: 30 }],
      ghosts,
    });
  }

  // The 3 x 3 blocks around the block of a start position `p`.
  function around(p: Point): Box {
    const col = Math.floor((p.x - 8) / BLOCK_W);
    const row = Math.floor((p.y - 6) / BLOCK_H);
    return {
      x: 8 + (col - 1) * BLOCK_W,
      y: 6 + (row - 1) * BLOCK_H,
      width: 3 * BLOCK_W,
      height: 3 * BLOCK_H,
    };
  }

  it("comes back at the farthest block with no ghost near", () => {
    const after = step(
      dying([ghost({ x: 30, y: 60 }, UP, { fresh: true })]),
      NO_INPUT,
    );
    expect(after.respawn).toBe(0);
    expect(where(after.player)).toEqual(SPOT);
  });

  it.each([
    ["in that block", { x: 142, y: 130 }],
    ["in a block next to it", { x: 160, y: 140 }],
    ["in the corner of the blocks around it", { x: 120, y: 114 }],
  ])("does not come back where a ghost is %s", (_, at) => {
    const after = step(dying([ghost(at, UP, { fresh: true })]), NO_INPUT);
    expect(after.respawn).toBe(0);
    expect(where(after.player)).not.toEqual(SPOT);
    expect(
      overlaps(open, around(after.player), ghostBox(after.ghosts[0])),
    ).toBe(false);
  });

  it("judges safety by where the ghosts are after they step on that tick", () => {
    // Just below the blocks around the farthest one, stepping up into them on the tick.
    const into = step(
      dying([ghost({ x: 140, y: 150 }, UP, { straight: true })]),
      NO_INPUT,
    );
    expect(where(into.ghosts[0])).toEqual({ x: 140, y: 149 });
    expect(into.respawn).toBe(0);
    expect(where(into.player)).not.toEqual(SPOT);
    // Just inside them, stepping down out of them on the tick.
    const out = step(
      dying([ghost({ x: 140, y: 149 }, DOWN, { straight: true })]),
      NO_INPUT,
    );
    expect(where(out.ghosts[0])).toEqual({ x: 140, y: 150 });
    expect(out.respawn).toBe(0);
    expect(where(out.player)).toEqual(SPOT);
    // Just below, not stepping on the tick.
    const still = step(
      dying([ghost({ x: 140, y: 150 }, UP, { straight: true, fresh: true })]),
      NO_INPUT,
    );
    expect(where(still.ghosts[0])).toEqual({ x: 140, y: 150 });
    expect(where(still.player)).toEqual(SPOT);
  });

  it("a player who comes back on a tick does not move on it, and may fire on it", () => {
    const ghosts = [ghost({ x: 30, y: 60 }, UP, { fresh: true })];
    const moved = step(dying(ghosts), hold({ moveX: 1, moveY: 1 }));
    expect(moved.respawn).toBe(0);
    expect(where(moved.player)).toEqual(SPOT);
    const fired = step(dying(ghosts), hold({ fireX: 1 }));
    expect(fired.respawn).toBe(0);
    expect(fired.shots).toEqual([
      shot({ x: SPOT.x + PLAYER, y: SPOT.y + 1 }, RIGHT),
    ]);
  });

  it("a player out of play does not block a ghost on the tick it comes back", () => {
    // The ghost, far from the spot, steps onto where the player died.
    const after = step(
      dying([ghost({ x: 13, y: 9 }, DOWN_RIGHT, { straight: true })]),
      NO_INPUT,
    );
    expect(after.respawn).toBe(0);
    expect(where(after.player)).toEqual(SPOT);
    expect(look(after.ghosts[0])).toEqual(
      expected({ x: 14, y: 10 }, DOWN_RIGHT, true),
    );
  });
});
