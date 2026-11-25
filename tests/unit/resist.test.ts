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

// Spec 2.3, 2.5, 2.6, 2.7 and 9.1 WP 16: hives resisting snipe shots.
//
// - At the letters W to Z (2.6) a snipe's shot that reaches a hive does not damage it: the
//   hive's hits (`Hive.hits`, WP 09) stay as they were, so no number of snipe shots destroys
//   it. The shot still hits the hive, the first entity it meets (2.5), and disappears, as at
//   the other letters. At every other letter a snipe's shot damages a hive like the player's
//   shot (WP 10).
// - The player's shots damage hives at every letter, and a hive destroyed on a tick on which
//   one of them hit it gives its 100 points (2.7). A snipe's shot still kills snipes and
//   ghosts at W to Z, with no points.
//
// Hives are copies of a new game's hive whose wait for the next spawn never runs out. Each
// game keeps a second hive far from everything, so that the level is not cleared and no level
// bonus is added. Snipes and ghosts are copies of ones that have just appeared, as in the
// WP 10 and WP 15 tests.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Ghost = GameState["ghosts"][number];
type Shot = GameState["shots"][number];

const HITS = 20; // 2.3: the 20th hit destroys a hive
const HIVE_POINTS = 100; // 2.7
const KEEP = 3 / 4; // a snipe's keep chance (2.4)
const PATIENCE = 10 * 60 * 60; // ten minutes of ticks, the longest a test waits for a spawn
const NEVER = Number.MAX_SAFE_INTEGER; // a hive's wait that never runs out

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
// Spec 2.6: the letters whose hives resist snipe shots.
const RESISTING = [..."WXYZ"];

const RIGHT: Dir = [1, 0];
const DOWN: Dir = [0, 1];
const LEFT: Dir = [-1, 0];

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
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

function shot(p: Point, [dx, dy]: Dir): Shot {
  return { x: p.x, y: p.y, dx, dy };
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

const KEEPS = [0, KEEP] as const; // a snipe's keep chance succeeds (2.4)
const SURE = [0, 1 / 4096] as const; // below every fire chance 2.4 can give

// --- Games ---------------------------------------------------------------------------------

const field = grid(320, 320);
// A hive in the way of a snipe's shot fired right from (40, 100) along rows 100 and 101.
const H = { x: 60, y: 99 };
const FROM_LEFT = { x: 40, y: 100 };
// The player, and a second hive that keeps the level from being cleared, far from H.
const FAR = { x: 200, y: 160 };
const FAR_HIVE = { x: 250, y: 250 };

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
  readonly maze?: Grid;
  readonly player?: Point;
  readonly skill?: string;
  readonly hives?: readonly (Point & { readonly hits?: number })[];
  readonly snipes?: readonly Snipe[];
  readonly ghosts?: readonly Ghost[];
  readonly shots?: readonly Shot[];
  readonly snipeShots?: readonly Shot[];
  readonly rng?: Rng;
}

// A game at `skill` (W1 if not given) in `maze` (the field if not given) with only what the
// setup names, and the far hive after the hives it names.
function arena(setup: Setup): GameState {
  const g = game(setup.skill ?? "W1");
  const hives: readonly (Point & { readonly hits?: number })[] = [
    ...(setup.hives ?? []),
    FAR_HIVE,
  ];
  return {
    ...g,
    maze: setup.maze ?? field,
    player: { ...g.player, ...(setup.player ?? FAR) },
    hives: hives.map((h) => ({
      ...g.hives[0],
      x: h.x,
      y: h.y,
      hits: h.hits ?? 0,
      wait: NEVER,
    })),
    snipes: setup.snipes ?? [],
    ghosts: setup.ghosts ?? [],
    shots: setup.shots ?? [],
    snipeShots: setup.snipeShots ?? [],
    rng: setup.rng ?? g.rng,
    respawn: 0,
  };
}

function run(state: GameState, ticks: number, input = NO_INPUT): GameState {
  let current = state;
  for (let t = 0; t < ticks; t++) current = step(current, input);
  return current;
}

// The hive at p, if it is still there.
function hiveAt(state: GameState, p: Point) {
  return state.hives.find((h) => h.x === p.x && h.y === p.y);
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

let ghostTemplate: Ghost | undefined;

// A ghost that has just appeared at D1, from a snipe going right hit on its spear half (its
// right half) by a player's shot that already covers it.
function newGhost(): Ghost {
  if (ghostTemplate !== undefined) return ghostTemplate;
  const at = { x: 150, y: 150 };
  const state = step(
    {
      ...arena({ skill: "D1" }),
      snipes: [snipe(at, RIGHT)],
      shots: [shot({ x: at.x + 2, y: at.y }, DOWN)],
    },
    NO_INPUT,
  );
  if (state.ghosts.length !== 1) {
    throw new Error("No ghost appeared from a hit on a snipe's spear half");
  }
  ghostTemplate = state.ghosts[0];
  return ghostTemplate;
}

function ghost(p: Point): Ghost {
  return { ...newGhost(), x: p.x, y: p.y };
}

// ===========================================================================================

describe("2.5 Bullets / 2.6 Skill level: hives resist snipe shots only at W to Z", () => {
  it.each(LETTERS.map((l) => `${l}1`))(
    "at %s a snipe's shot that reaches a hive damages it only without the feature",
    (skill) => {
      const resists = RESISTING.includes(skill[0]);
      const begin = arena({
        skill,
        hives: [{ ...H, hits: 5 }],
        snipeShots: [shot(FROM_LEFT, RIGHT)],
      });
      const after = run(begin, 30);
      expect(hiveAt(after, H)?.hits).toBe(resists ? 5 : 6);
      // The shot hit the hive and is gone, at every letter.
      expect(after.snipeShots).toEqual([]);
      expect(after.score).toBe(0);
    },
  );

  it.each(RESISTING.map((l) => `${l}1`))(
    "at %s a hive with 19 hits survives any number of snipe shots",
    (skill) => {
      // Twelve snipe shots in a row along rows 100 and 101, reaching the hive one after
      // another.
      const shots = Array.from({ length: 12 }, (_, i) =>
        shot({ x: FROM_LEFT.x - 3 * i, y: FROM_LEFT.y }, RIGHT),
      );
      const begin = arena({
        skill,
        hives: [{ ...H, hits: HITS - 1 }],
        snipeShots: shots,
      });
      const after = run(begin, 80);
      expect(hiveAt(after, H)?.hits).toBe(HITS - 1);
      expect(after.hives).toHaveLength(2);
      // Every shot hit the hive and is gone.
      expect(after.snipeShots).toEqual([]);
      expect(after.score).toBe(0);
      expect(after.cleared).toBe(false);
    },
  );

  it.each(["A1", "D1", "G1", "M1", "T1", "V1"])(
    "at %s, without the feature, one snipe shot destroys a hive with 19 hits, with no points",
    (skill) => {
      const begin = arena({
        skill,
        hives: [{ ...H, hits: HITS - 1 }],
        snipeShots: [shot(FROM_LEFT, RIGHT)],
      });
      const after = run(begin, 30);
      expect(hiveAt(after, H)).toBeUndefined();
      expect(after.hives).toHaveLength(1);
      expect(after.score).toBe(0);
    },
  );

  it.each(RESISTING.map((l) => `${l}1`))(
    "at %s a snipe firing at the player hits a hive between them without damaging it",
    (skill) => {
      // A lane 8 rows high: the snipe keeps going right and fires at the player; its shot
      // meets the hive on the way.
      const lane = grid(400, 8);
      const h = { x: 120, y: 1 };
      let state = step(
        arena({
          skill,
          maze: lane,
          player: { x: 140, y: 2 },
          hives: [h],
          snipes: [snipe({ x: 100, y: 2 }, RIGHT)],
          rng: rngIn(KEEPS, SURE),
        }),
        NO_INPUT,
      );
      expect(state.snipeShots).toHaveLength(1);
      state = run({ ...state, snipes: [] }, 30);
      expect(state.snipeShots).toEqual([]);
      expect(hiveAt(state, h)?.hits).toBe(0);
      // The same at T, which differs from W only in this feature: one hit.
      let control = step(
        arena({
          skill: "T1",
          maze: lane,
          player: { x: 140, y: 2 },
          hives: [h],
          snipes: [snipe({ x: 100, y: 2 }, RIGHT)],
          rng: rngIn(KEEPS, SURE),
        }),
        NO_INPUT,
      );
      control = run({ ...control, snipes: [] }, 30);
      expect(hiveAt(control, h)?.hits).toBe(1);
    },
  );
});

describe("2.3 Hives / 2.7 Scoring: the player's shots still damage resisting hives", () => {
  it.each(RESISTING.map((l) => `${l}1`))(
    "at %s a player's shot hits a hive once, and its 20th hit destroys it for 100 points",
    (skill) => {
      const once = run(
        arena({
          skill,
          hives: [{ ...H, hits: 5 }],
          shots: [shot(FROM_LEFT, RIGHT)],
        }),
        30,
      );
      expect(hiveAt(once, H)?.hits).toBe(6);
      expect(once.shots).toEqual([]);
      const last = run(
        arena({
          skill,
          hives: [{ ...H, hits: HITS - 1 }],
          shots: [shot(FROM_LEFT, RIGHT)],
        }),
        30,
      );
      expect(hiveAt(last, H)).toBeUndefined();
      expect(last.score).toBe(HIVE_POINTS);
    },
  );

  // A player's shot from the left and a snipe's shot from the right reach the hive on the same
  // tick, the first.
  const both = {
    shots: [shot({ x: H.x - 2, y: H.y }, RIGHT)],
    snipeShots: [shot({ x: H.x + 4, y: H.y + 2 }, LEFT)],
  };

  it.each([
    ["T1", "W1"],
    ["U1", "X1"],
    ["V1", "Y1"],
  ] as const)(
    "a hive with 18 hits, hit by a player's and a snipe's shot on one tick: destroyed at %s, not at %s",
    (off, on) => {
      const a = step(
        arena({ skill: off, hives: [{ ...H, hits: HITS - 2 }], ...both }),
        NO_INPUT,
      );
      expect(a.shots).toEqual([]);
      expect(a.snipeShots).toEqual([]);
      expect(hiveAt(a, H)).toBeUndefined();
      expect(a.score).toBe(HIVE_POINTS);
      const b = step(
        arena({ skill: on, hives: [{ ...H, hits: HITS - 2 }], ...both }),
        NO_INPUT,
      );
      expect(b.shots).toEqual([]);
      expect(b.snipeShots).toEqual([]);
      expect(hiveAt(b, H)?.hits).toBe(HITS - 1);
      expect(b.score).toBe(0);
    },
  );

  it.each(RESISTING.map((l) => `${l}1`))(
    "at %s a hive with 19 hits, hit by a player's and a snipe's shot on one tick, is destroyed for 100 points",
    (skill) => {
      const after = step(
        arena({ skill, hives: [{ ...H, hits: HITS - 1 }], ...both }),
        NO_INPUT,
      );
      expect(hiveAt(after, H)).toBeUndefined();
      expect(after.score).toBe(HIVE_POINTS);
    },
  );
});

describe("2.5 Bullets: at W to Z a snipe's shot still kills snipes and ghosts", () => {
  it.each(RESISTING.map((l) => `${l}1`))(
    "at %s a snipe's shot kills a snipe, with no points",
    (skill) => {
      // The shot covers the face half (the left half) of a snipe going right.
      const at = { x: 150, y: 150 };
      const after = step(
        arena({
          skill,
          snipes: [snipe(at, RIGHT)],
          snipeShots: [shot(at, DOWN)],
        }),
        NO_INPUT,
      );
      expect(after.snipes).toEqual([]);
      expect(after.snipeShots).toEqual([]);
      expect(after.score).toBe(0);
    },
  );

  it.each(RESISTING.map((l) => `${l}1`))(
    "at %s a snipe's shot kills a ghost, with no points",
    (skill) => {
      const at = { x: 150, y: 150 };
      const after = step(
        arena({ skill, ghosts: [ghost(at)], snipeShots: [shot(at, DOWN)] }),
        NO_INPUT,
      );
      expect(after.ghosts).toEqual([]);
      expect(after.snipeShots).toEqual([]);
      expect(after.score).toBe(0);
    },
  );
});

describe("2.6 Skill level: resisting hives change only the hits snipe shots do to hives", () => {
  // Pairs of letters that differ only in hives resisting snipe shots.
  const PAIRS = [
    ["T", "W"],
    ["U", "X"],
    ["V", "Y"],
  ] as const;

  // What the rules decide in a tick, but for the hives' hits.
  function plain(s: GameState) {
    return {
      rng: s.rng,
      player: s.player,
      hives: s.hives.map((h) => ({ ...h, hits: 0 })),
      snipes: s.snipes,
      ghosts: s.ghosts,
      shots: s.shots,
      snipeShots: s.snipeShots,
      lives: s.lives,
      respawn: s.respawn,
      score: s.score,
      cleared: s.cleared,
      gameOver: s.gameOver,
    };
  }

  it.each(PAIRS)(
    "%s and %s give the same game but for the hits a snipe's shot does to a hive",
    (off, on) => {
      // A snipe's shot reaches the hive, another passes below it, the player fires at a
      // snipe, and a ghost and a snipe move about.
      const setup = (skill: string): Setup => ({
        skill,
        player: { x: 150, y: 100 },
        hives: [{ ...H, hits: 3 }],
        snipes: [snipe({ x: 180, y: 140 }, LEFT)],
        ghosts: [ghost({ x: 120, y: 160 })],
        snipeShots: [
          shot(FROM_LEFT, RIGHT),
          shot({ x: FROM_LEFT.x, y: H.y + 6 }, RIGHT),
        ],
      });
      let a = arena(setup(`${off}1`));
      let b = arena(setup(`${on}1`));
      const keys: InputState = { ...NO_INPUT, fireX: 1, fireY: 1 };
      for (let t = 1; t <= 40; t++) {
        a = step(a, keys);
        b = step(b, keys);
        expect(plain(b), `tick ${t}`).toEqual(plain(a));
      }
      expect(hiveAt(a, H)?.hits).toBe(4);
      expect(hiveAt(b, H)?.hits).toBe(3);
    },
  );
});
