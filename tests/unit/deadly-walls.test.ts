import { describe, expect, it } from "vitest";
import { cellAt, createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  type GameState,
  type InputState,
} from "../../src/core/state";
import { inputFromKeys } from "../../src/input/keyboard";
// Spec 2.7 (WP 13): these tests go on after a level is cleared; see play-on.ts.
import { playOn as step } from "../play-on";

// Spec 2.2, 2.4, 2.6, 2.8, 2.10, 4.3 and 9.1 WP 17: deadly (electrified) walls.
//
// - At the letters M to Z (2.6) the player dies on touching a wall. Touching is checked only
//   on a tick when its step is due: a direction is held (after opposite keys cancel, 2.8) and
//   the wait after its last step is over (2.2: a step on the first tick a direction is held,
//   then 2 ticks of waiting, 1 if Space was held at that step). On such a tick the held
//   direction touches a wall when it is not a plain step: a straight step whose position
//   covers a wall cell, a diagonal whose diagonal position covers a wall cell, or a diagonal
//   through a corner gap (both straight positions blocked, 2.1, 2.10). A diagonal with an open
//   diagonal position and at least one open straight position is a plain step.
// - A player that touches a wall dies on that tick in the player-move stage (2.4): it does not
//   move, not even by a slide, so `state.player` stays where it stood; it loses one life
//   (`state.lives`) and is out of play at once (`state.respawn` above 0): no ghost is blocked
//   by it or draws a burst chance, and it does not fire. Snipes and ghosts aim at where it
//   died, and it comes back 120 ticks after the death tick at the block farthest from there,
//   as for any death (WP 11, WP 13).
// - At A to L the slides of 2.2 apply unchanged and walls never kill.
// - Movement works from the first tick after a respawn, also with a key held since before the
//   death.
//
// M1 has deadly walls and no other feature, and the same accuracy (3) as B1, which has no
// feature at all; O1 is D1 (ghosts) with deadly walls. Tests place the player in a maze of
// their own by copying a new game, as in the WP 06 and WP 15 tests. Snipes and ghosts are
// copies of ones that have just appeared, as in the WP 10 and WP 15 tests.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Ghost = GameState["ghosts"][number];
type Shot = GameState["shots"][number];

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const RESPAWN_TICKS = 120; // 2.2: the player comes back 120 ticks after the tick it died on
const BLOCK_W = 16; // 2.10: a block is 16 x 12 cells
const BLOCK_H = 12;
const KEEP = 3 / 4; // a snipe's keep chance (2.4)
const TURN = 1 / 4; // a snipe's random-turn chance (2.4)
const PATIENCE = 10 * 60 * 60; // ten minutes of ticks, the longest a test waits for a spawn
const NEVER = Number.MAX_SAFE_INTEGER; // a hive's wait that never runs out

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
// Spec 2.6: the letters with deadly walls.
const DEADLY = [..."MNOPQRSTUVWXYZ"];
const SAFE = LETTERS.filter((l) => !DEADLY.includes(l));

const UP: Dir = [0, -1];
const UP_RIGHT: Dir = [1, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const DOWN_LEFT: Dir = [-1, 1];
const LEFT: Dir = [-1, 0];
const UP_LEFT: Dir = [-1, -1];

const STRAIGHTS: [string, Dir][] = [
  ["up", UP],
  ["right", RIGHT],
  ["down", DOWN],
  ["left", LEFT],
];
const DIAGONALS: [string, Dir][] = [
  ["up-right", UP_RIGHT],
  ["down-right", DOWN_RIGHT],
  ["down-left", DOWN_LEFT],
  ["up-left", UP_LEFT],
];

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// An open grid, walls at the given cells, wrapped into the grid.
function grid(width: number, height: number, walls: readonly Point[] = []) {
  const set = new Set(
    walls.map((w) => `${mod(w.x, width)},${mod(w.y, height)}`),
  );
  return createGrid(width, height, ({ x, y }) =>
    set.has(`${x},${y}`) ? "wall" : "open",
  );
}

function plus(p: Point, [dx, dy]: Dir, k = 1): Point {
  return { x: p.x + k * dx, y: p.y + k * dy };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

// Whether the player's footprint at p covers no wall, with wrap-around (2.10).
function fits(maze: Grid, p: Point): boolean {
  for (let dy = 0; dy < PLAYER; dy++) {
    for (let dx = 0; dx < PLAYER; dx++) {
      if (cellAt(maze, { x: p.x + dx, y: p.y + dy }) === "wall") return false;
    }
  }
  return true;
}

function move([moveX, moveY]: Dir, fast = false): InputState {
  return { ...NO_INPUT, moveX, moveY, fast };
}

// Where the player is put in the field, and the cells of its footprint there: x and y from
// 100 to 103.
const P = { x: 100, y: 100 };

// The wall cells, each next to the footprint at P, that a straight step from P in d runs into:
// one cell of the row or column the step would add, away from the corners.
function wallAhead([dx, dy]: Dir): Point {
  if (dx === 1) return { x: P.x + PLAYER, y: P.y + 2 };
  if (dx === -1) return { x: P.x - 1, y: P.y + 1 };
  if (dy === 1) return { x: P.x + 1, y: P.y + PLAYER };
  return { x: P.x + 2, y: P.y - 1 };
}

// The row of wall cells along the side of the footprint at P that d's vertical part faces,
// 30 cells either way.
function wallRow(dy: number): Point[] {
  const y = dy > 0 ? P.y + PLAYER : P.y - 1;
  return Array.from({ length: 61 }, (_, i) => ({ x: P.x - 30 + i, y }));
}

// The column of wall cells along the side of the footprint at P that d's horizontal part faces.
function wallColumn(dx: number): Point[] {
  const x = dx > 0 ? P.x + PLAYER : P.x - 1;
  return Array.from({ length: 61 }, (_, i) => ({ x, y: P.y - 30 + i }));
}

// The cell touching the footprint at P only at the corner a diagonal d heads for.
function cornerCell([dx, dy]: Dir): Point {
  return {
    x: dx > 0 ? P.x + PLAYER : P.x - 1,
    y: dy > 0 ? P.y + PLAYER : P.y - 1,
  };
}

// The two cells that make a corner gap for a diagonal d from P: each blocks one straight
// position on the way, and neither is in the diagonal position.
function cornerGap([dx, dy]: Dir): Point[] {
  const ahead = dx > 0 ? P.x + PLAYER : P.x - 1;
  const below = dy > 0 ? P.y + PLAYER : P.y - 1;
  return [
    // In the horizontal position, in the row the diagonal leaves behind.
    { x: ahead, y: dy > 0 ? P.y : P.y + PLAYER - 1 },
    // In the vertical position, in the column the diagonal leaves behind.
    { x: dx > 0 ? P.x : P.x + PLAYER - 1, y: below },
  ];
}

// The cell that blocks only the horizontal straight position of a diagonal d from P.
function horizontalOnly([dx, dy]: Dir): Point {
  return cornerGap([dx, dy])[0];
}

// The cell that blocks only the vertical straight position of a diagonal d from P.
function verticalOnly([dx, dy]: Dir): Point {
  return cornerGap([dx, dy])[1];
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

const ANY = [0, 1] as const;
const TINY = [0, 1 / 4096] as const; // below every burst chance
const FAILS_KEEP = [KEEP, 1] as const; // a snipe's keep chance fails (2.4)
const FAILS_TURN = [TURN, 1] as const; // a snipe's random-turn chance fails (2.4)

// --- Games ---------------------------------------------------------------------------------

const games = new Map<string, GameState>();

function game(seed: number, skill: string): GameState {
  const key = `${seed} ${skill}`;
  let g = games.get(key);
  if (g === undefined) {
    g = createGame(seed, skill);
    games.set(key, g);
  }
  return g;
}

interface Setup {
  readonly skill?: string;
  readonly walls?: readonly Point[];
  readonly maze?: Grid;
  readonly player?: Point;
  readonly snipes?: readonly Snipe[];
  readonly ghosts?: readonly Ghost[];
  readonly snipeShots?: readonly Shot[];
  readonly rng?: Rng;
}

// A game at `skill` (M1 if not given) in a 320 x 320 open field with the given walls (or in
// `maze`), the player at P (or `player`), in play and free to step at once, and nothing else
// but what the setup names.
function arena(setup: Setup): GameState {
  const g = game(1, setup.skill ?? "M1");
  return {
    ...g,
    maze: setup.maze ?? grid(320, 320, setup.walls ?? []),
    player: { ...g.player, ...(setup.player ?? P) },
    hives: [],
    snipes: setup.snipes ?? [],
    ghosts: setup.ghosts ?? [],
    shots: [],
    snipeShots: setup.snipeShots ?? [],
    rng: setup.rng ?? g.rng,
    respawn: 0,
  };
}

// The states after each of `ticks` ticks with `input` held, the first being after tick 1.
function ticks(state: GameState, input: InputState, n: number): GameState[] {
  const result: GameState[] = [];
  let current = state;
  for (let t = 0; t < n; t++) {
    current = step(current, input);
    result.push(current);
  }
  return result;
}

function run(state: GameState, n: number, input = NO_INPUT): GameState {
  let current = state;
  for (let t = 0; t < n; t++) current = step(current, input);
  return current;
}

// What a test checks of a tick: where the player is, its lives and whether it is in play.
function look(state: GameState) {
  return {
    at: where(state.player),
    lives: state.lives,
    inPlay: state.respawn === 0,
  };
}

// The player killed by a wall on this tick, where it stood at `at`.
function died(before: GameState, at: Point = before.player) {
  return { at: where(at), lives: before.lives - 1, inPlay: false };
}

// The player alive and in play at `at`.
function alive(before: GameState, at: Point) {
  return { at: where(at), lives: before.lives, inPlay: true };
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
function snipe(p: Point, [dx, dy]: Dir): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx, dy, turn: 1 };
}

let ghostTemplate: Ghost | undefined;

// A ghost that appeared from a snipe hit on its spear half at D1, two ticks later, so that it
// steps on the next tick (2.4).
function readyGhost(): Ghost {
  if (ghostTemplate !== undefined) return ghostTemplate;
  const G = { x: 150, y: 150 };
  const g = game(1, "D1");
  // A snipe going right faces left; its right half, its spear half, is under a player's shot.
  let state: GameState = {
    ...g,
    maze: grid(320, 320),
    player: { ...g.player, x: 20, y: 20 },
    hives: [{ ...g.hives[0], x: 250, y: 250, hits: 0, wait: NEVER }],
    snipes: [snipe(G, RIGHT)],
    ghosts: [],
    shots: [{ x: G.x + 2, y: G.y, dx: 0, dy: 1 }],
    snipeShots: [],
    respawn: 0,
  };
  state = step(state, NO_INPUT);
  if (state.ghosts.length !== 1) {
    throw new Error("No ghost appeared from a hit on a snipe's spear half");
  }
  state = run(state, 2);
  ghostTemplate = state.ghosts[0];
  return ghostTemplate;
}

// A ghost at `p` going d that steps on the next tick, in straight mode or not.
function ghost(p: Point, [dx, dy]: Dir, straight = false): Ghost {
  return { ...readyGhost(), x: p.x, y: p.y, dx, dy, turn: 1, straight };
}

function lookGhost(g: Ghost) {
  return { x: g.x, y: g.y, dx: g.dx, dy: g.dy };
}

// ===========================================================================================

describe("2.2 Player / 2.10 Sizes: a straight step into a wall kills with deadly walls on", () => {
  it.each(STRAIGHTS)(
    "dies where it stands on stepping %s into a wall, losing one life",
    (_name, d) => {
      const state = arena({ walls: [wallAhead(d)] });
      // Guard: the wall is in the position the step would take, not in the player's.
      expect(fits(state.maze, P)).toBe(true);
      expect(fits(state.maze, plus(P, d))).toBe(false);
      const after = step(state, move(d));
      expect(look(after)).toEqual(died(state));
      expect(after.respawn).toBeGreaterThan(0);
    },
  );

  it.each(STRAIGHTS)("also dies stepping %s with Space held", (_name, d) => {
    const state = arena({ walls: [wallAhead(d)] });
    expect(look(step(state, move(d, true)))).toEqual(died(state));
  });

  it.each(STRAIGHTS)(
    "dies stepping %s when only a corner cell of the next position is a wall",
    (_name, [dx, dy]) => {
      // The cell at the far end of the row or column the step would add.
      const wall =
        dx !== 0
          ? { x: dx > 0 ? P.x + PLAYER : P.x - 1, y: P.y + PLAYER - 1 }
          : { x: P.x + PLAYER - 1, y: dy > 0 ? P.y + PLAYER : P.y - 1 };
      const state = arena({ walls: [wall] });
      expect(look(step(state, move([dx, dy])))).toEqual(died(state));
    },
  );

  it.each(STRAIGHTS)(
    "stays put stepping %s into a wall with deadly walls off, and does not die (B1)",
    (_name, d) => {
      const state = arena({ skill: "B1", walls: [wallAhead(d)] });
      for (const [t, s] of ticks(state, move(d), 30).entries()) {
        expect(look(s), `tick ${t + 1}`).toEqual(alive(state, P));
      }
    },
  );

  it("touches a wall across the maze edge, with wrap-around", () => {
    // The footprint covers columns 316 to 319; the wall is in column 0.
    const state = arena({
      walls: [{ x: 0, y: 30 }],
      player: { x: 316, y: 28 },
    });
    expect(look(step(state, move(RIGHT)))).toEqual(
      died(state, { x: 316, y: 28 }),
    );
    // Guard: without the wall the step wraps to column 317.
    const open = arena({ player: { x: 316, y: 28 } });
    expect(look(step(open, move(RIGHT)))).toEqual(
      alive(open, { x: 317, y: 28 }),
    );
  });
});

describe("2.2 Player / 2.10 Sizes: a diagonal into a wall kills with deadly walls on, with no slide", () => {
  it.each(DIAGONALS)(
    "dies going %s along a wall where it would slide sideways with deadly walls off",
    (_name, d) => {
      // The wall row the vertical part runs into: the horizontal step is open.
      const walls = wallRow(d[1]);
      const on = arena({ walls });
      expect(look(step(on, move(d)))).toEqual(died(on));
      const off = arena({ skill: "B1", walls });
      expect(look(step(off, move(d)))).toEqual(alive(off, plus(P, [d[0], 0])));
    },
  );

  it.each(DIAGONALS)(
    "dies going %s along a wall where it would slide up or down with deadly walls off",
    (_name, d) => {
      // The wall column the horizontal part runs into: the vertical step is open.
      const walls = wallColumn(d[0]);
      const on = arena({ walls });
      expect(look(step(on, move(d)))).toEqual(died(on));
      const off = arena({ skill: "B1", walls });
      expect(look(step(off, move(d)))).toEqual(alive(off, plus(P, [0, d[1]])));
    },
  );

  it.each(DIAGONALS)(
    "dies going %s when only the diagonal position covers a wall, both straight ones open",
    (_name, d) => {
      const walls = [cornerCell(d)];
      const on = arena({ walls });
      // Guard: the diagonal position is blocked, both straight positions are open.
      expect(fits(on.maze, plus(P, d))).toBe(false);
      expect(fits(on.maze, plus(P, [d[0], 0]))).toBe(true);
      expect(fits(on.maze, plus(P, [0, d[1]]))).toBe(true);
      expect(look(step(on, move(d)))).toEqual(died(on));
      // With deadly walls off it slides horizontally, the first possible (2.2).
      const off = arena({ skill: "B1", walls });
      expect(look(step(off, move(d)))).toEqual(alive(off, plus(P, [d[0], 0])));
    },
  );

  it.each(DIAGONALS)("dies going %s through a corner gap", (_name, d) => {
    const walls = cornerGap(d);
    const on = arena({ walls });
    // Guard: the diagonal position is open, both straight positions are blocked.
    expect(fits(on.maze, plus(P, d))).toBe(true);
    expect(fits(on.maze, plus(P, [d[0], 0]))).toBe(false);
    expect(fits(on.maze, plus(P, [0, d[1]]))).toBe(false);
    expect(look(step(on, move(d)))).toEqual(died(on));
    // With deadly walls off it stays put and lives.
    const off = arena({ skill: "B1", walls });
    for (const [t, s] of ticks(off, move(d), 30).entries()) {
      expect(look(s), `tick ${t + 1}`).toEqual(alive(off, P));
    }
  });

  it.each(DIAGONALS)(
    "dies going %s into a corner where both straight positions and the diagonal are walls",
    (_name, d) => {
      const walls = [...wallRow(d[1]), ...wallColumn(d[0])];
      const on = arena({ walls });
      expect(look(step(on, move(d)))).toEqual(died(on));
      const off = arena({ skill: "B1", walls });
      expect(look(step(off, move(d)))).toEqual(alive(off, P));
    },
  );

  it.each(DIAGONALS)(
    "dies going %s into a wall in a generated maze, where a slide would be possible",
    (_name, d) => {
      // From the start position (5 cells from the block's left wall line and 3 from its top
      // one, 2.10) it walks straight along the corridor until the vertical step is blocked,
      // keeping its column, then goes diagonally.
      const g = game(1, "M1");
      const maze = g.maze;
      let at = where(g.player);
      for (let n = 0; fits(maze, plus(at, [0, d[1]])); n++) {
        if (n > maze.height) throw new Error("No wall in the start column");
        at = plus(at, [0, d[1]]);
      }
      // Guard: the diagonal position covers a wall and the horizontal step is open, so with
      // deadly walls off it would slide.
      expect(fits(maze, plus(at, d))).toBe(false);
      expect(fits(maze, plus(at, [d[0], 0]))).toBe(true);
      const on = arena({ maze, player: at });
      expect(look(step(on, move(d)))).toEqual(died(on, at));
      const off = arena({ skill: "B1", maze, player: at });
      expect(look(step(off, move(d)))).toEqual(alive(off, plus(at, [d[0], 0])));
    },
  );
});

describe("2.2 Player / 2.10 Sizes: a diagonal with an open diagonal position is a plain step", () => {
  it.each(DIAGONALS)(
    "moves %s and lives when only the horizontal straight position is blocked",
    (_name, d) => {
      const state = arena({ walls: [horizontalOnly(d)] });
      // Guard: horizontal blocked, vertical and diagonal open.
      expect(fits(state.maze, plus(P, [d[0], 0]))).toBe(false);
      expect(fits(state.maze, plus(P, [0, d[1]]))).toBe(true);
      expect(fits(state.maze, plus(P, d))).toBe(true);
      expect(look(step(state, move(d)))).toEqual(alive(state, plus(P, d)));
    },
  );

  it.each(DIAGONALS)(
    "moves %s and lives when only the vertical straight position is blocked",
    (_name, d) => {
      const state = arena({ walls: [verticalOnly(d)] });
      expect(fits(state.maze, plus(P, [d[0], 0]))).toBe(true);
      expect(fits(state.maze, plus(P, [0, d[1]]))).toBe(false);
      expect(fits(state.maze, plus(P, d))).toBe(true);
      expect(look(step(state, move(d)))).toEqual(alive(state, plus(P, d)));
    },
  );

  it("passing along a wall is not touching it", () => {
    // A wall row right under the footprint and a wall column further on: walking right along
    // the row for 10 steps neither kills nor stops the player.
    const state = arena({ walls: wallRow(1) });
    const after = ticks(state, move(RIGHT), 30);
    for (const [t, s] of after.entries()) {
      expect(s.lives, `tick ${t + 1}`).toBe(state.lives);
      expect(s.respawn, `tick ${t + 1}`).toBe(0);
    }
    expect(where(after[29].player)).toEqual({ x: P.x + 10, y: P.y });
  });

  it("walking straight up to a wall kills only on the step into it", () => {
    // Four steps of room to the right, then a wall.
    const state = arena({ walls: [{ x: P.x + PLAYER + 4, y: P.y + 1 }] });
    const after = ticks(state, move(RIGHT), 13);
    // Steps on ticks 1, 4, 7 and 10, all alive; the next step, due on tick 13, kills.
    for (let t = 1; t <= 12; t++) {
      expect(look(after[t - 1]), `tick ${t}`).toEqual(
        alive(state, { x: P.x + Math.min(4, Math.floor((t + 2) / 3)), y: P.y }),
      );
    }
    expect(look(after[12])).toEqual(died(state, { x: P.x + 4, y: P.y }));
  });
});

describe("2.2 Player: touching is checked only when a step is due", () => {
  // One step of room to the right, then a wall column.
  const walls = wallColumn(1).map((c) => ({ x: c.x + 1, y: c.y }));

  it("holding a key against a wall kills on the next due step, 3 ticks after the last step", () => {
    const state = arena({ walls });
    const after = ticks(state, move(RIGHT), 4);
    const there = { x: P.x + 1, y: P.y };
    // Tick 1 steps next to the wall; ticks 2 and 3 are the wait; tick 4 is due and touches.
    expect(after.slice(0, 3).map(look)).toEqual([
      alive(state, there),
      alive(state, there),
      alive(state, there),
    ]);
    expect(look(after[3])).toEqual(died(state, there));
  });

  it("with Space held the next due step, and so the death, is 2 ticks after the last step", () => {
    const state = arena({ walls });
    const after = ticks(state, move(RIGHT, true), 3);
    const there = { x: P.x + 1, y: P.y };
    expect(after.slice(0, 2).map(look)).toEqual([
      alive(state, there),
      alive(state, there),
    ]);
    expect(look(after[2])).toEqual(died(state, there));
  });

  it("Space held at the step, not at the touch, sets the wait", () => {
    // Fast at the step on tick 1, normal after it: the wait is 1 tick, so tick 3 touches.
    const state = arena({ walls });
    let s = step(state, move(RIGHT, true));
    s = step(s, move(RIGHT));
    expect(look(s)).toEqual(alive(state, { x: P.x + 1, y: P.y }));
    expect(look(step(s, move(RIGHT)))).toEqual(
      died(state, { x: P.x + 1, y: P.y }),
    );
  });

  it("does not kill while the wait after a step is not over, whatever direction is held", () => {
    // After stepping right next to the wall column, it holds up-right and then down-right
    // during its wait (both touch the wall), and dies only on the due tick.
    const state = arena({ walls });
    const there = { x: P.x + 1, y: P.y };
    let s = step(state, move(RIGHT));
    s = step(s, move(UP_RIGHT));
    expect(look(s)).toEqual(alive(state, there));
    s = step(s, move(DOWN_RIGHT));
    expect(look(s)).toEqual(alive(state, there));
    expect(look(step(s, move(DOWN_RIGHT)))).toEqual(died(state, there));
  });

  it("does not kill with no key held next to a wall, and kills on the first tick a key into it is held", () => {
    const state = arena({ walls: [wallAhead(RIGHT)] });
    const still = ticks(state, NO_INPUT, 20);
    for (const [t, s] of still.entries()) {
      expect(look(s), `tick ${t + 1}`).toEqual(alive(state, P));
    }
    expect(look(step(still[19], move(RIGHT)))).toEqual(died(state));
  });

  it("does not kill holding only Space next to a wall", () => {
    const state = arena({ walls: [wallAhead(RIGHT)] });
    for (const [t, s] of ticks(state, move([0, 0], true), 20).entries()) {
      expect(look(s), `tick ${t + 1}`).toEqual(alive(state, P));
    }
  });

  it("a key released during the wait and pressed again later kills on the tick it is pressed", () => {
    const state = arena({ walls });
    const there = { x: P.x + 1, y: P.y };
    let s = step(state, move(RIGHT));
    s = run(s, 9);
    expect(look(s)).toEqual(alive(state, there));
    expect(look(step(s, move(RIGHT)))).toEqual(died(state, there));
  });
});

describe("2.8 Controls: opposite keys and deadly walls", () => {
  // Walls on all four sides of the footprint, next to it.
  const boxed = [
    ...wallRow(1),
    ...wallRow(-1),
    ...wallColumn(1),
    ...wallColumn(-1),
  ];

  it.each([
    ["Left + Right", ["ArrowLeft", "ArrowRight"]],
    ["Up + Down", ["ArrowUp", "ArrowDown"]],
    ["all four arrows", ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]],
    [
      "all four arrows and Space",
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"],
    ],
  ])("%s, cancelling to no direction, never touch a wall", (_name, keys) => {
    const state = arena({ walls: boxed });
    const input = inputFromKeys(new Set(keys));
    for (const [t, s] of ticks(state, input, 30).entries()) {
      expect(look(s), `tick ${t + 1}`).toEqual(alive(state, P));
    }
  });

  it("Left + Right + Up touches a wall above as Up does", () => {
    const state = arena({ walls: [wallAhead(UP)] });
    const input = inputFromKeys(
      new Set(["ArrowLeft", "ArrowRight", "ArrowUp"]),
    );
    expect(look(step(state, input))).toEqual(died(state));
  });

  it("Left + Right + Up next to walls on the left and right moves up and lives", () => {
    const state = arena({ walls: [...wallColumn(1), ...wallColumn(-1)] });
    const input = inputFromKeys(
      new Set(["ArrowLeft", "ArrowRight", "ArrowUp"]),
    );
    expect(look(step(state, input))).toEqual(alive(state, plus(P, UP)));
  });

  it("Up + Down + Right next to walls above and below moves right and lives", () => {
    const state = arena({ walls: [...wallRow(1), ...wallRow(-1)] });
    const input = inputFromKeys(
      new Set(["ArrowUp", "ArrowDown", "ArrowRight"]),
    );
    expect(look(step(state, input))).toEqual(alive(state, plus(P, RIGHT)));
  });
});

describe("2.6 Skill level: deadly walls only at M to Z", () => {
  it.each(DEADLY)("a step into a wall kills at %s", (letter) => {
    const state = arena({ skill: `${letter}1`, walls: [wallAhead(RIGHT)] });
    expect(look(step(state, move(RIGHT)))).toEqual(died(state));
  });

  it.each(SAFE)(
    "a step into a wall does not kill at %s: the player stays put",
    (letter) => {
      const state = arena({ skill: `${letter}1`, walls: [wallAhead(RIGHT)] });
      for (const [t, s] of ticks(state, move(RIGHT), 10).entries()) {
        expect(look(s), `tick ${t + 1}`).toEqual(alive(state, P));
      }
    },
  );

  it.each(DEADLY)("a diagonal through a corner gap kills at %s", (letter) => {
    const state = arena({
      skill: `${letter}1`,
      walls: cornerGap(DOWN_RIGHT),
    });
    expect(look(step(state, move(DOWN_RIGHT)))).toEqual(died(state));
  });

  it.each(SAFE)(
    "a diagonal along a wall slides and does not kill at %s",
    (letter) => {
      const state = arena({ skill: `${letter}1`, walls: wallRow(1) });
      expect(look(step(state, move(DOWN_RIGHT)))).toEqual(
        alive(state, plus(P, RIGHT)),
      );
    },
  );

  it.each([...DEADLY, ...SAFE])(
    "at %s an open step is taken as usual",
    (letter) => {
      const state = arena({ skill: `${letter}1` });
      expect(look(step(state, move(DOWN_RIGHT)))).toEqual(
        alive(state, plus(P, DOWN_RIGHT)),
      );
    },
  );
});

describe("2.2 Player / 2.4 Order within a tick: a player killed by a deadly wall", () => {
  it("is out of play from the death tick and comes back on the 120th tick after it", () => {
    const state = arena({ walls: [wallAhead(RIGHT)] });
    let s = step(state, move(RIGHT));
    expect(look(s)).toEqual(died(state));
    // Out of play, it neither moves nor dies again, though the key stays held.
    for (let t = 1; t < RESPAWN_TICKS; t++) {
      s = step(s, move(RIGHT));
      expect(look(s), `tick ${t} after the death`).toEqual(died(state));
    }
    s = step(s, move(RIGHT));
    expect(s.respawn).toBe(0);
    expect(s.lives).toBe(state.lives - 1);
  });

  it("does not move, not even by a slide", () => {
    // Along a wall below, down-right would slide right with deadly walls off.
    const state = arena({ walls: wallRow(1) });
    const after = step(state, move(DOWN_RIGHT));
    expect(look(after)).toEqual(died(state));
  });

  it("loses only one life when a snipe's shot also hits it on that tick", () => {
    // The shot covers the player's footprint already, so it hits in the first stage (2.5).
    const state = arena({
      walls: [wallAhead(RIGHT)],
      snipeShots: [{ x: P.x + 1, y: P.y + 1, dx: 1, dy: 0 }],
    });
    const after = step(state, move(RIGHT));
    expect(look(after)).toEqual(died(state));
  });

  it("does not fire on that tick", () => {
    const fire: InputState = { ...move(RIGHT), fireX: -1 };
    const state = arena({ walls: [wallAhead(RIGHT)] });
    const after = step(state, fire);
    expect(look(after)).toEqual(died(state));
    expect(after.shots).toEqual([]);
    expect(after.aim).toEqual(state.aim);
    // Guard: with deadly walls off it stays put and fires.
    const off = step(arena({ skill: "B1", walls: [wallAhead(RIGHT)] }), fire);
    expect(off.shots).toHaveLength(1);
    expect(off.shots[0]).toMatchObject({ dx: -1, dy: 0 });
  });

  // The player at P, a ghost two cells up and left of it (2.4): toward the player P is
  // down-right, X = Y = 1, and one step in P overlaps the player.
  const GA = { x: P.x - 2, y: P.y - 2 };

  it("blocks no ghost on that tick", () => {
    // A ghost in straight mode going down-right, onto the footprint where the player died.
    const state = arena({
      skill: "O1",
      walls: [wallAhead(RIGHT)],
      ghosts: [ghost(GA, DOWN_RIGHT, true)],
      rng: rngIn(TINY),
    });
    const after = step(state, move(RIGHT));
    expect(look(after)).toEqual(died(state));
    expect(after.ghosts.map(lookGhost)).toEqual([
      { ...plus(GA, DOWN_RIGHT), dx: 1, dy: 1 },
    ]);
    // Guard: with the player in play the same ghost is blocked and turns one-eighth
    // clockwise, down.
    const guard = step(state, NO_INPUT);
    expect(guard.ghosts.map(lookGhost)).toEqual([
      { ...plus(GA, DOWN), dx: 0, dy: 1 },
    ]);
  });

  it("causes no ghost's burst draw on that tick", () => {
    // Out of play, the ghost takes its side step (Y = 1, P down-right: right) toward where
    // the player died, with no draw.
    const state = arena({
      skill: "O1",
      walls: [wallAhead(RIGHT)],
      ghosts: [ghost(GA, LEFT)],
      rng: rngIn(TINY),
    });
    const after = step(state, move(RIGHT));
    expect(look(after)).toEqual(died(state));
    expect(after.ghosts.map(lookGhost)).toEqual([
      { ...plus(GA, RIGHT), dx: 1, dy: 0 },
    ]);
    expect(drawsUsed(state.rng, after.rng)).toBe(0);
    // Guard: with the player in play the ghost draws its burst chance and bursts.
    const guard = step(state, NO_INPUT);
    expect(guard.ghosts).toEqual([]);
    expect(guard.lives).toBe(state.lives - 1);
    expect(drawsUsed(state.rng, guard.rng)).toBe(1);
  });

  // Along a wall below, down-right kills where the player stood, at P; with deadly walls off
  // the player slides right, to P + (1, 0).
  const below = wallRow(1);

  it("is where the ghosts aim on that tick, not where a slide would have taken it", () => {
    // A ghost 1 column left of P and 10 rows up. Toward P: |dx| < 2, so P is down, X = 0 and
    // Y = 5: it tries down turned a quarter clockwise, left (2.4 sub-step 1.5). Toward
    // P + (1, 0): P is down-right, X = 1: the candidate is down (sub-step 1.4).
    const at = { x: P.x - 1, y: P.y - 10 };
    const on = arena({
      skill: "O1",
      walls: below,
      ghosts: [ghost(at, LEFT)],
    });
    const dead = step(on, move(DOWN_RIGHT));
    expect(look(dead)).toEqual(died(on));
    expect(dead.ghosts.map(lookGhost)).toEqual([
      { ...plus(at, LEFT), dx: -1, dy: 0 },
    ]);
    // Guard: with deadly walls off (D1) the player slides and the ghost goes down.
    const off = arena({ skill: "D1", walls: below, ghosts: [ghost(at, LEFT)] });
    const slid = step(off, move(DOWN_RIGHT));
    expect(look(slid)).toEqual(alive(off, plus(P, RIGHT)));
    expect(slid.ghosts.map(lookGhost)).toEqual([
      { ...plus(at, DOWN), dx: 0, dy: 1 },
    ]);
  });

  it("is where the snipes aim on that tick, not where a slide would have taken it", () => {
    // A snipe 1 column left of P and 20 rows up whose keep and random-turn chances fail, so
    // it takes the direction to the player (2.4): toward P, |dx| < 2, so down; toward
    // P + (1, 0), down-right.
    const at = { x: P.x - 1, y: P.y - 20 };
    const rng = rngIn(FAILS_KEEP, FAILS_TURN, ANY, ANY);
    const on = arena({ walls: below, snipes: [snipe(at, LEFT)], rng });
    const dead = step(on, move(DOWN_RIGHT));
    expect(look(dead)).toEqual(died(on));
    expect(
      dead.snipes.map((s) => ({ x: s.x, y: s.y, dx: s.dx, dy: s.dy })),
    ).toEqual([{ ...plus(at, DOWN), dx: 0, dy: 1 }]);
    // Guard: with deadly walls off (B1, the same accuracy) the snipe goes down-right.
    const off = arena({
      skill: "B1",
      walls: below,
      snipes: [snipe(at, LEFT)],
      rng,
    });
    const slid = step(off, move(DOWN_RIGHT));
    expect(look(slid)).toEqual(alive(off, plus(P, RIGHT)));
    expect(
      slid.snipes.map((s) => ({ x: s.x, y: s.y, dx: s.dx, dy: s.dy })),
    ).toEqual([{ ...plus(at, DOWN_RIGHT), dx: 1, dy: 1 }]);
  });
});

// A seed whose start block has a wall cell in its left wall line next to the start position,
// so that walking left from the start touches it after 5 steps.
function seedWithLeftWall(): number {
  for (let seed = 1; seed < 1000; seed++) {
    const g = game(seed, "M1");
    const { x, y } = g.player;
    const line = x - 6; // 2.10: 5 open cells between the wall line and the footprint
    for (let dy = 0; dy < PLAYER; dy++) {
      if (cellAt(g.maze, { x: line, y: y + dy }) === "wall") return seed;
    }
  }
  throw new Error("No seed with a wall left of the start");
}

describe("2.2 Player: dying on a deadly wall in a generated maze, and coming back", () => {
  it("walks to the wall, dies where it stood, comes back farthest from there, and moves at once with the key still held", () => {
    const seed = seedWithLeftWall();
    const g = game(seed, "M1");
    const state: GameState = {
      ...g,
      hives: [],
      snipes: [],
      ghosts: [],
      shots: [],
      snipeShots: [],
    };
    const start = where(g.player);
    const left = move(LEFT);
    const after = ticks(state, left, 16 + RESPAWN_TICKS + 1);
    // Steps on ticks 1, 4, 7, 10 and 13; tick 16 is due and touches the wall line.
    const wall = { x: start.x - 5, y: start.y };
    expect(look(after[12])).toEqual(alive(state, wall));
    expect(look(after[14])).toEqual(alive(state, wall));
    expect(look(after[15])).toEqual(died(state, wall));
    // Out of play for the 119 ticks after the death tick.
    for (let t = 16; t < 16 + RESPAWN_TICKS - 1; t++) {
      expect(look(after[t]), `tick ${t + 1}`).toEqual(died(state, wall));
    }
    // Back on the 120th tick after it, at the start position of the block 8 columns and 10
    // rows from the one where it died, the farthest of the 16 x 20 blocks.
    const back = {
      x: mod(start.x + 8 * BLOCK_W, g.maze.width),
      y: mod(start.y + 10 * BLOCK_H, g.maze.height),
    };
    const respawned = after[16 + RESPAWN_TICKS - 1];
    expect(look(respawned)).toEqual(
      alive({ ...state, lives: state.lives - 1 }, back),
    );
    // The next tick it steps left with the key held since before the death.
    expect(look(after[16 + RESPAWN_TICKS])).toEqual(
      alive({ ...state, lives: state.lives - 1 }, plus(back, LEFT)),
    );
  });

  it.each(STRAIGHTS)(
    "moves %s on the first tick after a respawn",
    (_name, d) => {
      const seed = seedWithLeftWall();
      const g = game(seed, "M1");
      const state: GameState = {
        ...g,
        hives: [],
        snipes: [],
        ghosts: [],
        shots: [],
        snipeShots: [],
        respawn: 1,
      };
      // It comes back on this tick, holding the key already.
      const back = step(state, move(d));
      expect(back.respawn).toBe(0);
      const next = step(back, move(d));
      expect(look(next)).toEqual(alive(back, plus(back.player, d)));
    },
  );

  it("with deadly walls off, the same walk stays put at the wall and never dies (B1)", () => {
    const seed = seedWithLeftWall();
    const g = game(seed, "B1");
    const state: GameState = {
      ...g,
      hives: [],
      snipes: [],
      ghosts: [],
      shots: [],
      snipeShots: [],
    };
    const after = ticks(state, move(LEFT), 60);
    const wall = { x: g.player.x - 5, y: g.player.y };
    for (let t = 12; t < 60; t++) {
      expect(look(after[t]), `tick ${t + 1}`).toEqual(alive(state, wall));
    }
  });
});
