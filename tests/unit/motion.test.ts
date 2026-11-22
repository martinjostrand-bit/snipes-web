import { describe, expect, it } from "vitest";
import { createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";
// A namespace import, so that a missing export fails these tests one by one, not the file.
import * as view from "../../src/render/view";

// Spec 3 (Motion) and 9.1 WP 11b: the game logic moves in whole cells, but the screen shows
// smooth motion.
//
// `drawnPositions(state, alpha)` in src/render/view.ts gives where everything in `state` is
// drawn, `alpha` (0 <= alpha < 1) of a tick after `step` made `state`: the fraction of the
// tick that has passed, as `carriedMs / TICK_MS` after `advance` (4.3). It returns
// `{ player, snipes, shots, snipeShots }`: the drawn top-left cell of the player's footprint
// and one point per entry of `state.snipes`, `state.shots` and `state.snipeShots`, in their
// order, in maze cells that may be fractional. Points are compared modulo the maze's size,
// so a drawn point may or may not be wrapped into the grid. It does not change `state`.
//
// What the tests expect, from spec 3:
// - The player and each snipe slide at an even speed from the cell of their last step to
//   their current cell, arriving when their next step is due. A step on tick T from A to B is
//   drawn at A + (B - A) * min(1, (k - T + alpha) / D) on tick k >= T, where D is the ticks
//   from that step until the next is due: 3 for the player, 2 with Space held at that step
//   (2.2); 10 for a snipe's straight step and 13 for a diagonal one (2.4). So it is drawn at
//   A just as it steps, reaches B just as its next step is due, and stays at B while it does
//   not step again.
// - Shots, which move every tick, slide between their last two positions by the fraction of
//   the tick that has passed: a shot that moved from A to B on tick k is drawn at
//   A + (B - A) * alpha. A shot fired on tick k has only one position yet, and is drawn there.
// - A move across a maze edge slides the short way: B - A is one cell, never most of the maze.
// - Nothing slides into the game: at the start, a new snipe and a respawned player are drawn
//   in place until they step.
// - The view follows the player's drawn position (`viewOrigin`, tests/unit/view.test.ts), so
//   it scrolls smoothly. Only a respawn and a new snipe appear without sliding, so a player
//   that dies during a slide (2.2: it is then out of play and not drawn) is still drawn
//   sliding on to its cell, and the view with it; the view does not jump until it comes back.
//
// The tests only build games from `createGame` by changing the maze, the hives and the PRNG,
// and leave the player, snipes and shots to the game, so that whatever the state keeps about
// the last step is the game's own. The tests of a death mid-slide also add a snipe or a
// snipe's shot to kill the player, and check only where the player is drawn.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];

interface Drawn {
  readonly player: Point;
  readonly snipes: readonly Point[];
  readonly shots: readonly Point[];
  readonly snipeShots: readonly Point[];
}

function drawn(state: GameState, alpha: number): Drawn {
  return view.drawnPositions(state, alpha);
}

const STEP_TICKS = 3; // ticks from a step of the player to its next (2.2)
const FAST_STEP_TICKS = 2; // the same with Space held at the step (2.2)
const STRAIGHT_TICKS = 10; // ticks from a snipe's straight step to its next (2.4)
const DIAGONAL_TICKS = 13; // ticks from a snipe's diagonal step to its next (2.4)
const SIGHT = 80 / 2 - 4 / 2; // view columns left of the player's footprint (3)
const SIGHT_ROWS = 44 / 2 - 4 / 2; // view rows above it (3)
const PATIENCE = 60 * 60; // a minute of ticks, the longest a test waits for something
// Fractions of a tick, exact in binary so that the expected points are exact.
const ALPHAS = [0, 0.25, 0.5, 0.75, 0.96875];
const EXACT = 1e-9;

const EIGHT: [name: string, d: Dir][] = [
  ["up", [0, -1]],
  ["up-right", [1, -1]],
  ["right", [1, 0]],
  ["down-right", [1, 1]],
  ["down", [0, 1]],
  ["down-left", [-1, 1]],
  ["left", [-1, 0]],
  ["up-left", [-1, -1]],
];

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// The signed difference a - b on an axis that wraps after `size`, between -size/2 and size/2.
function apart(a: number, b: number, size: number): number {
  const d = mod(a - b, size);
  return d > size / 2 ? d - size : d;
}

// How far apart two points are, the short way on each axis, in cells (the larger axis).
function distance(maze: Grid, a: Point, b: Point): number {
  return Math.max(
    Math.abs(apart(a.x, b.x, maze.width)),
    Math.abs(apart(a.y, b.y, maze.height)),
  );
}

// The point `progress` (0 to 1) of the way from `from` to `to`, going the short way.
function between(maze: Grid, from: Point, to: Point, progress: number): Point {
  return {
    x: from.x + apart(to.x, from.x, maze.width) * progress,
    y: from.y + apart(to.y, from.y, maze.height) * progress,
  };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

function show(p: Point): string {
  return `${p.x},${p.y}`;
}

function hold(
  moveX: Axis,
  moveY: Axis,
  fast = false,
  fireX: Axis = 0,
  fireY: Axis = 0,
): InputState {
  return { moveX, moveY, fast, fireX, fireY };
}

// An open field with no walls, wrapping at its edges.
function field(width: number, height: number): Grid {
  return createGrid(width, height, () => "open");
}

// A new game whose maze is `maze`, with no hives: the player is at its start (2.10), 14,10.
function game(maze: Grid, seed = 1): GameState {
  return { ...createGame(seed), maze, hives: [] };
}

// A hive like a new game's at `p`, with no hits taken.
function hiveAt(p: Point): GameState["hives"][number] {
  return { ...createGame(1).hives[0], x: p.x, y: p.y, hits: 0 };
}

// Runs one input per tick from `start`; states[k] is the state after tick k, states[0] the
// start.
function run(start: GameState, inputs: readonly InputState[]): GameState[] {
  const states = [start];
  for (const input of inputs)
    states.push(step(states[states.length - 1], input));
  return states;
}

function times<T>(n: number, value: T): T[] {
  return Array.from({ length: n }, () => value);
}

// Inputs drawn from a PRNG of the test's own: each held for 1 to 8 ticks.
function randomInputs(seed: number, ticks: number): InputState[] {
  const axes: Axis[] = [-1, 0, 1];
  let rng: Rng = createRng(seed);
  const draw = (n: number): number => {
    let v: number;
    [v, rng] = nextFloat(rng);
    return Math.floor(v * n);
  };
  const inputs: InputState[] = [];
  while (inputs.length < ticks) {
    const input = hold(
      axes[draw(3)],
      axes[draw(3)],
      draw(3) === 0,
      axes[draw(3)],
      axes[draw(3)],
    );
    inputs.push(...times(1 + draw(8), input));
  }
  return inputs.slice(0, ticks);
}

// --- The model of spec 3 -------------------------------------------------------------------

interface Slide {
  readonly from: Point;
  readonly to: Point;
  /** The tick of the step. */
  readonly tick: number;
  /** Ticks from the step until the next is due. */
  readonly ticks: number;
}

function slideAt(maze: Grid, slide: Slide, tick: number, alpha: number) {
  const progress = Math.min(1, (tick - slide.tick + alpha) / slide.ticks);
  return between(maze, slide.from, slide.to, progress);
}

// Where the model draws the player on every tick of a run (undefined while out of play), as
// a function of the tick and the fraction of it.
function playerModel(
  states: readonly GameState[],
  inputs: readonly InputState[],
): ((alpha: number) => Point | undefined)[] {
  const { maze } = states[0];
  let slide: Slide | undefined;
  return states.map((state, k) => {
    if (k > 0) {
      const before = states[k - 1];
      if (before.respawn > 0 && state.respawn === 0) slide = undefined;
      else if (
        state.respawn === 0 &&
        distance(maze, before.player, state.player) > 0
      ) {
        slide = {
          from: where(before.player),
          to: where(state.player),
          tick: k,
          ticks: inputs[k - 1].fast ? FAST_STEP_TICKS : STEP_TICKS,
        };
      }
    }
    const current = slide;
    if (state.respawn > 0) return () => undefined;
    if (current === undefined) return () => where(state.player);
    return (alpha) => slideAt(maze, current, k, alpha);
  });
}

// Where the model draws snipe `index` (by its place in `state.snipes`) on every tick from
// the one it appears on; undefined before.
function snipeModel(
  states: readonly GameState[],
  index: number,
): ((alpha: number) => Point | undefined)[] {
  const { maze } = states[0];
  let slide: Slide | undefined;
  return states.map((state, k) => {
    const snipe = state.snipes[index];
    if (snipe === undefined) return () => undefined;
    const before = k > 0 ? states[k - 1].snipes[index] : undefined;
    if (before !== undefined && distance(maze, before, snipe) > 0) {
      const diagonal =
        apart(before.x, snipe.x, maze.width) !== 0 &&
        apart(before.y, snipe.y, maze.height) !== 0;
      slide = {
        from: where(before),
        to: where(snipe),
        tick: k,
        ticks: diagonal ? DIAGONAL_TICKS : STRAIGHT_TICKS,
      };
    }
    const current = slide;
    if (current === undefined) return () => where(snipe);
    return (alpha) => slideAt(maze, current, k, alpha);
  });
}

// Where the model draws the only shot in `list` on every tick that has exactly one there,
// starting with a tick on which a new shot appeared in an empty list.
function shotModel(
  states: readonly GameState[],
  list: "shots" | "snipeShots",
): ((alpha: number) => Point | undefined)[] {
  const { maze } = states[0];
  return states.map((state, k) => {
    const shot = state[list][0];
    if (state[list].length !== 1) return () => undefined;
    const before = k > 0 ? states[k - 1][list] : [];
    if (before.length === 0) return () => where(shot);
    const from = where(before[0]);
    return (alpha) => between(maze, from, where(shot), alpha);
  });
}

// Every difference between the drawn points and the model's, at every tick and fraction.
function differences(
  states: readonly GameState[],
  model: readonly ((alpha: number) => Point | undefined)[],
  pick: (d: Drawn, state: GameState) => Point | undefined,
  what: string,
): string[] {
  const { maze } = states[0];
  const problems: string[] = [];
  states.forEach((state, k) => {
    for (const alpha of ALPHAS) {
      const expected = model[k](alpha);
      if (expected === undefined) continue;
      const actual = pick(drawn(state, alpha), state);
      if (actual === undefined || distance(maze, actual, expected) > EXACT) {
        problems.push(
          `${what} on tick ${k} at ${alpha}: drawn at ${actual === undefined ? "nothing" : show(actual)}, expected ${show(expected)}`,
        );
      }
    }
  });
  return problems.slice(0, 8);
}

function playerDifferences(
  states: readonly GameState[],
  inputs: readonly InputState[],
): string[] {
  return differences(
    states,
    playerModel(states, inputs),
    (d) => d.player,
    "player",
  );
}

// The ticks on which the player stepped.
function stepTicks(states: readonly GameState[]): number[] {
  const { maze } = states[0];
  const ticks: number[] = [];
  for (let k = 1; k < states.length; k++) {
    const [a, b] = [states[k - 1], states[k]];
    if (a.respawn === 0 && b.respawn === 0) {
      if (distance(maze, a.player, b.player) > 0) ticks.push(k);
    }
  }
  return ticks;
}

// --- Snipes from a hive --------------------------------------------------------------------

interface Snipes {
  /** The states from the tick the first snipe appeared until just before a second one did. */
  readonly states: GameState[];
}

// A game in `maze` with one hive at `hive` and the game's PRNG from `seed`, from the tick its
// first snipe appears until just before another appears, at most `ticks` ticks.
function firstSnipe(
  maze: Grid,
  hive: Point,
  seed: number,
  ticks: number,
): Snipes | undefined {
  let state: GameState = {
    ...game(maze),
    hives: [{ ...hiveAt(hive), wait: 0 }],
    rng: createRng(seed),
  };
  for (let t = 0; t < PATIENCE && state.snipes.length === 0; t++) {
    state = step(state, NO_INPUT);
  }
  if (state.snipes.length !== 1) return undefined;
  const states = [state];
  for (let t = 0; t < ticks; t++) {
    const next = step(states[states.length - 1], NO_INPUT);
    if (next.snipes.length !== 1) break;
    states.push(next);
  }
  return { states };
}

// The snipe's steps in `states`: [tick, diagonal] for each tick it moved.
function snipeSteps(states: readonly GameState[]): [number, boolean][] {
  const { maze } = states[0];
  const result: [number, boolean][] = [];
  for (let k = 1; k < states.length; k++) {
    const [a, b] = [states[k - 1].snipes[0], states[k].snipes[0]];
    if (distance(maze, a, b) > 0) {
      result.push([
        k,
        apart(a.x, b.x, maze.width) !== 0 && apart(a.y, b.y, maze.height) !== 0,
      ]);
    }
  }
  return result;
}

// Whether the snipe crossed a maze edge in `states`.
function crossesEdge(states: readonly GameState[]): boolean {
  for (let k = 1; k < states.length; k++) {
    const [a, b] = [states[k - 1].snipes[0], states[k].snipes[0]];
    if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) return true;
  }
  return false;
}

// The first PRNG seed for which `pick` accepts the first snipe's run.
function findSnipes(
  maze: Grid,
  hive: Point,
  ticks: number,
  pick: (s: Snipes) => boolean,
): Snipes {
  for (let seed = 0; seed < 2000; seed++) {
    const found = firstSnipe(maze, hive, seed, ticks);
    if (found !== undefined && pick(found)) return found;
  }
  throw new Error("No PRNG seed gives the snipe this case needs");
}

// ===========================================================================================

describe("3 Presentation: Motion — drawnPositions gives a place for everything drawn", () => {
  it("gives one point for each snipe, player's shot and snipe's shot, in a busy game", () => {
    let state = createGame(7, "A9");
    const inputs = randomInputs(7, 1500);
    let busy = 0;
    for (const input of inputs) {
      state = step(state, input);
      const d = drawn(state, 0.5);
      expect(d.snipes).toHaveLength(state.snipes.length);
      expect(d.shots).toHaveLength(state.shots.length);
      expect(d.snipeShots).toHaveLength(state.snipeShots.length);
      for (const p of [d.player, ...d.snipes, ...d.shots, ...d.snipeShots]) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
      if (state.snipes.length > 0 && state.shots.length > 0) busy++;
    }
    // The test's own check that the game had snipes and shots to draw.
    expect(busy).toBeGreaterThan(0);
  });

  it("does not change the state", () => {
    const states = run(createGame(3, "A9"), randomInputs(3, 600));
    const last = states[states.length - 1];
    const copy = structuredClone(last);
    for (const alpha of ALPHAS) drawn(last, alpha);
    expect(last).toEqual(copy);
  });

  it("gives the same points for the same state and fraction", () => {
    const states = run(createGame(4, "A9"), randomInputs(4, 600));
    for (const state of states.slice(-20)) {
      expect(drawn(state, 0.25)).toEqual(drawn(structuredClone(state), 0.25));
    }
  });
});

describe("3 Presentation: Motion — the player slides between cells at an even speed", () => {
  const open = field(40, 30);

  it.each([1, 2, 42, 2026])(
    "is drawn on its cell at the start of a game, at every fraction of the tick (seed %d)",
    (seed) => {
      const start = createGame(seed);
      const states = run(start, times(5, NO_INPUT));
      for (const state of states) {
        for (const alpha of ALPHAS) {
          const p = drawn(state, alpha).player;
          expect(
            distance(state.maze, p, start.player),
            `at ${alpha}`,
          ).toBeLessThan(EXACT);
        }
      }
    },
  );

  it("slides one step to the right over the 3 ticks until its next step is due", () => {
    // Right is held on tick 1 only: the player steps from 14,10 to 15,10 on tick 1.
    const states = run(game(open), [hold(1, 0), ...times(6, NO_INPUT)]);
    expect(where(states[1].player)).toEqual({ x: 15, y: 10 });
    const cases: [tick: number, alpha: number, x: number][] = [
      [1, 0, 14],
      [1, 0.5, 14 + 1 / 6],
      [2, 0, 14 + 1 / 3],
      [2, 0.75, 14 + 1 / 3 + 1 / 4],
      [3, 0, 14 + 2 / 3],
      [3, 0.5, 14 + 5 / 6],
      [4, 0, 15],
      [4, 0.5, 15],
      [6, 0.96875, 15],
    ];
    for (const [tick, alpha, x] of cases) {
      const p = drawn(states[tick], alpha).player;
      expect(p.x, `tick ${tick} at ${alpha}`).toBeCloseTo(x, 9);
      expect(p.y, `tick ${tick} at ${alpha}`).toBeCloseTo(10, 9);
    }
  });

  it("slides one step with Space held over the 2 ticks until its next step is due", () => {
    // Down with Space on tick 1: the player steps from 14,10 to 14,11.
    const states = run(game(open), [hold(0, 1, true), ...times(4, NO_INPUT)]);
    expect(where(states[1].player)).toEqual({ x: 14, y: 11 });
    const cases: [tick: number, alpha: number, y: number][] = [
      [1, 0, 10],
      [1, 0.5, 10.25],
      [2, 0, 10.5],
      [2, 0.5, 10.75],
      [3, 0, 11],
      [4, 0.5, 11],
    ];
    for (const [tick, alpha, y] of cases) {
      const p = drawn(states[tick], alpha).player;
      expect(p.x, `tick ${tick} at ${alpha}`).toBeCloseTo(14, 9);
      expect(p.y, `tick ${tick} at ${alpha}`).toBeCloseTo(y, 9);
    }
  });

  it.each(EIGHT)(
    "holding %s, slides evenly from cell to cell, at normal speed and with Space",
    (_name, [dx, dy]) => {
      for (const fast of [false, true]) {
        const inputs = times(40, hold(dx, dy, fast));
        const states = run(game(open), inputs);
        expect(stepTicks(states).length).toBeGreaterThan(10);
        expect(playerDifferences(states, inputs), `fast ${fast}`).toEqual([]);
      }
    },
  );

  it.each(EIGHT)(
    "holding %s, arrives at each cell just as it steps on from it",
    (_name, [dx, dy]) => {
      const states = run(game(open), times(30, hold(dx, dy)));
      const ticks = stepTicks(states);
      expect(ticks.length).toBeGreaterThan(5);
      const problems: string[] = [];
      for (const k of ticks) {
        // Just as it steps it is drawn on the cell it steps from, the one the last step
        // took it to.
        const at = drawn(states[k], 0).player;
        if (distance(open, at, states[k - 1].player) > EXACT) {
          problems.push(
            `tick ${k}: drawn at ${show(at)}, not ${show(states[k - 1].player)}`,
          );
        }
        // Just before, it is nearly there.
        const nearly = drawn(states[k - 1], 0.96875).player;
        if (
          k > ticks[0] &&
          distance(open, nearly, states[k - 1].player) > 1 / 3
        ) {
          problems.push(
            `tick ${k - 1}: drawn at ${show(nearly)}, far from its cell`,
          );
        }
      }
      expect(problems).toEqual([]);
    },
  );

  it("stays on its cell once it has arrived, until it steps again, and then slides from there", () => {
    const inputs = [
      ...times(2, hold(1, 0)),
      ...times(9, NO_INPUT),
      ...times(3, hold(0, 1, true)),
      ...times(1, NO_INPUT),
      ...times(4, hold(-1, -1)),
      ...times(7, NO_INPUT),
      ...times(5, hold(1, 1, true)),
      ...times(6, NO_INPUT),
    ];
    const states = run(game(open), inputs);
    expect(playerDifferences(states, inputs)).toEqual([]);
    // After the last step has had its time, it is drawn on its cell.
    const last = states[states.length - 1];
    for (const alpha of ALPHAS) {
      expect(
        distance(open, drawn(last, alpha).player, last.player),
      ).toBeLessThan(EXACT);
    }
  });

  it.each(EIGHT.filter(([, [dx, dy]]) => dx === 0 || dy === 0))(
    "does not slide while a held direction (%s) is blocked by a wall in a generated maze",
    (_name, [dx, dy]) => {
      // Going straight, the player meets a wall within 19 blocks: a whole row or column of
      // blocks open all the way round would be a cycle, and the maze has none (2.1).
      const inputs = times(800, hold(dx, dy));
      const states = run(createGame(5), inputs);
      expect(playerDifferences(states, inputs)).toEqual([]);
      const last = states[states.length - 1];
      // The test's own check that it has been blocked for a while.
      expect(stepTicks(states.slice(-20))).toEqual([]);
      for (const alpha of ALPHAS) {
        expect(
          distance(last.maze, drawn(last, alpha).player, last.player),
        ).toBeLessThan(EXACT);
      }
    },
  );

  it.each([1, 2, 3, 4])(
    "matches the slide model for any keys held in a generated maze (seed %d)",
    (seed) => {
      const inputs = randomInputs(100 + seed, 900);
      const states = run(createGame(seed), inputs);
      expect(stepTicks(states).length).toBeGreaterThan(20);
      expect(playerDifferences(states, inputs)).toEqual([]);
    },
  );
});

describe("3 Presentation: Motion — across a maze edge the player slides the short way", () => {
  const open = field(40, 30);

  it.each(EIGHT)("holding %s across the edges", (_name, [dx, dy]) => {
    const inputs = times(100, hold(dx, dy));
    const states = run(game(open), inputs);
    // The test's own check that the player crossed an edge.
    const crossed = states.some(
      (s, k) =>
        k > 0 &&
        (Math.abs(s.player.x - states[k - 1].player.x) > 1 ||
          Math.abs(s.player.y - states[k - 1].player.y) > 1),
    );
    expect(crossed).toBe(true);
    expect(playerDifferences(states, inputs)).toEqual([]);
    // Drawn never more than one cell from its cell.
    for (const state of states) {
      for (const alpha of ALPHAS) {
        expect(
          distance(open, drawn(state, alpha).player, state.player),
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is drawn half a cell past the left edge halfway through a step from column 0 to the last column", () => {
    // Left from 14,10: column 0 is reached on tick 40 (the 14th step), the last column on
    // tick 43; halfway through that step is tick 44 plus half a tick.
    const states = run(game(open), times(45, hold(-1, 0)));
    expect(states[43].player.x).toBe(39);
    expect(states[40].player.x).toBe(0);
    const p = drawn(states[44], 0.5).player;
    expect(mod(p.x, 40)).toBeCloseTo(39.5, 9);
    expect(mod(p.y, 30)).toBeCloseTo(10, 9);
  });

  it("is drawn half a cell past the bottom edge halfway through a step from the last row to row 0", () => {
    // Down from 14,10: row 29 is reached on tick 55 (the 19th step), row 0 on tick 58.
    const states = run(game(open), times(60, hold(0, 1)));
    expect(states[55].player.y).toBe(29);
    expect(states[58].player.y).toBe(0);
    const p = drawn(states[59], 0.5).player;
    expect(mod(p.x, 40)).toBeCloseTo(14, 9);
    expect(mod(p.y, 30)).toBeCloseTo(29.5, 9);
  });
});

describe("3 Presentation: Motion — a respawned player appears in place without sliding", () => {
  interface Back {
    readonly died: GameState;
    readonly back: GameState;
  }

  // A generated maze with a hive just below the player's start, whose snipes kill the player
  // soon; the state on the tick of the death and on the tick it is back in play.
  function deathAndReturn(): Back {
    for (let seed = 1; seed <= 50; seed++) {
      const start = createGame(seed);
      // 14..17 x 14..17 is open in every generated maze: the start's block has open rows 7
      // to 17 and open columns 9 to 23 (2.10).
      let state: GameState = { ...start, hives: [hiveAt({ x: 14, y: 14 })] };
      let died: GameState | undefined;
      for (let t = 0; t < PATIENCE && died === undefined; t++) {
        state = step(state, NO_INPUT);
        if (state.lives < start.lives) died = state;
      }
      if (died === undefined) continue;
      for (let t = 0; t < PATIENCE && state.respawn > 0; t++) {
        state = step(state, NO_INPUT);
      }
      if (state.respawn === 0) return { died, back: state };
    }
    throw new Error("No seed in which the player dies and comes back");
  }

  it("is drawn where it comes back, at every fraction of the tick it comes back on", () => {
    const { died, back } = deathAndReturn();
    // The test's own check: it comes back somewhere else than where it died.
    expect(distance(back.maze, back.player, died.player)).toBeGreaterThan(4);
    for (const alpha of ALPHAS) {
      const p = drawn(back, alpha).player;
      expect(distance(back.maze, p, back.player), `at ${alpha}`).toBeLessThan(
        EXACT,
      );
    }
  });

  it("stays in place until it steps, then slides from where it came back", () => {
    const { back } = deathAndReturn();
    // From a block's start position there are 6 open cells to the right (2.10).
    const inputs = [...times(4, NO_INPUT), ...times(10, hold(1, 0))];
    const states = run(back, inputs);
    for (const state of states.slice(0, 5)) {
      for (const alpha of ALPHAS) {
        expect(
          distance(back.maze, drawn(state, alpha).player, back.player),
        ).toBeLessThan(EXACT);
      }
    }
    // The first step is on tick 5: drawn just then on the cell it came back to.
    expect(distance(back.maze, states[5].player, back.player)).toBe(1);
    expect(
      distance(back.maze, drawn(states[5], 0).player, back.player),
    ).toBeLessThan(EXACT);
    expect(playerDifferences(states, inputs)).toEqual([]);
  });
});

describe("3 Presentation: Motion — a player that dies mid-slide keeps sliding to its cell", () => {
  // An open field of 8 x 8 blocks (2.10), so that there are safe blocks to come back to.
  const open = field(128, 96);
  const RIGHT: InputState = hold(1, 0);

  // A snipe that has just appeared, from a hive in the field, copied to `p`. Only where the
  // player is drawn is checked, so what else the snipe holds does not matter.
  function snipeAt(p: Point): GameState["snipes"][number] {
    const found = firstSnipe(open, { x: 80, y: 60 }, 1, 0);
    if (found === undefined) throw new Error("No snipe appeared");
    return { ...found.states[0].snipes[0], x: p.x, y: p.y };
  }

  interface Death {
    /** States from the start; the player steps from 14,10 to 15,10 on tick 1. */
    readonly states: GameState[];
    /** The tick it dies on. */
    readonly died: number;
    /** The ticks from the step to the next one being due. */
    readonly ticks: number;
  }

  // The player steps right on tick 1 and dies on that tick, touching a snipe after its move
  // (2.4): the snipe's footprint starts at column 18, next to the player's 14..17 before the
  // step and on its 15..18 after it.
  function diesOnItsStep(fast: boolean): Death {
    const start = { ...game(open), snipes: [snipeAt({ x: 18, y: 10 })] };
    const states = run(start, [hold(1, 0, fast)]);
    return { states, died: 1, ticks: fast ? FAST_STEP_TICKS : STEP_TICKS };
  }

  // The player steps right on tick 1, and a snipe's shot flying left hits it on tick 2: the
  // shot moves first in a tick (2.4), from columns 20..21 to 19..20 on tick 1, before the
  // player's step, and into its footprint at 18..19 on tick 2.
  function diesAfterItsStep(): Death {
    const shot: GameState["snipeShots"][number] = {
      x: 20,
      y: 11,
      dx: -1,
      dy: 0,
    };
    const start = { ...game(open), snipeShots: [shot] };
    const states = run(start, [RIGHT, NO_INPUT]);
    return { states, died: 2, ticks: STEP_TICKS };
  }

  const deaths: [name: string, death: () => Death][] = [
    ["on the tick it steps, touching a snipe", () => diesOnItsStep(false)],
    [
      "on the tick it steps with Space held, touching a snipe",
      () => diesOnItsStep(true),
    ],
    ["one tick after its step, hit by a snipe's shot", diesAfterItsStep],
  ];

  // Steps on with no key held from the death until the player is back in play.
  function untilBack(death: Death): GameState[] {
    const states = [...death.states];
    for (let t = 0; t < PATIENCE; t++) {
      const last = states[states.length - 1];
      if (t > 0 && last.respawn === 0) break;
      states.push(step(last, NO_INPUT));
    }
    return states;
  }

  it.each(deaths)(
    "dying %s, it is drawn sliding on evenly and arrives on its cell, while out of play",
    (_name, death) => {
      const { states, died, ticks } = death();
      // The test's own check of the setup: it stepped on tick 1 and died on tick `died`.
      expect(where(states[1].player)).toEqual({ x: 15, y: 10 });
      expect(states[died - 1].respawn).toBe(0);
      expect(states[died].respawn).toBeGreaterThan(0);
      expect(states[died].lives).toBe(states[0].lives - 1);
      const all = untilBack(death());
      const problems: string[] = [];
      for (let k = 1; k < all.length && all[k].respawn > 0; k++) {
        for (const alpha of ALPHAS) {
          const progress = Math.min(1, (k - 1 + alpha) / ticks);
          const expected = { x: 14 + progress, y: 10 };
          const p = drawn(all[k], alpha).player;
          if (distance(open, p, expected) > EXACT) {
            problems.push(
              `tick ${k} at ${alpha}: drawn at ${show(p)}, expected ${show(expected)}`,
            );
          }
        }
      }
      expect(problems.slice(0, 8)).toEqual([]);
    },
  );

  it.each(deaths)(
    "dying %s, the view keeps scrolling with the drawn position instead of jumping",
    (_name, death) => {
      const { ticks } = death();
      const all = untilBack(death());
      const at = (k: number, alpha: number) =>
        view.viewOrigin(open, drawn(all[k], alpha).player);
      // From the step to its arrival, the view moves a little each quarter tick, never a
      // whole cell at once.
      let last = at(1, 0);
      for (let k = 1; k <= ticks + 1; k++) {
        for (const alpha of ALPHAS) {
          const now = at(k, alpha);
          const moved = apart(now.x, last.x, open.width);
          expect(moved, `tick ${k} at ${alpha}`).toBeGreaterThanOrEqual(-EXACT);
          expect(moved, `tick ${k} at ${alpha}`).toBeLessThan(1 / 3 + EXACT);
          last = now;
        }
      }
      expect(apart(at(ticks + 1, 0).x, at(1, 0).x, open.width)).toBeCloseTo(
        1,
        9,
      );
    },
  );

  it.each(deaths)(
    "dying %s, it is drawn in place on the tick it comes back",
    (_name, death) => {
      const all = untilBack(death());
      const back = all[all.length - 1];
      // The test's own check: it is back in play, somewhere else than where it died.
      expect(back.respawn).toBe(0);
      expect(distance(open, back.player, { x: 15, y: 10 })).toBeGreaterThan(4);
      const later = run(back, times(3, NO_INPUT));
      for (const state of later) {
        for (const alpha of ALPHAS) {
          const p = drawn(state, alpha).player;
          expect(distance(open, p, back.player), `at ${alpha}`).toBeLessThan(
            EXACT,
          );
        }
      }
    },
  );
});

describe("3 Presentation: Motion — snipes slide between cells", () => {
  const room = field(64, 48);
  const hive = { x: 40, y: 30 };

  it("a new snipe is drawn in place, at every fraction of the tick, until its first step", () => {
    const found = firstSnipe(room, hive, 1, 3);
    expect(found).toBeDefined();
    const [appeared, next] = found?.states ?? [];
    const snipe = appeared.snipes[0];
    for (const alpha of ALPHAS) {
      const p = drawn(appeared, alpha).snipes[0];
      expect(distance(room, p, snipe), `at ${alpha}`).toBeLessThan(EXACT);
    }
    // It takes its first step on the next tick (2.4), and is drawn then on the cell it
    // appeared on.
    expect(distance(room, next.snipes[0], snipe)).toBe(1);
    expect(distance(room, drawn(next, 0).snipes[0], snipe)).toBeLessThan(EXACT);
  });

  it("slides evenly over the 10 ticks after a straight step and the 13 after a diagonal one", () => {
    const found = findSnipes(room, hive, 110, ({ states }) => {
      const steps = snipeSteps(states);
      return steps.some(([, d]) => d) && steps.some(([, d]) => !d);
    });
    const { states } = found;
    expect(
      differences(states, snipeModel(states, 0), (d) => d.snipes[0], "snipe"),
    ).toEqual([]);
  });

  it.each([
    ["straight", false, STRAIGHT_TICKS],
    ["diagonal", true, DIAGONAL_TICKS],
  ] as const)(
    "after a %s step, is drawn halfway between its cells halfway to its next step",
    (_name, diagonal, ticks) => {
      const later = (s: Snipes) =>
        snipeSteps(s.states).find(
          ([t, d]) => d === diagonal && t + ticks < s.states.length,
        );
      const found = findSnipes(room, hive, 110, (s) => later(s) !== undefined);
      const { states } = found;
      const [tick] = later(found) ?? [0];
      const from = states[tick - 1].snipes[0];
      const to = states[tick].snipes[0];
      const at = (k: number, alpha: number) =>
        drawn(states[k], alpha).snipes[0];
      const half = Math.floor(ticks / 2);
      const rest = ticks / 2 - half;
      expect(distance(room, at(tick, 0), from)).toBeLessThan(EXACT);
      expect(
        distance(room, at(tick + half, rest), between(room, from, to, 0.5)),
      ).toBeLessThan(EXACT);
      expect(
        distance(room, at(tick + 1, 0), between(room, from, to, 1 / ticks)),
      ).toBeLessThan(EXACT);
      // It arrives just as its next step is due.
      expect(distance(room, at(tick + ticks, 0), to)).toBeLessThan(EXACT);
    },
  );

  it("across a maze edge slides the short way", () => {
    const small = field(32, 24);
    const { states } = findSnipes(small, { x: 22, y: 14 }, 110, (s) =>
      crossesEdge(s.states),
    );
    expect(
      differences(states, snipeModel(states, 0), (d) => d.snipes[0], "snipe"),
    ).toEqual([]);
    for (const state of states) {
      for (const alpha of ALPHAS) {
        const p = drawn(state, alpha).snipes[0];
        expect(distance(small, p, state.snipes[0])).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each([1, 2, 3])(
    "each snipe in a busy generated game matches the slide model (seed %d)",
    (seed) => {
      const all = run(createGame(seed, "A9"), times(1500, NO_INPUT));
      const { maze } = all[0];
      // Until the first snipe dies, the list only grows at its end, and each snipe keeps its
      // place in it, moving at most one cell a tick.
      const dies = all.findIndex(
        (s, k) =>
          k > 0 &&
          all[k - 1].snipes.some(
            (before, i) =>
              s.snipes[i] === undefined ||
              distance(maze, before, s.snipes[i]) > 1,
          ),
      );
      const states = dies < 0 ? all : all.slice(0, dies);
      const last = states[states.length - 1];
      // The test's own check that there are snipes to check.
      expect(last.snipes.length).toBeGreaterThan(1);
      const models = last.snipes.map((_, index) => snipeModel(states, index));
      const problems: string[] = [];
      states.forEach((state, k) => {
        for (const alpha of [0, 0.5]) {
          const d = drawn(state, alpha);
          models.forEach((model, index) => {
            const expected = model[k](alpha);
            if (expected === undefined) return;
            const actual = d.snipes[index];
            if (
              actual === undefined ||
              distance(maze, actual, expected) > EXACT
            ) {
              problems.push(
                `snipe ${index} on tick ${k} at ${alpha}: drawn at ${actual === undefined ? "nothing" : show(actual)}, expected ${show(expected)}`,
              );
            }
          });
        }
      });
      expect(problems.slice(0, 8)).toEqual([]);
    },
  );
});

describe("3 Presentation: Motion — shots slide between their last two positions", () => {
  const open = field(40, 30);

  it("a new shot is drawn where it appears, then slides by the fraction of the tick", () => {
    // Fired right on tick 1 from the start at 14,10: it appears at 18,11 (2.10) and moves on
    // the next tick.
    const states = run(game(open), [
      hold(0, 0, false, 1, 0),
      ...times(3, NO_INPUT),
    ]);
    expect(states[1].shots.map(where)).toEqual([{ x: 18, y: 11 }]);
    expect(states[2].shots.map(where)).toEqual([{ x: 19, y: 11 }]);
    const cases: [tick: number, alpha: number, x: number][] = [
      [1, 0, 18],
      [1, 0.5, 18],
      [1, 0.96875, 18],
      [2, 0, 18],
      [2, 0.25, 18.25],
      [2, 0.75, 18.75],
      [3, 0, 19],
      [3, 0.5, 19.5],
    ];
    for (const [tick, alpha, x] of cases) {
      const p = drawn(states[tick], alpha).shots[0];
      expect(p.x, `tick ${tick} at ${alpha}`).toBeCloseTo(x, 9);
      expect(p.y, `tick ${tick} at ${alpha}`).toBeCloseTo(11, 9);
    }
  });

  it.each(EIGHT)(
    "a shot fired %s slides the short way across the maze edges",
    (_name, [dx, dy]) => {
      const inputs = [hold(0, 0, false, dx, dy), ...times(70, NO_INPUT)];
      const states = run(game(open), inputs);
      expect(states.every((s, k) => k === 0 || s.shots.length === 1)).toBe(
        true,
      );
      // The test's own check that the shot crossed an edge.
      const crossed = states.some(
        (s, k) =>
          k > 1 &&
          (Math.abs(s.shots[0].x - states[k - 1].shots[0].x) > 1 ||
            Math.abs(s.shots[0].y - states[k - 1].shots[0].y) > 1),
      );
      expect(crossed).toBe(true);
      expect(
        differences(
          states,
          shotModel(states, "shots"),
          (d) => d.shots[0],
          "shot",
        ),
      ).toEqual([]);
    },
  );

  it("a snipe's shot is drawn where it appears, then slides by the fraction of the tick", () => {
    // A hive in the player's rows, so that a snipe it spawns may soon fire along them.
    const room = field(64, 48);
    let found: GameState[] | undefined;
    for (let seed = 0; seed < 20000 && found === undefined; seed++) {
      const snipes = firstSnipe(room, { x: 40, y: 10 }, seed, 40);
      if (snipes === undefined) continue;
      const { states } = snipes;
      const first = states.findIndex((s) => s.snipeShots.length === 1);
      if (first < 1 || states[first - 1].snipeShots.length !== 0) continue;
      // While it is the only one, it is the same shot, one cell further on each tick.
      let last = first;
      while (
        last + 1 < states.length &&
        states[last + 1].snipeShots.length === 1 &&
        distance(
          room,
          states[last + 1].snipeShots[0],
          states[last].snipeShots[0],
        ) === 1
      ) {
        last++;
      }
      if (last - first >= 3) found = states.slice(first - 1, last + 1);
    }
    expect(found).toBeDefined();
    const states = found ?? [];
    const appeared = states[1];
    for (const alpha of ALPHAS) {
      const p = drawn(appeared, alpha).snipeShots[0];
      expect(
        distance(room, p, appeared.snipeShots[0]),
        `at ${alpha}`,
      ).toBeLessThan(EXACT);
    }
    expect(
      differences(
        states,
        shotModel(states, "snipeShots"),
        (d) => d.snipeShots[0],
        "snipe's shot",
      ),
    ).toEqual([]);
  });
});

describe("3 Presentation: Motion — the view follows the player's drawn position", () => {
  const open = field(256, 240);

  it("keeps the drawn footprint centred while the player slides, also across the edges", () => {
    // Up-left from 14,10 crosses both edges within 100 ticks.
    const states = run(game(open), times(100, hold(-1, -1)));
    const problems: string[] = [];
    for (const state of states) {
      for (const alpha of ALPHAS) {
        const p = drawn(state, alpha).player;
        const origin = view.viewOrigin(open, p);
        const col = apart(p.x, origin.x, open.width);
        const row = apart(p.y, origin.y, open.height);
        if (
          Math.abs(col - SIGHT) > EXACT ||
          Math.abs(row - SIGHT_ROWS) > EXACT
        ) {
          problems.push(`drawn at ${show(p)}: view origin ${show(origin)}`);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it("scrolls the view by part of a cell between two steps", () => {
    const states = run(game(open), times(3, hold(1, 0)));
    const at = (k: number, alpha: number) =>
      view.viewOrigin(open, drawn(states[k], alpha).player);
    // Stepped on tick 1: a third of a cell later the view has scrolled a third of a cell.
    expect(apart(at(2, 0).x, at(1, 0).x, open.width)).toBeCloseTo(1 / 3, 9);
    expect(apart(at(1, 0.5).x, at(1, 0).x, open.width)).toBeCloseTo(1 / 6, 9);
    expect(apart(at(2, 0).y, at(1, 0).y, open.height)).toBeCloseTo(0, 9);
  });
});
