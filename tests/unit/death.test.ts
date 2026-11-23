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

// Spec 2.2, 2.4, 2.5, 2.10, 4.3, 6.2 and 9.1 WP 11: the player dies on touching an enemy or
// on being hit by an enemy's shot, loses one life, and comes back at a safe spot after a short
// delay.
//
// - `state.lives` is the number of lives the player has left: a whole number that goes down by
//   exactly one with each death and never below 0. How many a game starts with is the digit's
//   (2.6, WP 12), so here it is only checked to be above 0.
// - `state.respawn` is 0 while the player is in play. From the tick it dies until it comes back
//   it is above 0 (a whole number of ticks); then the player is out of play: it cannot move,
//   fire, be hit or touch anything, so `state.player` stays where it died. On the tick it comes
//   back, `respawn` is 0 again and `state.player` is where it came back.
// - Touching (2.2, 2.4, 2.10): the player's 4 x 4 footprint and a snipe's 4 x 2 footprint share
//   a cell after the player moves or after the snipes step, even if not at the end of the tick.
//   Being next to each other is not touching.
// - Hit (2.2, 2.4, 2.5): a snipe's shot (`state.snipeShots`, 2 x 2) enters a cell of the
//   player's footprint, or was fired onto it; that shot disappears. Shots move and hits are
//   resolved first in a tick, so a shot fired onto the player hits on the next tick, and a
//   player that is hit does not move that tick (4.3).
// - Safe spot (2.2, spec v0.12): the start position (2.10) of a block with no hive cell, where no
//   snipe and no snipe shot is in that block or the 8 around it. A block is 16 x 12 cells: 15 x
//   11 open ones with the wall line on its left and top. The blocks are tried farthest first
//   from the block where the player died, by |columns| + |rows| between them with wrap-around,
//   ties by row, then column; with none safe it tries again on the next tick. Blocks are
//   counted here from the block of the start; the tests keep to blocks whose order by row and
//   column does not depend on which block of the maze counts as the first.
// - Nothing else kills the player in WP 11: not its own straight shots (bouncing shots are
//   WP 16, deadly walls WP 17, ghosts WP 15).
// - What follows the loss of the last life (game over) is WP 13's; here the lives only never go
//   below 0.
//
// Snipes are copies of one that has just appeared, as in the WP 10 tests, so a copy takes its
// first step on the next tick; the PRNG is chosen so that each snipe does what a case needs.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Shot = GameState["snipeShots"][number];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)
const SNIPE_W = 4; // a snipe's footprint is SNIPE_W x SNIPE_H cells (2.10)
const SNIPE_H = 2;
const BLOCK_W = 16; // the maze's blocks are BLOCK_W x BLOCK_H cells (2.10)
const BLOCK_H = 12;
const BLOCKS_X = 16; // the maze is BLOCKS_X x BLOCKS_Y blocks (2.10)
const BLOCKS_Y = 20;
const KEEP = 3 / 4; // the keep chance (2.4)
const FIRE_TICKS = 13; // ticks from one player's shot to the next (2.5)
const SHORT = 10 * 60; // ten seconds of ticks: the longest a "short delay" (2.2) may be
const PATIENCE = 10 * 60 * 60; // ten minutes of ticks, the longest a test waits for a spawn

const UP: Dir = [0, -1];
const UP_RIGHT: Dir = [1, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const DOWN_LEFT: Dir = [-1, 1];
const LEFT: Dir = [-1, 0];
const UP_LEFT: Dir = [-1, -1];
const EIGHT: [name: string, d: Dir][] = [
  ["up", UP],
  ["up-right", UP_RIGHT],
  ["right", RIGHT],
  ["down-right", DOWN_RIGHT],
  ["down", DOWN],
  ["down-left", DOWN_LEFT],
  ["left", LEFT],
  ["up-left", UP_LEFT],
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

// Whether two footprints share a cell, with wrap-around.
function overlaps(maze: Grid, a: Box, b: Box): boolean {
  const keys = new Set(
    cells(a).map((c) => `${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
  return cells(b).some((c) =>
    keys.has(`${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
}

// Whether the footprint has no wall cell, with wrap-around (2.10).
function clear(maze: Grid, box: Box): boolean {
  return cells(box).every((c) => cellAt(maze, c) === "open");
}

function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
}

function snipeBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SNIPE_W, height: SNIPE_H };
}

function shotBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SHOT, height: SHOT };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

// An open grid, walls at the cells `wall` picks.
function grid(
  width: number,
  height: number,
  wall: (p: Point) => boolean = () => false,
): Grid {
  return createGrid(width, height, (p) => (wall(p) ? "wall" : "open"));
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
  for (let seed = 0; seed < 10_000_000; seed++) {
    const rng = createRng(seed);
    const v = values(rng, ranges.length);
    if (ranges.every(([from, to], i) => v[i] >= from && v[i] < to)) {
      found.set(key, rng);
      return rng;
    }
  }
  throw new Error(`No PRNG state for ${key}`);
}

const KEEPS = [0, KEEP] as const; // the keep chance succeeds (2.4)
const SURE = [0, 1 / 4096] as const; // below every fire chance 2.4 can give
const HOLDS = [1 / 2, 1] as const; // above every fire chance 2.4 can give

// --- Games ---------------------------------------------------------------------------------

let template: Snipe | undefined;

// A snipe that has just appeared, spawned by a lone hive in an open room.
function newSnipe(): Snipe {
  if (template !== undefined) return template;
  const room = grid(64, 48, ({ x, y }) => x === 0 || y === 0);
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
function snipe(p: Point, [dx, dy]: Dir): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx, dy, turn: 1 };
}

function shot(p: Point, [dx, dy]: Dir): Shot {
  return { x: p.x, y: p.y, dx, dy };
}

interface Setup {
  readonly maze: Grid;
  readonly player: Point;
  readonly snipes?: readonly Snipe[];
  readonly snipeShots?: readonly Shot[];
  readonly rng?: Rng;
  readonly lives?: number;
}

// A game at A1 in `maze` with only what the setup names: no hives, so nothing is spawned.
function arena(setup: Setup): GameState {
  const game = createGame(1, "A1");
  return {
    ...game,
    maze: setup.maze,
    player: { ...game.player, x: setup.player.x, y: setup.player.y },
    hives: [],
    snipes: setup.snipes ?? [],
    shots: [],
    snipeShots: setup.snipeShots ?? [],
    rng: setup.rng ?? game.rng,
    lives: setup.lives ?? game.lives,
  };
}

// A generated maze with the player at its start and no hives or snipes (2.10: the start is
// 5 cells from its block's left wall and 3 from its top wall).
function quietGame(seed: number): GameState {
  return { ...createGame(seed), hives: [], snipes: [] };
}

// Spec 2.10: the start position of the block `bx` columns right of and `by` rows below the
// block whose start position is `from`, wrapped.
function blockStart(maze: Grid, from: Point, bx: number, by: number): Point {
  return {
    x: mod(from.x + bx * BLOCK_W, maze.width),
    y: mod(from.y + by * BLOCK_H, maze.height),
  };
}

// Which block start position `p` is, counted from the block of start position `from`, as
// "column,row"; undefined if `p` is not a block's start position.
function blockOf(maze: Grid, from: Point, p: Point): string | undefined {
  const dx = mod(p.x - from.x, maze.width);
  const dy = mod(p.y - from.y, maze.height);
  if (dx % BLOCK_W !== 0 || dy % BLOCK_H !== 0) return undefined;
  return `${dx / BLOCK_W},${dy / BLOCK_H}`;
}

// A hive like a new game's at `p`, with no hits taken.
function hiveAt(p: Point): GameState["hives"][number] {
  return { ...createGame(1).hives[0], x: p.x, y: p.y, hits: 0 };
}

function hold(fireX: Axis, fireY: Axis, moveX: Axis = 0, moveY: Axis = 0) {
  return { ...NO_INPUT, fireX, fireY, moveX, moveY };
}

// The player's shots in `after` that are not a shot of `before` moved on by one cell, that is,
// the shots fired this tick.
function newShots(before: GameState, after: GameState): GameState["shots"] {
  const { maze } = after;
  const moved = new Set(
    before.shots.map(
      (s) =>
        `${mod(s.x + s.dx, maze.width)},${mod(s.y + s.dy, maze.height)},${s.dx},${s.dy}`,
    ),
  );
  return after.shots.filter((s) => !moved.has(`${s.x},${s.y},${s.dx},${s.dy}`));
}

// A shot from the left that enters the player's footprint on its second move.
function shotFromLeft(player: Point): Shot {
  return shot({ x: player.x - 3, y: player.y + 1 }, RIGHT);
}

interface Death {
  /** The state on the tick the player died. */
  readonly dead: GameState;
  /** The ticks from the start to the death. */
  readonly tick: number;
}

// Steps until the player's lives go down, at most `limit` ticks.
function untilDeath(
  start: GameState,
  limit: number,
  input: InputState = NO_INPUT,
): Death | undefined {
  let state = start;
  for (let tick = 1; tick <= limit; tick++) {
    state = step(state, input);
    if (state.lives !== start.lives) return { dead: state, tick };
  }
  return undefined;
}

interface Return {
  /** The state on the tick the player came back. */
  readonly back: GameState;
  /** The ticks from the death to the return. */
  readonly ticks: number;
  /** Every state while the player was out of play, the death tick's first. */
  readonly out: GameState[];
}

// Steps a player who has just died until it is back in play, at most SHORT ticks.
function untilBack(
  dead: GameState,
  input: InputState = NO_INPUT,
  each: (s: GameState) => GameState = (s) => s,
): Return | undefined {
  let state = dead;
  const out = [dead];
  for (let ticks = 1; ticks <= SHORT; ticks++) {
    state = each(step(state, input));
    if (state.respawn === 0) return { back: state, ticks, out };
    out.push(state);
  }
  return undefined;
}

// An open field the size of the maze (2.10), larger than any shot flies in these tests, with
// the player in its middle.
const field = grid(BLOCKS_X * BLOCK_W, BLOCKS_Y * BLOCK_H);
const P = { x: 150, y: 150 };

// ===========================================================================================

describe("2.2 Player: a new game starts with the player in play and lives left", () => {
  it.each(["A1", "M5", "Z9", "C3", "W7", "B8"])("at %s", (skill) => {
    for (const seed of [0, 1, 42]) {
      const game = createGame(seed, skill);
      expect(Number.isInteger(game.lives)).toBe(true);
      expect(game.lives).toBeGreaterThan(0);
      expect(game.respawn).toBe(0);
    }
  });

  it("is the same for the same seed and keeps the game plain data", () => {
    const game = createGame(5, "B4");
    expect(createGame(5, "B4")).toEqual(game);
    expect(structuredClone(game)).toEqual(game);
  });
});

describe("2.2 Player / 2.4 Snipes: instant death on being hit by a snipe's shot (2.5, 2.10)", () => {
  // Each shot starts 12 cells back along its line from the player's middle, so whichever of
  // the 8 directions it flies in, its 10th move takes it into the footprint.
  it.each(EIGHT)(
    "a shot flying %s kills the player on the tick it enters the footprint, and is gone",
    (_name, d) => {
      const start = { x: P.x + 1 - 12 * d[0], y: P.y + 1 - 12 * d[1] };
      let state = arena({
        maze: field,
        player: P,
        snipeShots: [shot(start, d)],
      });
      const lives = state.lives;
      for (let tick = 1; tick < 10; tick++) {
        state = step(state, NO_INPUT);
        expect(state.lives, `tick ${tick}`).toBe(lives);
        expect(state.respawn, `tick ${tick}`).toBe(0);
        expect(state.snipeShots, `tick ${tick}`).toHaveLength(1);
      }
      state = step(state, NO_INPUT);
      expect(state.lives).toBe(lives - 1);
      expect(state.respawn).toBeGreaterThan(0);
      expect(state.snipeShots).toEqual([]);
    },
  );

  it("is killed by a shot that a snipe fires at it, when the shot arrives", () => {
    // The snipe keeps going right, 7 columns from the player and one row off: the player is to
    // its right (2.4), D = 8 and s = 1 at letter A, and it fires. Its shot appears 3 cells left
    // of the player, moves on the next tick and enters the footprint on the tick after.
    let state = arena({
      maze: field,
      player: P,
      snipes: [snipe({ x: P.x - 8, y: P.y + 1 }, RIGHT)],
      rng: rngIn(KEEPS, SURE),
    });
    const lives = state.lives;
    state = step(state, NO_INPUT);
    expect(state.snipeShots).toEqual([shot({ x: P.x - 3, y: P.y + 1 }, RIGHT)]);
    state = step(state, NO_INPUT);
    expect(state.lives).toBe(lives);
    state = step(state, NO_INPUT);
    expect(state.lives).toBe(lives - 1);
    expect(state.respawn).toBeGreaterThan(0);
    expect(state.snipeShots).toEqual([]);
  });

  it("is killed on the next tick by a shot fired onto it", () => {
    // The snipe steps to 5 columns left of the player and fires; its shot appears on the
    // player's left column. Shots move and hit first in a tick, so it hits on the next tick.
    let state = arena({
      maze: field,
      player: P,
      snipes: [snipe({ x: P.x - 6, y: P.y + 1 }, RIGHT)],
      rng: rngIn(KEEPS, SURE),
    });
    const lives = state.lives;
    state = step(state, NO_INPUT);
    expect(state.snipeShots).toEqual([shot({ x: P.x - 1, y: P.y + 1 }, RIGHT)]);
    expect(state.lives).toBe(lives);
    expect(state.respawn).toBe(0);
    state = step(state, NO_INPUT);
    expect(state.lives).toBe(lives - 1);
    expect(state.respawn).toBeGreaterThan(0);
    expect(state.snipeShots).toEqual([]);
  });

  it("does not move on the tick a shot hits it, nor while it is out of play", () => {
    // Holding right all along; the shot enters its footprint on its first move, before the
    // player moves (4.3).
    let state = arena({
      maze: field,
      player: P,
      snipeShots: [shot({ x: P.x - SHOT, y: P.y + 1 }, RIGHT)],
    });
    const lives = state.lives;
    const right = hold(0, 0, 1, 0);
    state = step(state, right);
    expect(state.lives).toBe(lives - 1);
    expect(state.respawn).toBeGreaterThan(0);
    expect(where(state.player)).toEqual(P);
    for (let tick = 2; tick <= SHORT && state.respawn > 0; tick++) {
      state = step(state, right);
      if (state.respawn > 0) {
        expect(where(state.player), `tick ${tick}`).toEqual(P);
      }
    }
  });

  it.each([
    ["right, over the player's top row", { x: P.x - 12, y: P.y - 1 }, RIGHT],
    ["right, over its bottom row", { x: P.x - 12, y: P.y + PLAYER - 1 }, RIGHT],
    ["down, over its left column", { x: P.x - 1, y: P.y - 12 }, DOWN],
    ["up, over its right column", { x: P.x + PLAYER - 1, y: P.y + 15 }, UP],
    [
      "down-right, over its top-left cell",
      { x: P.x - 11, y: P.y - 11 },
      DOWN_RIGHT,
    ],
  ] as const)(
    "is killed by a shot flying %s, sharing only one row, column or cell with the footprint",
    (_name, start, d) => {
      const state = arena({
        maze: field,
        player: P,
        snipeShots: [shot(start, d)],
      });
      const death = untilDeath(state, 20);
      expect(death).toBeDefined();
      expect(death?.dead.lives).toBe(state.lives - 1);
      expect(death?.dead.snipeShots).toEqual([]);
    },
  );

  it.each([
    ["right, just above the player", { x: P.x - 12, y: P.y - SHOT }, RIGHT],
    ["right, just below it", { x: P.x - 12, y: P.y + PLAYER }, RIGHT],
    ["down, just left of it", { x: P.x - SHOT, y: P.y - 12 }, DOWN],
    ["up, just right of it", { x: P.x + PLAYER, y: P.y + 15 }, UP],
    [
      "down-right, past its top-right corner",
      { x: P.x - 6, y: P.y - 12 },
      DOWN_RIGHT,
    ],
  ] as const)(
    "is not hurt by a shot flying %s, next to the footprint but never on it",
    (_name, start, d) => {
      let state = arena({
        maze: field,
        player: P,
        snipeShots: [shot(start, d)],
      });
      const lives = state.lives;
      for (let tick = 1; tick <= 30; tick++) {
        state = step(state, NO_INPUT);
        expect(state.lives, `tick ${tick}`).toBe(lives);
        expect(state.respawn, `tick ${tick}`).toBe(0);
      }
      // The shot flew on past the player.
      expect(state.snipeShots).toHaveLength(1);
      expect(where(state.snipeShots[0])).toEqual({
        x: start.x + 30 * d[0],
        y: start.y + 30 * d[1],
      });
    },
  );

  it("is not hurt by a shot that a wall stops before it", () => {
    // A wall column 4 cells left of the player, between it and the shot.
    const walled = grid(field.width, field.height, ({ x }) => x === P.x - 4);
    let state = arena({
      maze: walled,
      player: P,
      snipeShots: [shot({ x: P.x - 20, y: P.y + 1 }, RIGHT)],
    });
    const lives = state.lives;
    for (let tick = 1; tick <= 40; tick++) {
      state = step(state, NO_INPUT);
      expect(state.lives, `tick ${tick}`).toBe(lives);
      expect(state.respawn, `tick ${tick}`).toBe(0);
    }
    expect(state.snipeShots).toEqual([]);
  });

  it("is not hurt by its own straight shot, even when it comes round the maze to it", () => {
    // A lane 64 cells round: the shot fired right comes round to the player's left side.
    const lane = grid(64, 8);
    const at = { x: 10, y: 2 };
    let state = arena({ maze: lane, player: at });
    const lives = state.lives;
    let cameRound = false;
    for (let tick = 1; tick <= 80; tick++) {
      state = step(state, tick === 1 ? hold(1, 0) : NO_INPUT);
      expect(state.lives, `tick ${tick}`).toBe(lives);
      expect(state.respawn, `tick ${tick}`).toBe(0);
      if (state.shots.some((s) => s.x === at.x - SHOT)) cameRound = true;
    }
    // Guard: the shot came round to just left of the player.
    expect(cameRound).toBe(true);
  });
});

describe("2.2 Player / 2.10 Sizes: instant death on touching a snipe", () => {
  it("is killed by a snipe that steps onto it", () => {
    // Right next to the player, the snipe keeps going right, onto the player's left column.
    const state = arena({
      maze: field,
      player: P,
      snipes: [snipe({ x: P.x - SNIPE_W, y: P.y + 1 }, RIGHT)],
      rng: rngIn(KEEPS, HOLDS),
    });
    const after = step(state, NO_INPUT);
    expect(where(after.snipes[0])).toEqual({
      x: P.x - SNIPE_W + 1,
      y: P.y + 1,
    });
    expect(after.lives).toBe(state.lives - 1);
    expect(after.respawn).toBeGreaterThan(0);
  });

  it("is killed by a snipe that shares only one cell with it", () => {
    // The snipe covers the player's bottom-left cell, and still does after a step right.
    const state = arena({
      maze: field,
      player: P,
      snipes: [snipe({ x: P.x - SNIPE_W + 1, y: P.y + PLAYER - 1 }, RIGHT)],
      rng: rngIn(KEEPS),
    });
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.respawn).toBeGreaterThan(0);
  });

  it("is killed when it steps onto a snipe that stands still", () => {
    // The snipe steps down on the first tick and then waits 10 ticks (2.4). The player, moving
    // right one cell every 3 ticks, is next to it after its third step (tick 7) and on it after
    // its fourth (tick 10).
    let state = arena({
      maze: field,
      player: P,
      snipes: [snipe({ x: P.x + PLAYER + 3, y: P.y + 1 }, DOWN)],
      rng: rngIn(KEEPS),
    });
    const lives = state.lives;
    const right = hold(0, 0, 1, 0);
    for (let tick = 1; tick < 10; tick++) {
      state = step(state, right);
      expect(state.lives, `tick ${tick}`).toBe(lives);
      expect(state.respawn, `tick ${tick}`).toBe(0);
    }
    expect(where(state.player)).toEqual({ x: P.x + 3, y: P.y });
    expect(where(state.snipes[0])).toEqual({ x: P.x + PLAYER + 3, y: P.y + 2 });
    state = step(state, right);
    expect(state.lives).toBe(lives - 1);
    expect(state.respawn).toBeGreaterThan(0);
  });

  it("is killed by a snipe it steps onto, even when the snipe steps off it in the same tick", () => {
    // Right next to the player, the snipe keeps going right. The player steps right onto it,
    // then the snipe steps on, off the player: touching is checked after the player moves too.
    const state = arena({
      maze: field,
      player: P,
      snipes: [snipe({ x: P.x + PLAYER, y: P.y + 1 }, RIGHT)],
      rng: rngIn(KEEPS),
    });
    const after = step(state, hold(0, 0, 1, 0));
    expect(where(after.snipes[0])).toEqual({ x: P.x + PLAYER + 1, y: P.y + 1 });
    expect(
      overlaps(
        field,
        snipeBox(after.snipes[0]),
        playerBox({ x: P.x + 1, y: P.y }),
      ),
    ).toBe(false);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.respawn).toBeGreaterThan(0);
  });

  // Snipes right next to the player on each side and at each corner, going away from it.
  it.each([
    ["left", { x: P.x - SNIPE_W, y: P.y + 1 }, LEFT],
    ["right", { x: P.x + PLAYER, y: P.y + 1 }, RIGHT],
    ["above", { x: P.x, y: P.y - SNIPE_H }, UP],
    ["below", { x: P.x, y: P.y + PLAYER }, DOWN],
    ["up-left", { x: P.x - SNIPE_W, y: P.y - SNIPE_H }, UP_LEFT],
    ["up-right", { x: P.x + PLAYER, y: P.y - SNIPE_H }, UP_RIGHT],
    ["down-left", { x: P.x - SNIPE_W, y: P.y + PLAYER }, DOWN_LEFT],
    ["down-right", { x: P.x + PLAYER, y: P.y + PLAYER }, DOWN_RIGHT],
  ] as const)("is not touched by a snipe next to it, %s", (_name, at, d) => {
    let state = arena({
      maze: field,
      player: P,
      snipes: [snipe(at, d)],
      rng: rngIn(KEEPS),
    });
    expect(overlaps(field, snipeBox(at), playerBox(P))).toBe(false);
    const lives = state.lives;
    for (let tick = 1; tick <= 9; tick++) {
      state = step(state, NO_INPUT);
      expect(state.lives, `tick ${tick}`).toBe(lives);
      expect(state.respawn, `tick ${tick}`).toBe(0);
    }
    // Guard: the snipe stepped away.
    expect(where(state.snipes[0])).toEqual({ x: at.x + d[0], y: at.y + d[1] });
  });
});

describe("2.2 Player: each death costs exactly one life", () => {
  it("loses one life to two shots that hit on the same tick", () => {
    const state = arena({
      maze: field,
      player: P,
      snipeShots: [
        shot({ x: P.x - 11, y: P.y + 1 }, RIGHT),
        shot({ x: P.x + 13, y: P.y + 1 }, LEFT),
      ],
    });
    const death = untilDeath(state, 20);
    expect(death?.tick).toBe(10);
    expect(death?.dead.lives).toBe(state.lives - 1);
    expect(death?.dead.respawn).toBeGreaterThan(0);
  });

  it("loses one life to a shot and a snipe that reach it on the same tick", () => {
    // The shot enters the footprint on its first move; the snipe steps up onto the player and
    // holds its fire.
    const state = arena({
      maze: field,
      player: P,
      snipes: [snipe({ x: P.x, y: P.y + PLAYER }, UP)],
      snipeShots: [shot({ x: P.x - SHOT, y: P.y + 1 }, RIGHT)],
      rng: rngIn(KEEPS, HOLDS),
    });
    const after = step(state, NO_INPUT);
    expect(overlaps(field, snipeBox(after.snipes[0]), playerBox(P))).toBe(true);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.respawn).toBeGreaterThan(0);
  });

  it("is not hurt again while it is out of play", () => {
    // A snipe on the footprint's top two rows, which stays on that place for 10 ticks, and
    // shots arriving on its bottom two rows one after another.
    const state = arena({
      maze: field,
      player: P,
      snipes: [snipe(P, RIGHT)],
      snipeShots: [2, 4, 6, 8, 10, 12].map((k) =>
        shot({ x: P.x - k, y: P.y + 2 }, RIGHT),
      ),
      rng: rngIn(KEEPS),
    });
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives - 1);
    const back = untilBack(after);
    expect(back).toBeDefined();
    for (const [i, s] of (back?.out ?? []).entries()) {
      expect(s.lives, `tick ${i + 1}`).toBe(state.lives - 1);
    }
  });

  it("loses one more life when it dies again after coming back", () => {
    const game = quietGame(3);
    const first = untilDeath(
      { ...game, snipeShots: [shotFromLeft(game.player)] },
      5,
    );
    expect(first?.dead.lives).toBe(game.lives - 1);
    const back = untilBack(first?.dead ?? game);
    expect(back).toBeDefined();
    if (back === undefined) return;
    expect(back.back.lives).toBe(game.lives - 1);
    const again = untilDeath(
      { ...back.back, snipeShots: [shotFromLeft(back.back.player)] },
      5,
    );
    expect(again?.dead.lives).toBe(game.lives - 2);
    expect(again?.dead.respawn).toBeGreaterThan(0);
  });

  it("never has fewer than 0 lives", () => {
    // The last life is lost; then a shot is fired at the player whenever it is in play.
    let state: GameState = { ...quietGame(4), lives: 1 };
    state = { ...state, snipeShots: [shotFromLeft(state.player)] };
    let died = false;
    for (let tick = 1; tick <= 3 * SHORT; tick++) {
      state = step(state, NO_INPUT);
      expect(Number.isInteger(state.lives), `tick ${tick}`).toBe(true);
      expect(state.lives, `tick ${tick}`).toBeGreaterThanOrEqual(0);
      if (state.lives === 0) died = true;
      if (state.respawn === 0 && state.snipeShots.length === 0) {
        state = { ...state, snipeShots: [shotFromLeft(state.player)] };
      }
    }
    expect(died).toBe(true);
  });
});

describe("2.2 Player / 2.10 Sizes: comes back at a safe spot after a short delay", () => {
  it("is out of play from the tick it dies, and back in play within ten seconds", () => {
    const game = quietGame(1);
    const death = untilDeath(
      { ...game, snipeShots: [shotFromLeft(game.player)] },
      5,
    );
    expect(death?.tick).toBe(2);
    if (death === undefined) return;
    expect(death.dead.respawn).toBeGreaterThan(0);
    const back = untilBack(death.dead);
    expect(back, "not back in play within ten seconds").toBeDefined();
    if (back === undefined) return;
    expect(back.ticks).toBeGreaterThanOrEqual(1);
    expect(back.ticks).toBeLessThanOrEqual(SHORT);
    for (const s of back.out) {
      expect(Number.isInteger(s.respawn)).toBe(true);
      expect(s.respawn).toBeGreaterThan(0);
    }
    // It comes back with the life it had left, in play.
    expect(back.back.lives).toBe(game.lives - 1);
    expect(back.back.respawn).toBe(0);
  });

  it.each([1, 2, 3, 42])(
    "comes back at the start position of the block farthest from where it died (seed %d)",
    (seed) => {
      // It walks 3 cells right first, so that it dies away from its block's start position.
      // The farthest block is 8 columns and 10 rows away, half the maze round both ways.
      let state: GameState = quietGame(seed);
      const start = where(state.player);
      for (let tick = 0; tick < 9; tick++)
        state = step(state, hold(0, 0, 1, 0));
      expect(where(state.player)).toEqual({ x: start.x + 3, y: start.y });
      const death = untilDeath(
        { ...state, snipeShots: [shotFromLeft(state.player)] },
        5,
      );
      expect(death).toBeDefined();
      if (death === undefined) return;
      const back = untilBack(death.dead);
      expect(back).toBeDefined();
      if (back === undefined) return;
      const p = where(back.back.player);
      expect(p).toEqual(blockStart(state.maze, start, 8, 10));
      expect(clear(back.back.maze, playerBox(p))).toBe(true);
    },
  );

  it("comes back farthest from the block where it died, wherever that is", () => {
    // Killed on the start position of the block 3 columns right of and 5 rows below the start.
    const game = quietGame(5);
    const start = where(game.player);
    const there = blockStart(game.maze, start, 3, 5);
    const death = untilDeath(
      {
        ...game,
        player: { ...game.player, ...there },
        snipeShots: [shotFromLeft(there)],
      },
      5,
    );
    expect(death).toBeDefined();
    if (death === undefined) return;
    const back = untilBack(death.dead);
    expect(back).toBeDefined();
    expect(where(back?.back.player ?? there)).toEqual(
      blockStart(game.maze, start, 3 + 8, 5 + 10),
    );
  });

  // From the start block, the farthest block is (8, 10) in columns and rows counted from it.
  // Next, 17 blocks away, come (8, 9), (7, 10), (9, 10) and (8, 11), in that order: by row,
  // then column. The player dies at once on 10 snipes that stand on its start position; with
  // as many enemies as A1 allows, no hive spawns (2.3). The snipes and snipe shots are put back
  // where they were, and new shots removed, after every tick.
  it.each<[string, string, number[][], number[][], number[][]]>([
    ["nothing else", "8,10", [], [], []],
    ["a hive in the farthest block", "8,9", [[8, 10]], [], []],
    ["a snipe two rows above the farthest block", "8,10", [], [[8, 8]], []],
    ["a snipe in a block next to the farthest", "8,9", [], [[9, 11]], []],
    ["a snipe shot in a block next to the farthest", "8,9", [], [], [[8, 11]]],
    [
      "a hive in the farthest block and a snipe next to the next one",
      "7,10",
      [[8, 10]],
      [[8, 8]],
      [],
    ],
  ])(
    "with %s, it comes back in block %s",
    (_name, want, hiveBlocks, snipeBlocks, shotBlocks) => {
      const game = quietGame(1);
      const { maze } = game;
      const start = where(game.player);
      const at = ([bx, by]: number[]): Point => blockStart(maze, start, bx, by);
      const snipes = [
        ...Array.from({ length: 10 }, () => snipe(start, UP)),
        ...snipeBlocks.map((b) => snipe(at(b), UP)),
      ];
      const shots = shotBlocks.map((b) => {
        const p = at(b);
        return shot({ x: p.x + 1, y: p.y + 1 }, RIGHT);
      });
      const reset = (s: GameState): GameState => ({
        ...s,
        snipes,
        snipeShots: shots,
      });
      const hives = hiveBlocks.map((b) => hiveAt(at(b)));
      const dead = step(reset({ ...game, hives }), NO_INPUT);
      expect(dead.lives).toBe(game.lives - 1);
      const back = untilBack(reset(dead), NO_INPUT, reset);
      expect(back).toBeDefined();
      expect(back?.back.hives).toHaveLength(hives.length);
      expect(blockOf(maze, start, back?.back.player ?? start)).toBe(want);
    },
  );

  it("fires no shot while out of play, even with a fire key held, and fires again once back", () => {
    // Holding fire right all along: it fires on tick 1 and would again on tick 14.
    const game = quietGame(2);
    const fire = hold(1, 0);
    let state: GameState = { ...game, snipeShots: [shotFromLeft(game.player)] };
    let before = state;
    state = step(state, fire);
    expect(newShots(before, state)).toHaveLength(1);
    before = state;
    state = step(state, fire);
    expect(state.lives).toBe(game.lives - 1);
    expect(newShots(before, state)).toEqual([]);
    let ticks = 0;
    while (state.respawn > 0 && ticks < SHORT) {
      before = state;
      state = step(state, fire);
      ticks++;
      if (state.respawn > 0) {
        expect(newShots(before, state), `tick ${ticks} out of play`).toEqual(
          [],
        );
      }
    }
    expect(state.respawn).toBe(0);
    // Back in play, the held key fires again within one reload.
    let fired = newShots(before, state).length > 0;
    for (let t = 0; t <= FIRE_TICKS && !fired; t++) {
      before = state;
      state = step(state, fire);
      fired = newShots(before, state).length > 0;
    }
    expect(fired).toBe(true);
  });

  it("comes back where nothing is near, with snipes on the start position of nearly every block", () => {
    // A snipe on the place the player would start from in every block except a group of
    // 3 x 3 blocks half the maze away. The snipes are put back there, and their shots
    // removed, after every tick. The player starts on one of them, which kills it at once.
    const game = quietGame(1);
    const { maze } = game;
    const start = where(game.player);
    const blockers: Snipe[] = [];
    for (let by = 0; by < maze.height / BLOCK_H; by++) {
      for (let bx = 0; bx < maze.width / BLOCK_W; bx++) {
        if (Math.abs(bx - 8) <= 1 && Math.abs(by - 10) <= 1) continue;
        const p = {
          x: mod(start.x + bx * BLOCK_W, maze.width),
          y: mod(start.y + by * BLOCK_H, maze.height),
        };
        expect(clear(maze, snipeBox(p))).toBe(true);
        blockers.push(snipe(p, UP));
      }
    }
    expect(blockers).toHaveLength(16 * 20 - 9);
    const reset = (s: GameState): GameState => ({
      ...s,
      snipes: blockers,
      snipeShots: [],
    });
    const state = reset(game);
    const dead = step(state, NO_INPUT);
    expect(dead.lives).toBe(game.lives - 1);
    expect(dead.respawn).toBeGreaterThan(0);

    const back = untilBack(reset(dead), NO_INPUT, (s) => {
      // Checked before the snipes are put back: as the tick left them.
      if (s.respawn === 0) {
        const p = playerBox(s.player);
        expect(clear(maze, p)).toBe(true);
        for (const b of s.snipes) {
          expect(overlaps(maze, snipeBox(b), p), `snipe at ${b.x},${b.y}`).toBe(
            false,
          );
        }
        for (const b of s.snipeShots) {
          expect(overlaps(maze, shotBox(b), p), `shot at ${b.x},${b.y}`).toBe(
            false,
          );
        }
      }
      return reset(s);
    });
    expect(back).toBeDefined();
    if (back === undefined) return;
    // The middle block of the group is the only safe one, and the farthest too.
    expect(where(back.back.player)).toEqual(blockStart(maze, start, 8, 10));
    expect(back.back.lives).toBe(game.lives - 1);
    // It is not killed on the next tick either.
    const next = step(back.back, NO_INPUT);
    expect(next.lives).toBe(game.lives - 1);
    expect(next.respawn).toBe(0);
  }, 120_000);

  it("stays out of play while no block is safe, and comes back on the next tick once one is", () => {
    // A snipe on the start position of every block, put back after every tick; the player
    // starts on one of them. Long after any short delay, the snipes are taken away.
    const game = quietGame(1);
    const { maze } = game;
    const start = where(game.player);
    const blockers: Snipe[] = [];
    for (let by = 0; by < BLOCKS_Y; by++) {
      for (let bx = 0; bx < BLOCKS_X; bx++) {
        blockers.push(snipe(blockStart(maze, start, bx, by), UP));
      }
    }
    const reset = (s: GameState): GameState => ({
      ...s,
      snipes: blockers,
      snipeShots: [],
    });
    let state = reset(step(reset(game), NO_INPUT));
    expect(state.lives).toBe(game.lives - 1);
    for (let tick = 2; tick <= SHORT + 60; tick++) {
      state = step(state, NO_INPUT);
      expect(state.respawn, `tick ${tick}`).toBeGreaterThan(0);
      state = reset(state);
    }
    state = step({ ...state, snipes: [], snipeShots: [] }, NO_INPUT);
    expect(state.respawn).toBe(0);
    expect(where(state.player)).toEqual(blockStart(maze, start, 8, 10));
    expect(state.lives).toBe(game.lives - 1);
  }, 120_000);
});
