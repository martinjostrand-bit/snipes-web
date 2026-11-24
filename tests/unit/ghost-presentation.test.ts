import { describe, expect, it } from "vitest";
import { createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  type GameState,
  type InputState,
} from "../../src/core/state";
// Spec 2.7 (WP 13): these tests go on after a level is cleared; see play-on.ts.
import { playOn as step } from "../play-on";
// Namespace imports, so that a missing export fails these tests one by one, not the file.
import * as sound from "../../src/render/sound";
import * as view from "../../src/render/view";

// Spec 3 and 9.1 WP 15: ghosts on the screen and in the sound.
//
// - `drawnPositions(state, alpha)` in src/render/view.ts (WP 11b, see tests/unit/motion.test.ts)
//   also gives `ghosts`: the drawn top-left cell of each ghost's footprint, one point per entry
//   of `state.ghosts`, in their order, in maze cells that may be fractional and are compared
//   modulo the maze's size. A ghost slides at an even speed from the cell of its last step to
//   its current cell, arriving when its next step is due, 5 ticks after the step (2.4): a step
//   on tick T from A to B is drawn at A + (B - A) * min(1, (k - T + alpha) / 5) on tick k >= T.
//   A new ghost appears in place, without sliding, until its first step; a ghost that stays put
//   is drawn where it is; across a maze edge a ghost slides the short way.
// - `beepFor(before, after)` in src/render/sound.ts (WP 14) gives the beep for what happened
//   from one state to the next. Killing a ghost plays the hit beep, the one a snipe killed
//   plays; a burst plays the death beep, the one the player's death by a snipe's shot plays (3).
//
// Ghosts are made as in tests/unit/ghosts.test.ts: a snipe going right is hit on its spear
// half (its right half), which leaves a ghost on its left half at D1.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Ghost = GameState["ghosts"][number];
type Shot = GameState["shots"][number];

const GHOST_TICKS = 5; // 2.4: ticks from a ghost's step to its next
const PATIENCE = 10 * 60 * 60;
const NEVER = Number.MAX_SAFE_INTEGER; // a hive's wait that never runs out
// Fractions of a tick, exact in binary so that the expected points are exact.
const ALPHAS = [0, 0.25, 0.5, 0.75, 0.96875];
const EXACT = 1e-9;

const UP: Dir = [0, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const LEFT: Dir = [-1, 0];

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// The signed difference a - b on an axis that wraps after `size`, between -size/2 and size/2.
function apart(a: number, b: number, size: number): number {
  const d = mod(a - b, size);
  return d > size / 2 ? d - size : d;
}

function expectAt(maze: Grid, got: Point, want: Point, what: string): void {
  expect(
    Math.abs(apart(got.x, want.x, maze.width)),
    `${what}: x ${got.x}, want ${want.x}`,
  ).toBeLessThan(EXACT);
  expect(
    Math.abs(apart(got.y, want.y, maze.height)),
    `${what}: y ${got.y}, want ${want.y}`,
  ).toBeLessThan(EXACT);
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

function ring(p: Point): Point[] {
  const result: Point[] = [];
  for (let y = p.y - 1; y <= p.y + 2; y++) {
    for (let x = p.x - 1; x <= p.x + 2; x++) {
      if (x < p.x || x > p.x + 1 || y < p.y || y > p.y + 1) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

function grid(width: number, height: number, walls: readonly Point[] = []) {
  const set = new Set(walls.map((w) => `${w.x},${w.y}`));
  return createGrid(width, height, ({ x, y }) =>
    set.has(`${x},${y}`) ? "wall" : "open",
  );
}

const field = grid(320, 320);
const G = { x: 150, y: 150 };

let snipeTemplate: Snipe | undefined;

function newSnipe(): Snipe {
  if (snipeTemplate !== undefined) return snipeTemplate;
  const game = createGame(1, "A9");
  let state: GameState = {
    ...game,
    maze: field,
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

function snipe(p: Point, [dx, dy]: Dir): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx, dy, turn: 1 };
}

function shot(p: Point, [dx, dy]: Dir): Shot {
  return { x: p.x, y: p.y, dx, dy };
}

interface Setup {
  readonly skill?: string;
  readonly maze?: Grid;
  readonly player?: Point;
  readonly snipes?: readonly Snipe[];
  readonly ghosts?: readonly Ghost[];
  readonly shots?: readonly Shot[];
  readonly snipeShots?: readonly Shot[];
}

// A game at `skill` (D1 if not given) with a hive far away that never spawns, so the level
// goes on.
function arena(setup: Setup): GameState {
  const game = createGame(1, setup.skill ?? "D1");
  return {
    ...game,
    maze: setup.maze ?? field,
    player: { ...game.player, ...(setup.player ?? { x: 20, y: 20 }) },
    hives: [{ ...game.hives[0], x: 280, y: 280, hits: 0, wait: NEVER }],
    snipes: setup.snipes ?? [],
    ghosts: setup.ghosts ?? [],
    shots: setup.shots ?? [],
    snipeShots: setup.snipeShots ?? [],
  };
}

// A game in which a ghost appears at `at` on its first tick, from a snipe going right hit on
// its spear half.
function appearing(at: Point, setup: Setup = {}): GameState {
  return arena({
    ...setup,
    snipes: [snipe(at, RIGHT)],
    shots: [shot({ x: at.x + 2, y: at.y }, DOWN)],
  });
}

let ready: Ghost | undefined;

// A ghost that steps on the next tick: one that appeared two ticks ago.
function readyGhost(p: Point, [dx, dy]: Dir, straight: boolean): Ghost {
  if (ready === undefined) {
    let state = step(appearing(G), NO_INPUT);
    if (state.ghosts?.length !== 1) {
      throw new Error("No ghost appeared from a hit on a snipe's spear half");
    }
    state = step(step(state, NO_INPUT), NO_INPUT);
    ready = state.ghosts[0];
  }
  return { ...ready, x: p.x, y: p.y, dx, dy, turn: 1, straight };
}

function drawnGhosts(state: GameState, alpha: number): Point[] {
  return view.drawnPositions(state, alpha).ghosts;
}

// ===========================================================================================

describe("3 Presentation: Motion — drawnPositions gives a place for each ghost", () => {
  it("one point per ghost, in their order, without changing the state", () => {
    const state = step(
      arena({
        ghosts: [
          readyGhost({ x: 40, y: 40 }, RIGHT, true),
          readyGhost({ x: 200, y: 90 }, LEFT, true),
          readyGhost({ x: 100, y: 250 }, UP, true),
        ],
      }),
      NO_INPUT,
    );
    const before = structuredClone(state);
    const points = drawnGhosts(state, 0.5);
    expect(state).toEqual(before);
    expect(points).toHaveLength(3);
    // Each is drawn half a tenth of the way from where it was to where it went.
    const from = [
      { x: 40, y: 40 },
      { x: 200, y: 90 },
      { x: 100, y: 250 },
    ];
    state.ghosts.forEach((g, i) => {
      expectAt(
        state.maze,
        points[i],
        {
          x: from[i].x + (g.x - from[i].x) * (0.5 / GHOST_TICKS),
          y: from[i].y + (g.y - from[i].y) * (0.5 / GHOST_TICKS),
        },
        `ghost ${i}`,
      );
    });
  });
});

describe("3 Presentation: Motion — a ghost appears in place and slides evenly between steps", () => {
  it("a new ghost is drawn in place, at every fraction of the tick, until its first step", () => {
    // The ghost appears on tick 1 and first steps on tick 4 (2.4).
    let state = appearing(G, { player: { x: G.x + 60, y: G.y + 45 } });
    for (let tick = 1; tick <= 3; tick++) {
      state = step(state, NO_INPUT);
      expect(where(state.ghosts[0])).toEqual(G);
      for (const alpha of ALPHAS) {
        expectAt(
          state.maze,
          drawnGhosts(state, alpha)[0],
          G,
          `tick ${tick}, alpha ${alpha}`,
        );
      }
    }
  });

  it("slides one step over the 5 ticks until its next step, and the next from where it went", () => {
    // Far up-left of the player, it steps down-right on ticks 4, 9 and 14.
    let state = appearing(G, { player: { x: G.x + 60, y: G.y + 45 } });
    const at: Point[] = [];
    for (let tick = 1; tick <= 18; tick++) {
      state = step(state, NO_INPUT);
      at[tick] = where(state.ghosts[0]);
      if (tick < 4) continue;
      // The last step on or before this tick, and where it came from.
      const last = 4 + GHOST_TICKS * Math.floor((tick - 4) / GHOST_TICKS);
      const to = at[last];
      const from = { x: to.x - DOWN_RIGHT[0], y: to.y - DOWN_RIGHT[1] };
      expect(where(state.ghosts[0])).toEqual(to);
      for (const alpha of ALPHAS) {
        const progress = Math.min(1, (tick - last + alpha) / GHOST_TICKS);
        expectAt(
          state.maze,
          drawnGhosts(state, alpha)[0],
          {
            x: from.x + (to.x - from.x) * progress,
            y: from.y + (to.y - from.y) * progress,
          },
          `tick ${tick}, alpha ${alpha}`,
        );
      }
    }
    expect(at[4]).toEqual({ x: G.x + 1, y: G.y + 1 });
    expect(at[14]).toEqual({ x: G.x + 3, y: G.y + 3 });
  });

  it("a ghost that stays put is drawn where it is", () => {
    const hole = { x: 100, y: 100 };
    let state = arena({
      maze: grid(320, 320, ring(hole)),
      ghosts: [readyGhost(hole, UP, false)],
    });
    for (let tick = 1; tick <= 12; tick++) {
      state = step(state, NO_INPUT);
      for (const alpha of ALPHAS) {
        expectAt(
          state.maze,
          drawnGhosts(state, alpha)[0],
          hole,
          `tick ${tick}, alpha ${alpha}`,
        );
      }
    }
  });

  it("across a maze edge slides the short way", () => {
    // In straight mode, going left from column 0 to the last column.
    const state = step(
      arena({ ghosts: [readyGhost({ x: 0, y: 100 }, LEFT, true)] }),
      NO_INPUT,
    );
    expect(where(state.ghosts[0])).toEqual({ x: 319, y: 100 });
    for (const alpha of ALPHAS) {
      expectAt(
        state.maze,
        drawnGhosts(state, alpha)[0],
        { x: -alpha / GHOST_TICKS, y: 100 },
        `alpha ${alpha}`,
      );
    }
  });

  it("the other ghosts keep sliding when one of them is killed", () => {
    // Both step on tick 1; on tick 2 a shot kills the first.
    let state = step(
      arena({
        ghosts: [
          readyGhost({ x: 60, y: 60 }, RIGHT, true),
          readyGhost({ x: 200, y: 90 }, DOWN, true),
        ],
      }),
      NO_INPUT,
    );
    const killer = shot({ x: state.ghosts[0].x - 2, y: 60 }, RIGHT);
    state = step({ ...state, shots: [killer] }, NO_INPUT);
    expect(state.ghosts.map(where)).toEqual([{ x: 200, y: 91 }]);
    for (const alpha of ALPHAS) {
      expectAt(
        state.maze,
        drawnGhosts(state, alpha)[0],
        { x: 200, y: 90 + (1 + alpha) / GHOST_TICKS },
        `alpha ${alpha}`,
      );
    }
  });
});

describe("3 Presentation: Sound — ghosts", () => {
  const PL = { x: 100, y: 100 };

  // The beep for a snipe killed by the player's shot on its face half.
  function snipeKilled() {
    const before = arena({
      snipes: [snipe(G, RIGHT)],
      shots: [shot(G, DOWN)],
    });
    const after = step(before, NO_INPUT);
    expect(after.snipes).toEqual([]);
    return sound.beepFor(before, after);
  }

  // The beep for the player killed by a snipe's shot.
  function playerShot() {
    const before = arena({
      player: PL,
      snipeShots: [shot({ x: PL.x + 1, y: PL.y + 1 }, RIGHT)],
    });
    const after = step(before, NO_INPUT);
    expect(after.lives).toBe(before.lives - 1);
    return sound.beepFor(before, after);
  }

  it("killing a ghost with the player's shot plays the hit beep", () => {
    const before = arena({
      ghosts: [readyGhost(G, UP, true)],
      shots: [shot(G, DOWN)],
    });
    const after = step(before, NO_INPUT);
    expect(after.ghosts).toEqual([]);
    const hit = snipeKilled();
    expect(hit).toBeDefined();
    expect(sound.beepFor(before, after)).toEqual(hit);
  });

  it("killing a ghost with a snipe's shot plays the hit beep too", () => {
    const before = arena({
      ghosts: [readyGhost(G, UP, true)],
      snipeShots: [shot(G, DOWN)],
    });
    const after = step(before, NO_INPUT);
    expect(after.ghosts).toEqual([]);
    expect(sound.beepFor(before, after)).toEqual(snipeKilled());
  });

  it("a burst plays the death beep", () => {
    // Down-right of the ghost and next to it, the player blocks its diagonal step, so the
    // ghost draws its burst chance, 1/64 at F1 (2.4, 2.6): PRNG seeds are tried until it bursts.
    let before: GameState | undefined;
    let after: GameState | undefined;
    const base = arena({
      skill: "F1",
      player: PL,
      ghosts: [readyGhost({ x: 98, y: 98 }, UP, false)],
    });
    for (let seed = 0; seed < 100_000 && after === undefined; seed++) {
      const state = { ...base, rng: createRng(seed) };
      const next = step(state, NO_INPUT);
      if (next.ghosts.length === 0 && next.lives < state.lives) {
        before = state;
        after = next;
      }
    }
    if (before === undefined || after === undefined) {
      throw new Error("No ghost burst");
    }
    const death = playerShot();
    expect(death).toBeDefined();
    expect(sound.beepFor(before, after)).toEqual(death);
  });
});
