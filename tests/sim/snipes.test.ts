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

// Spec 2.4, 2.5, 2.6, 2.10, 4.3, 6.2 and 9.1 WP 10: snipes in whole games and in rough grids,
// run headless. `state.snipes` are the snipes in the order they appeared, each a 4 x 2
// footprint (`x`, `y` its top-left cell) with its direction (`dx`, `dy`) and turning sense
// `turn` (1 clockwise on the screen, -1 anticlockwise); `state.snipeShots` are their shots in
// flight, 2 x 2 footprints with a direction, like the player's in `state.shots`.
//
// - Every step of a snipe is checked against the test's own model of 2.4: where it goes, the
//   direction it ends with, the PRNG draws it uses (one `nextFloat` each, in the order 2.4
//   gives, nothing else), the shot it fires and when it steps next. Hives count like walls
//   in the corner-gap test for a snipe (2.4, spec v0.11).
// - In whole games, every tick: no cell covered by a snipe or a snipe's shot is a wall, no
//   snipe covers a hive, the enemies stay within the digit's maximum, and every snipe shot
//   either moved one cell along its line or has just been fired by a snipe (6.2).
//
// 2.4 does not fix the order of the list a random direction is taken from, only that it is
// fixed, so the tests learn it from the game first. Ghosts come with WP 15, so whole games use
// letters without ghosts (A to C).
//
// Spec 2.2 and 9.1 WP 11: a snipe's shot that reaches the player and a snipe that touches it
// kill the player: `state.lives` goes down by one, and `state.respawn` is above 0 while the
// player is out of play, waiting to come back somewhere else. Where a test follows a snipe's
// steps, or measures how it closes in, it stops at the player's death.

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

const PLAYER = 4;
const SHOT = 2;
const HIVE = 4;
const SNIPE_W = 4;
const SNIPE_H = 2;
const KEEP = 3 / 4;
const RANDOM_TURN = 1 / 4;
const STRAIGHT_WAIT = 10;
const DIAGONAL_WAIT = 13;
const MINUTE = 60 * 60;
const MAX_ENEMIES = [10, 20, 30, 40, 60, 80, 100, 120, 150]; // 2.6, digits 1 to 9
const ACCURACY = [
  2, 3, 4, 3, 4, 4, 3, 4, 3, 4, 4, 5, 3, 4, 3, 4, 3, 4, 3, 4, 4, 5, 4, 4, 5, 5,
]; // 2.6, letters A to Z
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const AXES: Axis[] = [-1, 0, 1];
const SLOW = 120_000;

// The 8 directions clockwise on the screen.
const CLOCKWISE: readonly Dir[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

function same(a: Dir, b: Dir): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function index(d: Dir): number {
  return CLOCKWISE.findIndex((c) => same(c, d));
}

function rotate(d: Dir, k: number): Dir {
  return CLOCKWISE[(((index(d) + k) % 8) + 8) % 8];
}

function dirOf(s: { readonly dx: number; readonly dy: number }): Dir {
  return [s.dx as Axis, s.dy as Axis];
}

function diagonal([dx, dy]: Dir): boolean {
  return dx !== 0 && dy !== 0;
}

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

function wrapped(maze: Grid, p: Point): Point {
  return { x: mod(p.x, maze.width), y: mod(p.y, maze.height) };
}

function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

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

function skip(rng: Rng, n: number): Rng {
  let r = rng;
  for (let i = 0; i < n; i++) r = nextFloat(r)[1];
  return r;
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
  const offset = mod(a - b, size);
  return offset < bLength || offset > size - aLength;
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

function snipeBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SNIPE_W, height: SNIPE_H };
}

function shotBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SHOT, height: SHOT };
}

function hiveBox(p: Point): Box {
  return { x: p.x, y: p.y, width: HIVE, height: HIVE };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
}

// Spec 2.4: where a snipe at `p` firing d puts its shot, wrapped.
function shotStart(maze: Grid, p: Point, [dx, dy]: Dir): Point {
  return wrapped(maze, {
    x: dx < 0 ? p.x - SHOT : dx > 0 ? p.x + SNIPE_W : p.x + 1,
    y: dy < 0 ? p.y - SHOT : dy > 0 ? p.y + SNIPE_H : p.y,
  });
}

// --- The test's own model of a snipe's step (2.4) ------------------------------------------

// The shortest signed distance from a to b on an axis of `size` cells; exactly half the
// axis counts as positive.
function signed(a: number, b: number, size: number): number {
  const d = mod(b - a, size);
  return d > size / 2 ? d - size : d;
}

function toward(maze: Grid, from: Point, player: Point) {
  const dx = signed(from.x, player.x, maze.width);
  const dy = signed(from.y, player.y, maze.height);
  let d: Dir;
  if (Math.abs(dx) < 2) d = [0, dy < 0 ? -1 : 1];
  else if (Math.abs(dy) < 2) d = [dx < 0 ? -1 : 1, 0];
  else d = [dx < 0 ? -1 : 1, dy < 0 ? -1 : 1];
  return { d, dx, dy };
}

function snipeOpen(maze: Grid, hives: readonly Point[], p: Point): boolean {
  const box = snipeBox(p);
  return (
    clear(maze, box) && !hives.some((h) => overlaps(maze, box, hiveBox(h)))
  );
}

// Spec 2.4 (v0.11): a step is open for a snipe when its footprint there covers no wall and
// no hive cell and it is not a diagonal through a corner gap. For a snipe, a straight position
// on the way of a diagonal counts as blocked when it covers a wall or a hive cell, so it cannot
// squeeze between a hive and a wall or between two hives.
function canStep(
  maze: Grid,
  hives: readonly Point[],
  p: Point,
  d: Dir,
): boolean {
  const to = { x: p.x + d[0], y: p.y + d[1] };
  if (!snipeOpen(maze, hives, to)) return false;
  if (!diagonal(d)) return true;
  const across = { x: to.x, y: p.y };
  const down = { x: p.x, y: to.y };
  return snipeOpen(maze, hives, across) || snipeOpen(maze, hives, down);
}

// Whether a diagonal step is refused only because a hive blocks a straight position on the
// way: with walls alone it would be allowed.
function hiveGap(
  maze: Grid,
  hives: readonly Point[],
  p: Point,
  d: Dir,
): boolean {
  const to = { x: p.x + d[0], y: p.y + d[1] };
  if (!diagonal(d) || !snipeOpen(maze, hives, to)) return false;
  if (canStep(maze, hives, p, d)) return false;
  const across = { x: to.x, y: p.y };
  const down = { x: p.x, y: to.y };
  return clear(maze, snipeBox(across)) || clear(maze, snipeBox(down));
}

interface Prediction {
  readonly at: Point;
  readonly dir: Dir;
  readonly draws: number;
  readonly shot: Shot | undefined;
  /** Ticks to the next step. */
  readonly wait: number;
  readonly kind: string[];
}

function predict(
  maze: Grid,
  hives: readonly Point[],
  player: Point,
  snipe: Snipe,
  rng: Rng,
  accuracy: number,
  randomList: readonly Dir[],
): Prediction {
  const vs = values(rng, 8);
  let n = 0;
  const draw = (): number => vs[n++];
  const kind: string[] = [];
  const from = { x: snipe.x, y: snipe.y };
  let dir = dirOf(snipe);
  let moved = false;
  const tried = (c: Dir): boolean => {
    if (hiveGap(maze, hives, from, c) && !kind.includes("hive gap")) {
      kind.push("hive gap");
    }
    return canStep(maze, hives, from, c);
  };
  if (draw() < KEEP) {
    if (tried(dir)) {
      moved = true;
      kind.push("kept");
    } else {
      kind.push("blocked");
    }
  }
  if (!moved) {
    let d: Dir;
    if (draw() < RANDOM_TURN) {
      d = randomList[Math.floor(draw() * 8)];
      kind.push("random");
    } else {
      d = toward(maze, from, player).d;
      kind.push("toward");
    }
    for (let k = 0; k < 8; k++) {
      dir = rotate(d, k * snipe.turn);
      if (tried(dir)) {
        moved = true;
        if (k > 0) kind.push("turned");
        break;
      }
    }
    if (!moved) kind.push("stuck");
  }
  const at = moved
    ? wrapped(maze, { x: from.x + dir[0], y: from.y + dir[1] })
    : from;
  const wait = moved && diagonal(dir) ? DIAGONAL_WAIT : STRAIGHT_WAIT;
  let shot: Shot | undefined;
  const aim = toward(maze, at, player);
  const aligned =
    same(aim.d, dir) &&
    (!diagonal(dir) || Math.abs(Math.abs(aim.dx) - Math.abs(aim.dy)) < 4);
  if (aligned) {
    const s = Math.floor(
      (Math.abs(aim.dx) + Math.abs(aim.dy)) / 2 ** (accuracy + 1),
    );
    if (s > 10) {
      kind.push("too far");
    } else if (draw() < 1 / 2 ** (s + 1)) {
      const start = shotStart(maze, at, dir);
      if (clear(maze, shotBox(start))) {
        shot = { x: start.x, y: start.y, dx: dir[0], dy: dir[1] };
        kind.push("fired");
      } else {
        kind.push("start on a wall");
      }
    } else {
      kind.push("held fire");
    }
  } else if (same(aim.d, dir)) {
    kind.push("off the diagonal");
  }
  return { at, dir, draws: n, shot, wait, kind };
}

// --- Games ---------------------------------------------------------------------------------

const open = createGrid(320, 320, () => "open");

let template: Snipe | undefined;

// A snipe that has just appeared, spawned by a lone hive in the open.
function newSnipe(): Snipe {
  if (template !== undefined) return template;
  const game = createGame(1, "A9");
  let state: GameState = {
    ...game,
    maze: open,
    player: { ...game.player, x: 4, y: 4 },
    hives: [{ ...game.hives[0], x: 40, y: 30, hits: 0 }],
    snipes: [],
    shots: [],
    snipeShots: [],
  };
  for (let t = 0; t < 10 * MINUTE && state.snipes.length === 0; t++) {
    state = step(state, NO_INPUT);
  }
  if (state.snipes.length === 0) throw new Error("No snipe appeared");
  template = state.snipes[0];
  return template;
}

function snipe(p: Point, d: Dir, turn: Turn): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx: d[0], dy: d[1], turn };
}

function arena(
  maze: Grid,
  player: Point,
  snipes: readonly Snipe[],
  hives: readonly Point[],
  skill: string,
  rng: Rng,
): GameState {
  const game = createGame(1, skill);
  return {
    ...game,
    maze,
    player: { ...game.player, x: player.x, y: player.y },
    hives: hives.map((h) => ({ ...game.hives[0], x: h.x, y: h.y, hits: 0 })),
    snipes,
    shots: [],
    snipeShots: [],
    rng,
  };
}

function rngIn(...ranges: (readonly [number, number])[]): Rng {
  for (let seed = 0; seed < 10_000_000; seed++) {
    const rng = createRng(seed);
    const v = values(rng, ranges.length);
    if (ranges.every(([from, to], i) => v[i] >= from && v[i] < to)) return rng;
  }
  throw new Error("No PRNG state found");
}

let learned: Dir[] | undefined;

// The fixed list a random direction is taken from, learned from the game: the direction a
// snipe in the open turns to when the keep chance fails, the random-turn chance succeeds and
// the third value is in bucket b.
function randomList(): Dir[] {
  if (learned !== undefined) return learned;
  learned = Array.from({ length: 8 }, (_, b) => {
    const state = arena(
      open,
      { x: 150, y: 300 },
      [snipe({ x: 150, y: 150 }, [-1, -1], 1)],
      [],
      "A1",
      rngIn([KEEP, 1], [0, RANDOM_TURN], [b / 8 + 1e-6, (b + 1) / 8 - 1e-6]),
    );
    return dirOf(step(state, NO_INPUT).snipes[0]);
  });
  return learned;
}

// A rough, seeded grid: scattered wall cells at one of three densities, and here and there
// two wall cells that make a corner gap for a snipe.
function roughGrid(draw: (n: number) => number, width: number, height: number) {
  const density = [14, 7, 3][draw(3)];
  const walls = new Set<string>();
  const add = (x: number, y: number): void => {
    walls.add(`${mod(x, width)},${mod(y, height)}`);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (draw(density) === 0) add(x, y);
      if (draw(60) === 0) {
        add(x + SNIPE_W, y);
        add(x, y + SNIPE_H);
      }
    }
  }
  return createGrid(width, height, ({ x, y }) =>
    walls.has(`${x},${y}`) ? "wall" : "open",
  );
}

function randomSpot(
  draw: (n: number) => number,
  maze: Grid,
  ok: (p: Point) => boolean,
): Point | undefined {
  for (let tries = 0; tries < 500; tries++) {
    const p = { x: draw(maze.width), y: draw(maze.height) };
    if (ok(p)) return p;
  }
  return undefined;
}

// For a snipe at `p` going diagonally d, two hives: one on the cell that only the horizontal
// straight position on the way covers, the other on the cell that only the vertical one
// covers, neither on the snipe nor on the diagonal position (2.4, 2.10). Not wrapped.
function gapHives(p: Point, [dx, dy]: Dir): Point[] {
  const across = {
    x: dx > 0 ? p.x + SNIPE_W : p.x - 1,
    y: dy > 0 ? p.y : p.y + SNIPE_H - 1,
  };
  const down = {
    x: dx > 0 ? p.x : p.x + SNIPE_W - 1,
    y: dy > 0 ? p.y + SNIPE_H : p.y - 1,
  };
  return [
    {
      x: dx > 0 ? across.x : across.x - HIVE + 1,
      y: dy > 0 ? across.y - HIVE + 1 : across.y,
    },
    {
      x: dx > 0 ? down.x - HIVE + 1 : down.x,
      y: dy > 0 ? down.y : down.y - HIVE + 1,
    },
  ];
}

// An open spot for a snipe within a cell or two of the hive at `h`, or undefined.
function nearSpot(
  draw: (n: number) => number,
  maze: Grid,
  h: Point,
  ok: (p: Point) => boolean,
): Point | undefined {
  for (let tries = 0; tries < 100; tries++) {
    const p = wrapped(maze, {
      x: h.x - SNIPE_W - 1 + draw(HIVE + SNIPE_W + 3),
      y: h.y - SNIPE_H - 1 + draw(HIVE + SNIPE_H + 3),
    });
    if (ok(p)) return p;
  }
  return undefined;
}

// ===========================================================================================

describe("2.4 Snipes: every step follows the rules, in rough grids with hives", () => {
  it(
    "matches the test's model in place, direction, PRNG draws, shot and next step",
    () => {
      const list = randomList();
      expect(new Set(list.map(index)).size).toBe(8);
      const problems: string[] = [];
      const kinds = new Map<string, number>();
      let checked = 0;
      for (let n = 0; n < 1500 && problems.length < 10; n++) {
        const draw = drawer(1000 + n);
        // In the long lane the player is on the snipe's rows, often far off.
        const [width, height] = [
          [48, 40],
          [64, 48],
          [200, 160],
          [800, 12],
        ][draw(4)];
        const lane = width === 800;
        const maze = roughGrid(draw, width, height);
        const hives: Point[] = [];
        for (let h = draw(4); h > 0; h--) {
          const p = randomSpot(draw, maze, (q) => clear(maze, hiveBox(q)));
          if (p) hives.push(p);
        }
        // Half the time the snipe starts next to a hive, where the hive can block the way of
        // a diagonal step (2.4).
        const by = hives.length > 0 && draw(2) === 0 ? hives[0] : undefined;
        const at =
          by === undefined
            ? randomSpot(draw, maze, (q) => snipeOpen(maze, hives, q))
            : nearSpot(draw, maze, by, (q) => snipeOpen(maze, hives, q));
        if (!at) continue;
        // A third of the time hives are put on the way of a diagonal step, where they can make
        // a corner gap with each other or with a wall, and the snipe heads that way.
        let heading = CLOCKWISE[draw(8)];
        if (draw(3) === 0) {
          heading = CLOCKWISE[1 + 2 * draw(4)];
          for (const h of gapHives(at, heading)) {
            if (
              draw(3) > 0 &&
              clear(maze, hiveBox(h)) &&
              !overlaps(maze, hiveBox(h), snipeBox(at)) &&
              hives.every((o) => !overlaps(maze, hiveBox(h), hiveBox(o)))
            ) {
              hives.push(wrapped(maze, h));
            }
          }
        }
        const player = randomSpot(
          draw,
          maze,
          (q) =>
            clear(maze, playerBox(q)) && (!lane || Math.abs(q.y - at.y) < 2),
        );
        if (!player) continue;
        const letter = LETTERS[draw(26)];
        const s = snipe(at, heading, draw(2) === 0 ? 1 : -1);
        const rng = createRng(draw(2 ** 30));
        const accuracy = ACCURACY[LETTERS.indexOf(letter)];
        const a = predict(maze, hives, player, s, rng, accuracy, list);

        const state = arena(maze, player, [s], hives, `${letter}1`, rng);
        const after = step(state, NO_INPUT);
        const what = `case ${n}: ${letter}, snipe at ${at.x},${at.y} going ${s.dx},${s.dy} sense ${s.turn}, player at ${player.x},${player.y}, ${a.kind.join(" ")}`;
        if (after.snipes.length !== 1) {
          // A hive spawned; its draws would mix with the snipe's.
          continue;
        }
        if (after.lives !== state.lives) {
          // The snipe killed the player; where the player comes back is WP 11's.
          continue;
        }
        const got = after.snipes[0];
        if (got.x !== a.at.x || got.y !== a.at.y) {
          problems.push(
            `${what}: at ${got.x},${got.y}, want ${a.at.x},${a.at.y}`,
          );
          continue;
        }
        if (!same(dirOf(got), a.dir)) {
          problems.push(
            `${what}: going ${got.dx},${got.dy}, want ${a.dir.join(",")}`,
          );
          continue;
        }
        if (got.turn !== s.turn) problems.push(`${what}: sense changed`);
        if (after.rng.state !== skip(rng, a.draws).state) {
          problems.push(`${what}: not ${a.draws} draws`);
          continue;
        }
        const want = a.shot === undefined ? [] : [a.shot];
        if (JSON.stringify(after.snipeShots) !== JSON.stringify(want)) {
          problems.push(
            `${what}: shots ${JSON.stringify(after.snipeShots)}, want ${JSON.stringify(want)}`,
          );
          continue;
        }
        // It next draws exactly when its wait is over, and not before.
        let later = after;
        let next = -1;
        for (let t = 1; t <= DIAGONAL_WAIT + 1 && next < 0; t++) {
          const before = later;
          later = step(later, NO_INPUT);
          if (later.snipes.length !== 1 || later.lives !== state.lives) break;
          if (later.rng.state !== before.rng.state) next = t;
        }
        if (
          later.snipes.length === 1 &&
          later.lives === state.lives &&
          next !== a.wait
        ) {
          problems.push(
            `${what}: next step after ${next} ticks, want ${a.wait}`,
          );
          continue;
        }
        checked++;
        for (const k of a.kind) kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
      expect(problems).toEqual([]);
      expect(checked).toBeGreaterThan(1000);
      // Guards: every part of 2.4 was met.
      for (const k of [
        "kept",
        "blocked",
        "random",
        "toward",
        "turned",
        "stuck",
        "fired",
        "held fire",
        "too far",
        "start on a wall",
        "off the diagonal",
        "hive gap",
      ]) {
        expect(kinds.get(k) ?? 0, k).toBeGreaterThan(2);
      }
    },
    SLOW,
  );
});

// --- Whole games ---------------------------------------------------------------------------

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
  /** Snipe shots fired, and those that reached the player in play and disappeared. */
  fired: number;
  reachedPlayer: number;
  readonly tick: (before: GameState, after: GameState, n: number) => void;
}

// Checks every tick of a game in `maze` whose digit allows `max` enemies.
function watch(maze: Grid, max: number): Watch {
  const w: Watch = {
    problems: [],
    fired: 0,
    reachedPlayer: 0,
    tick: (before, after, n) => {
      const report = (what: string): void => {
        if (w.problems.length < 20) w.problems.push(`tick ${n}: ${what}`);
      };
      if (after.snipes.length > max) report(`${after.snipes.length} enemies`);
      const key = (p: Shot | Snipe): string => `${p.x},${p.y},${p.dx},${p.dy}`;
      const was = new Set(before.snipes.map(key));
      // Where each snipe on the map now would put a shot fired in its direction.
      const starts = new Set(
        after.snipes.map((p) => {
          const start = shotStart(maze, p, dirOf(p));
          return `${start.x},${start.y},${p.dx},${p.dy}`;
        }),
      );
      for (const [i, s] of after.snipes.entries()) {
        const k = `snipe at ${s.x},${s.y}`;
        if (!inside(maze, s)) report(`${k} outside`);
        else if (!clear(maze, snipeBox(s))) report(`${k} on a wall`);
        // A snipe never steps onto a hive (2.4). One that is on a hive has not moved since
        // the tick before, or has just appeared: where hives spawn is WP 09's.
        const onHive = after.hives.some((h) =>
          overlaps(maze, snipeBox(s), hiveBox(h)),
        );
        const stayed = was.has(key(s));
        if (
          onHive &&
          !stayed &&
          i < after.snipes.length - before.hives.length
        ) {
          report(`${k} on a hive`);
        }
        if (index(dirOf(s)) < 0) report(`${k} going ${s.dx},${s.dy}`);
        if (s.turn !== 1 && s.turn !== -1) {
          report(`${k} with sense ${String(s.turn)}`);
        }
      }
      // Each shot in flight moved one cell along its line, or was fired this tick by a snipe
      // from where that snipe now is, in its direction.
      const old = new Set(before.snipeShots.map(key));
      const moved = new Set<string>();
      for (const s of after.snipeShots) {
        const k = `snipe shot at ${s.x},${s.y} going ${s.dx},${s.dy}`;
        if (!inside(maze, s)) report(`${k} outside`);
        else if (!clear(maze, shotBox(s))) report(`${k} on a wall`);
        const from = wrapped(maze, { x: s.x - s.dx, y: s.y - s.dy });
        const came = `${from.x},${from.y},${s.dx},${s.dy}`;
        if (old.has(came)) {
          moved.add(came);
          if (
            before.respawn === 0 &&
            overlaps(maze, shotBox(s), playerBox(before.player))
          ) {
            report(`${k} flew on through the player`);
          }
          continue;
        }
        if (!starts.has(key(s))) report(`${k} came from nowhere`);
        else w.fired++;
      }
      for (const s of before.snipeShots) {
        if (moved.has(key(s)) || before.respawn !== 0) continue;
        const next = { x: s.x + s.dx, y: s.y + s.dy };
        if (
          overlaps(maze, shotBox(s), playerBox(before.player)) ||
          overlaps(maze, shotBox(next), playerBox(before.player))
        ) {
          w.reachedPlayer++;
        }
      }
    },
  };
  return w;
}

describe("6.2 Invariants: snipes and their shots every tick of a whole game (2.4, 2.10)", () => {
  const cases = [11, 12, 13].flatMap((seed) =>
    ["A9", "B5", "C9"].map((skill) => [seed * 7919, skill] as const),
  );

  it.each(cases)(
    "seed %d at %s, a minute of random moving and firing",
    (seed, skill) => {
      let state = createGame(seed, skill);
      const checks = watch(state.maze, MAX_ENEMIES[Number(skill[1]) - 1]);
      const places = new Set<string>();
      for (const [tick, keys] of inputLog(seed + 1, MINUTE).entries()) {
        const before = state;
        state = step(state, keys);
        checks.tick(before, state, tick + 1);
        for (const s of state.snipes) places.add(`${s.x},${s.y}`);
      }
      expect(checks.problems).toEqual([]);
      // Guards: the snipes went places and fired.
      expect(places.size).toBeGreaterThan(100);
      expect(checks.fired).toBeGreaterThan(0);
    },
    SLOW,
  );

  it.each(["A1", "B1", "C1"])(
    "the player standing still in a room with a hive, at %s: the snipes kill it (WP 11)",
    (skill) => {
      // A room of 64 x 48 cells whose walls are its top row and left column.
      const room = createGrid(64, 48, ({ x, y }) =>
        x === 0 || y === 0 ? "wall" : "open",
      );
      const player = { x: 8, y: 8 };
      let state = arena(
        room,
        player,
        [],
        [{ x: 40, y: 30 }],
        skill,
        createRng(3),
      );
      const checks = watch(room, MAX_ENEMIES[0]);
      const lives = state.lives;
      let died = -1;
      for (let tick = 1; tick <= 2 * MINUTE && died < 0; tick++) {
        const before = state;
        state = step(state, NO_INPUT);
        checks.tick(before, state, tick);
        if (state.lives !== lives) died = tick;
        else expect(where(state.player)).toEqual(player);
      }
      expect(checks.problems).toEqual([]);
      expect(checks.fired).toBeGreaterThan(0);
      // Within two minutes a snipe's shot or a snipe reached it, and it lost one life.
      expect(died).toBeGreaterThan(0);
      expect(state.lives).toBe(lives - 1);
      expect(state.respawn).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe("2.4 Snipes: chase the player with some randomness", () => {
  it.each([1, 2, 3, 4, 5])(
    "in the open, a snipe far away closes in on a player standing still and kills it (PRNG seed %d)",
    (seed) => {
      // A room of 128 x 128 cells whose walls are its top row and left column, so that its
      // shots stop at a wall. The snipe starts in a far corner from the player.
      const field = createGrid(128, 128, ({ x, y }) =>
        x === 0 || y === 0 ? "wall" : "open",
      );
      let state = arena(
        field,
        { x: 64, y: 64 },
        [snipe({ x: 1, y: 1 }, [0, -1], 1)],
        [],
        "A1",
        createRng(seed),
      );
      const distance = (s: GameState): number => {
        const a = s.snipes[0];
        return (
          Math.abs(signed(a.x, s.player.x, 128)) +
          Math.abs(signed(a.y, s.player.y, 128))
        );
      };
      expect(distance(state)).toBe(126);
      const lives = state.lives;
      let near = -1;
      let died = -1;
      for (let tick = 1; tick <= MINUTE && died < 0; tick++) {
        state = step(state, NO_INPUT);
        if (state.lives !== lives) died = tick;
        else if (near < 0 && distance(state) < 24) near = tick;
      }
      // Within half a minute it is near the player, and within a minute it has killed it,
      // with a shot or by touching it (WP 11).
      expect(near).toBeGreaterThan(0);
      expect(near).toBeLessThanOrEqual(MINUTE / 2);
      expect(died).toBeGreaterThan(near);
      expect(state.lives).toBe(lives - 1);
    },
  );
});

describe("6.2 Determinism with snipes", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "seed %d and the same input log give the same snipes and shots",
    (seed) => {
      const log = inputLog(seed + 17, 2 * MINUTE);
      let a = createGame(seed, "B7");
      let b = createGame(seed, "B7");
      let fired = 0;
      for (const keys of log) {
        a = step(a, keys);
        b = step(b, keys);
        expect(a.snipes).toEqual(b.snipes);
        expect(a.snipeShots).toEqual(b.snipeShots);
        fired += a.snipeShots.length;
      }
      expect(a).toEqual(b);
      expect(fired).toBeGreaterThan(0);
    },
    SLOW,
  );
});
