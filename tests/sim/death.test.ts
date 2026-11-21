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

// Spec 2.2, 2.4, 2.10, 4.3, 6.2, 9 (M3) and 9.1 WP 11: whole games run headless, in which
// snipes kill the player. `state.lives` is the number of lives left; `state.respawn` is 0
// while the player is in play and above 0 from the tick it dies until it comes back.
//
// - Standing still, the player eventually dies, and the death costs one life (M3, WP 11).
// - Every tick of a game: the lives are a whole number, never below 0, and go down by one
//   exactly when the player dies; while the player is in play, no cell of its footprint is a
//   wall, no snipe shares a cell with it (that would have killed it, 2.10), and no snipe's shot
//   that was already in flight is on it. Out of play it neither moves nor fires; after a short
//   delay it comes back as soon as a block is safe, at the start position of a safe block: no
//   hive cell in it and no snipe or snipe shot in it or the 8 blocks around it (2.2, v0.12).
// - The same seed and input log give the same game, deaths included (6.2).
//
// Ghosts come with WP 15, so the games use letters without ghosts (A to C). The seeds were
// picked so that a death comes early; up to the first death, the game is the same as before
// WP 11.

type Axis = InputState["moveX"];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4;
const SHOT = 2;
const SNIPE_W = 4;
const SNIPE_H = 2;
const HIVE = 4;
const BLOCK_W = 16; // the maze's blocks are BLOCK_W x BLOCK_H cells (2.10)
const BLOCK_H = 12;
const MINUTE = 60 * 60; // ticks in a minute at 60 ticks/s (4.3)
const SHORT = 10 * 60; // ten seconds of ticks: the longest a "short delay" (2.2) may be
const AXES: Axis[] = [-1, 0, 1];
const SLOW = 120_000;

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

function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
}

function snipeBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SNIPE_W, height: SNIPE_H };
}

function hiveBox(p: Point): Box {
  return { x: p.x, y: p.y, width: HIVE, height: HIVE };
}

function shotBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SHOT, height: SHOT };
}

function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

// A fixed input log: random movement, Space and fire keys every 5 to 40 ticks.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  while (log.length < ticks) {
    const keys: InputState = {
      ...NO_INPUT,
      moveX: AXES[draw(3)],
      moveY: AXES[draw(3)],
      fireX: AXES[draw(3)],
      fireY: AXES[draw(3)],
      fast: draw(4) === 0,
    };
    for (let i = 5 + draw(36); i > 0 && log.length < ticks; i--) {
      log.push(keys);
    }
  }
  return log;
}

// Shots of `after` (the player's or the snipes') that are not a shot of `before` moved on by
// one cell: the ones that appeared this tick.
function appeared<S extends Point & { dx: number; dy: number }>(
  maze: Grid,
  before: readonly S[],
  after: readonly S[],
): S[] {
  const moved = new Set(
    before.map(
      (s) =>
        `${mod(s.x + s.dx, maze.width)},${mod(s.y + s.dy, maze.height)},${s.dx},${s.dy}`,
    ),
  );
  return after.filter((s) => !moved.has(`${s.x},${s.y},${s.dx},${s.dy}`));
}

interface Watch {
  readonly problems: string[];
  deaths: number;
  returns: number;
  readonly tick: (before: GameState, after: GameState, n: number) => void;
}

// Spec 2.2 (v0.12) and 2.10: whether the block whose start position is `p` is safe in `state`:
// no hive cell in the block (16 x 12 cells: its 15 x 11 open cells and the wall line on its
// left and top), and no snipe or snipe shot in it or in the 8 blocks around it.
function safeBlock(state: GameState, p: Point): boolean {
  const { maze } = state;
  const block = { x: p.x - 6, y: p.y - 4, width: BLOCK_W, height: BLOCK_H };
  const around = {
    x: block.x - BLOCK_W,
    y: block.y - BLOCK_H,
    width: 3 * BLOCK_W,
    height: 3 * BLOCK_H,
  };
  return (
    !state.hives.some((h) => overlaps(maze, hiveBox(h), block)) &&
    !state.snipes.some((s) => overlaps(maze, snipeBox(s), around)) &&
    !state.snipeShots.some((s) => overlaps(maze, shotBox(s), around))
  );
}

// The start positions of all blocks, from a block's start position `start` (2.10).
function blockStarts(maze: Grid, start: Point): Point[] {
  const result: Point[] = [];
  for (let by = 0; by < maze.height / BLOCK_H; by++) {
    for (let bx = 0; bx < maze.width / BLOCK_W; bx++) {
      result.push({
        x: mod(start.x + bx * BLOCK_W, maze.width),
        y: mod(start.y + by * BLOCK_H, maze.height),
      });
    }
  }
  return result;
}

// Checks every tick of a game against 2.2, 2.10 and 6.2. `start` is where the game's player
// started: a block's start position.
function watch(start: Point): Watch {
  let diedOn = -1;
  let safeSince = -1;
  const w: Watch = {
    problems: [],
    deaths: 0,
    returns: 0,
    tick: (before, after, n) => {
      const report = (what: string): void => {
        if (w.problems.length < 20) w.problems.push(`tick ${n}: ${what}`);
      };
      const { maze } = after;
      if (!Number.isInteger(after.lives) || after.lives < 0) {
        report(`${after.lives} lives`);
      }
      if (!Number.isInteger(after.respawn) || after.respawn < 0) {
        report(`respawn ${after.respawn}`);
      }
      const died = before.respawn === 0 && after.respawn > 0;
      const back = before.respawn > 0 && after.respawn === 0;
      if (died) {
        w.deaths++;
        diedOn = n;
        if (after.lives !== before.lives - 1) {
          report(`died with ${before.lives} lives and has ${after.lives}`);
        }
      } else if (after.lives !== before.lives) {
        // Out of play nothing hurts the player, and where it comes back is safe.
        report(
          `lives ${before.lives} -> ${after.lives}, respawn ${before.respawn} -> ${after.respawn}`,
        );
      }
      if (before.respawn > 0 && after.respawn > 0) {
        // After the short delay it comes back as soon as a block is safe: report it if some
        // block was safe both before and after each of 3 ticks in a row.
        const blocks = blockStarts(maze, start);
        const safe = blocks.some(
          (b) => safeBlock(before, b) && safeBlock(after, b),
        );
        if (!safe) safeSince = -1;
        else if (safeSince < 0) safeSince = n;
        if (
          diedOn >= 0 &&
          n - diedOn > SHORT &&
          safeSince >= 0 &&
          n - safeSince >= 2 &&
          after.lives > 0
        ) {
          report(`out of play since tick ${diedOn}, with a safe block`);
        }
        if (
          after.player.x !== before.player.x ||
          after.player.y !== before.player.y
        ) {
          report(
            `moved from ${before.player.x},${before.player.y} to ${after.player.x},${after.player.y} while out of play`,
          );
        }
        const fired = appeared(maze, before.shots, after.shots);
        if (fired.length > 0) {
          report(`fired ${fired.length} shots while out of play`);
        }
      }
      if (back) {
        w.returns++;
        safeSince = -1;
        // It comes back at a block's start position, in a safe block (2.2, 2.10).
        const p = { x: after.player.x, y: after.player.y };
        const at = `came back at ${p.x},${p.y}`;
        if (
          mod(p.x - start.x, BLOCK_W) !== 0 ||
          mod(p.y - start.y, BLOCK_H) !== 0
        ) {
          report(`${at}, not a block's start position`);
        } else if (!safeBlock(before, p) && !safeBlock(after, p)) {
          report(`${at}, in a block that is not safe`);
        }
      }
      if (after.respawn !== 0) return;
      // In play, or back in play this tick.
      const p = playerBox(after.player);
      const at = `player at ${after.player.x},${after.player.y}`;
      if (!clear(maze, p)) report(`${at} on a wall`);
      for (const s of after.snipes) {
        if (overlaps(maze, snipeBox(s), p)) {
          report(`${at} touched by the snipe at ${s.x},${s.y} and in play`);
        }
      }
      // Shots move and hit before the player moves (4.3). A shot in flight that moved onto
      // the place where the player stood would have hit it; on the tick it comes back, none
      // that was in flight is on it. A shot fired onto the player this tick, or one it moved
      // onto, hits it on the next tick.
      const fresh = new Set(
        appeared(maze, before.snipeShots, after.snipeShots),
      );
      const struck = back ? p : playerBox(before.player);
      for (const s of after.snipeShots) {
        if (!fresh.has(s) && overlaps(maze, shotBox(s), struck)) {
          report(`${at} hit by the shot at ${s.x},${s.y} and in play`);
        }
      }
    },
  };
  return w;
}

// ===========================================================================================

describe("2.2 Player / 9 M3: standing still, the player eventually dies", () => {
  // Some die from a snipe's shot and some from a snipe touching them (2.2, 2.4).
  it.each([
    [25, "A9"],
    [22, "A9"],
    [4, "C9"],
    [1, "B3"],
    [1, "A1"],
  ] as const)(
    "seed %d at %s: it dies, and the death costs one life",
    (seed, skill) => {
      let state = createGame(seed, skill);
      const start = { x: state.player.x, y: state.player.y };
      const lives = state.lives;
      const checks = watch(state.player);
      let died = -1;
      for (let tick = 1; tick <= 15 * MINUTE && died < 0; tick++) {
        const before = state;
        state = step(state, NO_INPUT);
        checks.tick(before, state, tick);
        if (state.lives !== lives) {
          died = tick;
        } else {
          expect(state.respawn, `tick ${tick}`).toBe(0);
          expect({ x: state.player.x, y: state.player.y }).toEqual(start);
        }
      }
      expect(died, "the player never died").toBeGreaterThan(0);
      expect(state.lives).toBe(lives - 1);
      expect(state.respawn).toBeGreaterThan(0);
      expect(checks.problems).toEqual([]);
    },
    SLOW,
  );
});

describe("6.2 Invariants: lives, deaths and coming back, every tick of a whole game (2.2, 2.10)", () => {
  it.each([
    [18, "A9"],
    [4, "B9"],
    [17, "C9"],
    [18, "A3"],
    [19, "B9"],
    [18, "B5"],
  ] as const)(
    "seed %d at %s, two minutes of random moving and firing",
    (seed, skill) => {
      // Lives are topped up, so that the game goes on after the last one (WP 13).
      let state: GameState = { ...createGame(seed, skill), lives: 1000 };
      const checks = watch(state.player);
      for (const [tick, keys] of inputLog(seed + 100, 2 * MINUTE).entries()) {
        const before = state;
        state = step(state, keys);
        checks.tick(before, state, tick + 1);
      }
      expect(checks.problems).toEqual([]);
      // Guards: the player died, and each death cost one life.
      expect(checks.deaths).toBeGreaterThan(0);
      expect(state.lives).toBe(1000 - checks.deaths);
    },
    SLOW,
  );

  it(
    "standing still among many snipes, it keeps coming back where nothing touches it",
    () => {
      // Digit 9 fills the map with snipes. Lives are topped up, so that the game goes on after
      // the last one (WP 13).
      let state: GameState = { ...createGame(25, "A9"), lives: 1000 };
      const checks = watch(state.player);
      for (let tick = 1; tick <= 4 * MINUTE; tick++) {
        const before = state;
        state = step(state, NO_INPUT);
        checks.tick(before, state, tick);
      }
      expect(checks.problems).toEqual([]);
      expect(checks.deaths).toBeGreaterThan(0);
      expect(checks.returns).toBeGreaterThan(0);
      expect(state.lives).toBe(1000 - checks.deaths);
    },
    SLOW,
  );
});

describe("6.2 Determinism with deaths", () => {
  it.each([18, 4])(
    "seed %d and the same input log give the same game, deaths included",
    (seed) => {
      const log = inputLog(seed + 100, 2 * MINUTE);
      let a = createGame(seed, "B9");
      let b = createGame(seed, "B9");
      for (const keys of log) {
        a = step(a, keys);
        b = step(b, keys);
        expect(a.lives).toBe(b.lives);
        expect(a.respawn).toBe(b.respawn);
        expect(a.player).toEqual(b.player);
      }
      expect(a).toEqual(b);
      // Guard: the player died in this game.
      expect(a.lives).toBeLessThan(createGame(seed, "B9").lives);
    },
    SLOW,
  );
});
