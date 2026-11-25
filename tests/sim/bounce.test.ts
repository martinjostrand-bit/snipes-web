import { describe, expect, it } from "vitest";
import { cellAt, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.4, 2.5, 2.6, 2.10, 4.3, 6.2 and 9.1 WP 16: bouncing diagonal shots in whole games,
// run headless from a seed, a skill level and scripted input.
//
// Every tick, every shot in flight is accounted for. A player's shot (`state.shots`) either
// moved one cell along its direction (`dx`, `dy`) from where it was, its next step being open
// (2.10); or bounced: it is where it was, it is diagonal, its next step was blocked, and its
// direction turned as 2.5 says; or it is new, just outside the player's footprint in its
// direction (2.10). No shot bounces more than 8 times. A snipe's shot (`state.snipeShots`)
// either moved on along its direction or is new, just outside a snipe's footprint in the
// snipe's direction (2.4): it never bounces. No cell covered by a shot is a wall (6.2). At
// letters without bouncing, no shot bounces. The same seed and input log give the same game.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];

const PLAYER = 4;
const SHOT = 2;
const SNIPE_W = 4;
const SNIPE_H = 2;
const MOST = 8; // 2.5: N is at most 8
const MINUTE = 60 * 60;
const SLOW = 120_000;

const UP: Dir = [0, -1];
const UP_RIGHT: Dir = [1, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const DOWN_LEFT: Dir = [-1, 1];
const LEFT: Dir = [-1, 0];
const UP_LEFT: Dir = [-1, -1];
const DIAGONALS: readonly Dir[] = [UP_RIGHT, DOWN_RIGHT, DOWN_LEFT, UP_LEFT];
const STRAIGHTS: readonly Dir[] = [UP, RIGHT, DOWN, LEFT];
const AXES: Axis[] = [-1, 0, 1];

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

function wrapped(maze: Grid, p: Point): Point {
  return { x: mod(p.x, maze.width), y: mod(p.y, maze.height) };
}

function plus(p: Point, [dx, dy]: Dir): Point {
  return { x: p.x + dx, y: p.y + dy };
}

function at(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function dirOf(s: { readonly dx: number; readonly dy: number }): Dir {
  return [(s.dx + 0) as Axis, (s.dy + 0) as Axis];
}

function same(a: Dir, b: Dir): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function diagonal([dx, dy]: Dir): boolean {
  return dx !== 0 && dy !== 0;
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

// Spec 2.10: whether a shot's footprint at p covers no wall, with wrap-around.
function fits(maze: Grid, p: Point): boolean {
  for (let dy = 0; dy < SHOT; dy++) {
    for (let dx = 0; dx < SHOT; dx++) {
      if (cellAt(maze, { x: p.x + dx, y: p.y + dy }) === "wall") return false;
    }
  }
  return true;
}

// Spec 2.10: whether a shot at p going d may not move on, and which straight positions on
// the way are blocked.
function blockedAt(maze: Grid, p: Point, [dx, dy]: Dir) {
  const across = !fits(maze, { x: p.x + dx, y: p.y });
  const down = !fits(maze, { x: p.x, y: p.y + dy });
  const blocked =
    !fits(maze, { x: p.x + dx, y: p.y + dy }) ||
    (diagonal([dx, dy]) && across && down);
  return { blocked, across, down };
}

// Spec 2.5: the direction a diagonal shot at p going d bounces to, and what kind of bounce.
function bounce(maze: Grid, p: Point, d: Dir): { dir: Dir; kind: string } {
  const { across, down } = blockedAt(maze, p, d);
  if (across && !down) return { dir: [(0 - d[0]) as Axis, d[1]], kind: "dx" };
  if (down && !across) return { dir: [d[0], (0 - d[1]) as Axis], kind: "dy" };
  return { dir: [(0 - d[0]) as Axis, (0 - d[1]) as Axis], kind: "both" };
}

// Spec 2.10: where a shot fired d appears, next to a footprint of width x height at p.
function spawnNext(p: Point, width: number, height: number, [dx, dy]: Dir) {
  return {
    x: dx < 0 ? p.x - SHOT : dx > 0 ? p.x + width : p.x + (width - SHOT) / 2,
    y: dy < 0 ? p.y - SHOT : dy > 0 ? p.y + height : p.y + (height - SHOT) / 2,
  };
}

function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

// A scripted input log: new movement and fire keys every 20 ticks, three times in four a
// diagonal fire key; Space now and then.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  let keys = NO_INPUT;
  for (let t = 0; t < ticks; t++) {
    if (t % 20 === 0) {
      const fire = draw(4) === 0 ? STRAIGHTS[draw(4)] : DIAGONALS[draw(4)];
      keys = {
        moveX: AXES[draw(3)],
        moveY: AXES[draw(3)],
        fast: draw(8) === 0,
        fireX: fire[0],
        fireY: fire[1],
      };
    }
    log.push(keys);
  }
  return log;
}

interface Watch {
  readonly problems: string[];
  readonly kinds: Map<string, number>;
  /** The bounces of each player's shot in flight, in the order of `state.shots`. */
  counts: number[];
  most: number;
  diagonalShots: number;
}

// Spec 2.4, 2.5, 2.10 and 6.2: every shot after the tick from `before` to `after`, accounted
// for.
function check(
  watch: Watch,
  before: GameState,
  after: GameState,
  tick: number,
): void {
  const { maze } = after;
  const report = (what: string): void => {
    if (watch.problems.length < 10) {
      watch.problems.push(`tick ${tick}: ${what}`);
    }
  };
  const counts: number[] = [];
  for (const a of after.shots) {
    const d = dirOf(a);
    if (!inside(maze, a) || !fits(maze, a)) {
      report(`a player's shot at ${a.x},${a.y} covers a wall`);
    }
    let count: number | undefined;
    for (const [i, b] of before.shots.entries()) {
      const bd = dirOf(b);
      const { blocked } = blockedAt(maze, b, bd);
      if (!blocked && same(bd, d) && at(wrapped(maze, plus(b, bd)), a)) {
        count = watch.counts[i];
        break;
      }
      if (blocked && diagonal(bd) && at(b, a)) {
        const turn = bounce(maze, b, bd);
        if (same(turn.dir, d)) {
          count = watch.counts[i] + 1;
          watch.kinds.set(turn.kind, (watch.kinds.get(turn.kind) ?? 0) + 1);
          break;
        }
      }
    }
    if (count === undefined) {
      if (at(wrapped(maze, spawnNext(after.player, PLAYER, PLAYER, d)), a)) {
        count = 0;
        if (diagonal(d)) watch.diagonalShots++;
      } else {
        report(
          `a player's shot at ${a.x},${a.y} going ${d.join(",")} came from nowhere`,
        );
        count = 0;
      }
    }
    if (count > MOST) report(`a shot bounced ${count} times`);
    watch.most = Math.max(watch.most, count);
    counts.push(count);
  }
  watch.counts = counts;

  for (const a of after.snipeShots) {
    const d = dirOf(a);
    if (!inside(maze, a) || !fits(maze, a)) {
      report(`a snipe's shot at ${a.x},${a.y} covers a wall`);
    }
    const moved = before.snipeShots.some(
      (b) =>
        same(dirOf(b), d) &&
        !blockedAt(maze, b, d).blocked &&
        at(wrapped(maze, plus(b, d)), a),
    );
    const fired = after.snipes.some(
      (s) =>
        same(dirOf(s), d) &&
        at(wrapped(maze, spawnNext(s, SNIPE_W, SNIPE_H, d)), a),
    );
    if (!moved && !fired) {
      report(
        `a snipe's shot at ${a.x},${a.y} going ${d.join(",")} came from nowhere`,
      );
    }
  }
}

function play(seed: number, skill: string, ticks: number): Watch {
  let state: GameState = { ...createGame(seed, skill), lives: 1000 };
  const watch: Watch = {
    problems: [],
    kinds: new Map(),
    counts: [],
    most: 0,
    diagonalShots: 0,
  };
  for (const [i, keys] of inputLog(seed + 1, ticks).entries()) {
    const before = state;
    state = step(state, keys);
    check(watch, before, state, i + 1);
    if (state.cleared || state.gameOver) break;
  }
  return watch;
}

// ===========================================================================================

describe("6.2 Invariants: shots in whole games at letters with bouncing (2.5, 2.10)", () => {
  const cases = [
    [31, "G5"],
    [32, "L9"],
    [33, "R3"],
    [34, "W7"],
    [35, "Z9"],
  ] as const;
  const seen = new Map<string, Watch>();
  const watchOf = (seed: number, skill: string): Watch => {
    const key = `${seed} ${skill}`;
    let w = seen.get(key);
    if (w === undefined) {
      w = play(seed, skill, 2 * MINUTE);
      seen.set(key, w);
    }
    return w;
  };

  it.each(cases)(
    "seed %d at %s, two minutes of moving and firing: every shot moves, bounces or is new as 2.5 says",
    (seed, skill) => {
      expect(watchOf(seed, skill).problems).toEqual([]);
    },
    SLOW,
  );

  it(
    "the player's diagonal shots bounce in these games, each kind of bounce, more than once",
    () => {
      // Guard: the checks above saw bounces, so they checked something.
      const kinds = new Map<string, number>();
      let most = 0;
      let diagonalShots = 0;
      for (const [seed, skill] of cases) {
        const w = watchOf(seed, skill);
        for (const [k, n] of w.kinds) kinds.set(k, (kinds.get(k) ?? 0) + n);
        most = Math.max(most, w.most);
        diagonalShots += w.diagonalShots;
      }
      expect(diagonalShots).toBeGreaterThan(50);
      for (const kind of ["dx", "dy", "both"]) {
        expect(kinds.get(kind) ?? 0, kind).toBeGreaterThan(0);
      }
      expect(most).toBeGreaterThan(1);
    },
    SLOW,
  );
});

describe("6.2 Invariants: no shot bounces at letters without bouncing (2.5, 2.6)", () => {
  it.each([
    [41, "A5"],
    [42, "F9"],
    [43, "P3"],
  ] as const)(
    "seed %d at %s, two minutes of moving and firing",
    (seed, skill) => {
      const w = play(seed, skill, 2 * MINUTE);
      expect(w.problems).toEqual([]);
      expect([...w.kinds.values()].reduce((a, b) => a + b, 0)).toBe(0);
      // Guard: diagonal shots were fired, so they could have bounced.
      expect(w.diagonalShots).toBeGreaterThan(10);
    },
    SLOW,
  );
});

describe("6.2 Determinism with bouncing shots", () => {
  it.each([0, 7, 2 ** 32 - 1])(
    "seed %d at L9 and the same input log give the same game",
    (seed) => {
      const log = inputLog(seed + 5, MINUTE);
      let a = createGame(seed, "L9");
      let b = createGame(seed, "L9");
      for (const keys of log) {
        a = step(a, keys);
        b = step(b, keys);
      }
      expect(a).toEqual(b);
    },
    SLOW,
  );
});
