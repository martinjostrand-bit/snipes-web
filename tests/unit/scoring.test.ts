import { describe, expect, it } from "vitest";
import { cellAt, createGrid, type Grid, type Point } from "../../src/core/grid";
import { levelBonus } from "../../src/core/score";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.2, 2.3, 2.5, 2.6, 2.7, 6.2 and 9.1 WP 12: the win condition, the scoring table, the
// level bonus and the lives per digit.
//
// - `state.score` is the player's score: a whole number, 0 in a new game, that never goes down.
//   It goes up by the 2.7 points, the same at every skill level, for each hive (100) and snipe
//   (10) destroyed on a tick on which at least one of the player's shots hit it, even if a
//   snipe's shot made the final hit (a hive's 20th hit, 2.3). One destroyed hive or snipe gives
//   its points once, however many shots hit it on that tick. Hits that do not destroy, a hive
//   or snipe destroyed only by snipes' shots (2.5), a hive whose earlier hits were the player's
//   but whose final tick was only a snipe's shot, the player's death and shots into walls give
//   nothing. Ghosts come with WP 15.
// - `state.cleared` is true at the end of the first tick on which no hive and no snipe is left,
//   whoever's shot removed the last one, also with shots (the player's or a snipe's) still in
//   flight or the player out of play (2.7, 6.2), and from then on. It is false while any hive
//   or snipe is left. A new game has hives, so it is not cleared. 2.7 leaves open the case of a
//   player with no lives left on the clearing tick (WP 13); no test here clears a level then.
// - `levelBonus(lives, ticks)` in `src/core/score.ts` is the level bonus B(L, T) of 2.7, for L
//   lives (1 or more here) and T ticks: a whole number, at least 0. It never falls when L rises
//   or T falls; it is strictly higher for each extra life; and it is strictly higher for a clear
//   at least 60 ticks faster while both are within the first 18,000 ticks (after that it may
//   stay flat). The formula is WP 18's, so the tests check only these properties. On the tick
//   the level is cleared, the score goes up by levelBonus(state.lives, T) once, on top of that
//   tick's points: `state.lives` is the lives at the end of that tick and T the number of ticks
//   (`step` calls) in the level up to and including that tick, the level's first tick being 1.
//   The bonus is never given again.
// - `createGame(seed, skill).lives` is the digit's number of lives (2.6): 5, 5, 5, 5, 5, 4, 4,
//   3, 2 for digits 1 to 9, whatever the letter.
//
// What follows a cleared level (the next level and its screen) is WP 13's, so the tests only
// check that the level stays cleared and the bonus is not given again while the game is
// stepped on. The games are built from a new game, as in the WP 09 to 11 tests, so the level's
// first `step` is its tick 1. Snipes are copies of one that has just appeared, so a copy takes
// its first step on the next tick (2.4); shots move before the snipes step (4.3), so a shot next
// to a snipe kills it on the first tick wherever that snipe was going.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Hive = GameState["hives"][number];
type Snipe = GameState["snipes"][number];
type Shot = GameState["shots"][number];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)
const HIVE = 4; // a hive's footprint is HIVE x HIVE cells (2.10)
const SNIPE_W = 4; // a snipe's footprint is SNIPE_W x SNIPE_H cells (2.10)
const SNIPE_H = 2;
const HITS = 20; // the 20th hit destroys a hive (2.3)
const HIVE_POINTS = 100; // 2.7
const SNIPE_POINTS = 10; // 2.7
const FIRE_TICKS = 13; // ticks from one player's shot to the next (2.5)
const SECOND = 60; // ticks in a second (4.3)
const MINUTE = 60 * SECOND;
const PATIENCE = 10 * MINUTE; // the longest a test waits for a spawn
// Spec 2.6, the digit table: lives for digits 1 to 9.
const LIVES = [5, 5, 5, 5, 5, 4, 4, 3, 2];
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const MOST_LIVES = Math.max(...LIVES);
const SLOW = 120_000;

const RIGHT: Dir = [1, 0];
const LEFT: Dir = [-1, 0];
const DOWN: Dir = [0, 1];

function cells(box: Box): Point[] {
  const result: Point[] = [];
  for (let dy = 0; dy < box.height; dy++) {
    for (let dx = 0; dx < box.width; dx++) {
      result.push({ x: box.x + dx, y: box.y + dy });
    }
  }
  return result;
}

// Whether the footprint has no wall cell, with wrap-around (2.10).
function clear(maze: Grid, box: Box): boolean {
  return cells(box).every((c) => cellAt(maze, c) === "open");
}

function hold(fireX: Axis, fireY: Axis): InputState {
  return { ...NO_INPUT, fireX, fireY };
}

// A room whose walls are its top row and left column; the grid wraps, so they are also its
// bottom and right walls, and every shot ends at a wall.
const room = createGrid(64, 48, ({ x, y }) =>
  x === 0 || y === 0 ? "wall" : "open",
);

// The places in the room. The player is far from the hives and snipes, and a snipe at S or
// S2 is never lined up with it (2.4), so it does not fire at it.
const P = { x: 4, y: 4 };
const H = { x: 40, y: 30 }; // a hive: columns 40 to 43, rows 30 to 33
const H2 = { x: 50, y: 10 }; // another hive, out of every shot's way
const S = { x: 20, y: 30 }; // a snipe: columns 20 to 23, rows 30 and 31
const S2 = { x: 20, y: 40 }; // another snipe, rows 40 and 41

// Shots that enter a footprint on their first move: from the left (going right) or from the
// right (going left).
function fromLeft(target: Point): Point {
  return { x: target.x - SHOT, y: target.y };
}

function fromRightOfHive(hive: Point): Point {
  return { x: hive.x + HIVE, y: hive.y + 1 };
}

function fromRightOfSnipe(s: Point): Point {
  return { x: s.x + SNIPE_W, y: s.y };
}

let template: Snipe | undefined;

// A snipe that has just appeared, spawned by a lone hive in the room.
function newSnipe(): Snipe {
  if (template !== undefined) return template;
  const game = createGame(1, "A9");
  let state: GameState = {
    ...game,
    maze: room,
    player: { ...game.player, ...P },
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

// A snipe at `p`, that takes its first step on the next tick.
function snipe(p: Point, [dx, dy]: Dir = RIGHT): Snipe {
  return { ...newSnipe(), x: p.x, y: p.y, dx, dy, turn: 1 };
}

function shot(p: Point, [dx, dy]: Dir): Shot {
  return { x: p.x, y: p.y, dx, dy };
}

interface Setup {
  readonly maze?: Grid;
  readonly player?: Point;
  readonly hives?: readonly (Point & { readonly hits?: number })[];
  readonly snipes?: readonly Snipe[];
  readonly shots?: readonly Shot[];
  readonly snipeShots?: readonly Shot[];
  readonly lives?: number;
  readonly skill?: string;
}

// A new game at `skill` (A1 if not given) in `maze` (the room if not given) with only what the
// setup names. Hives are copies of a new game's hive. Nothing has been stepped yet, so the time
// taken starts from 0, and so does the score.
function arena(setup: Setup): GameState {
  const game = createGame(1, setup.skill ?? "A1");
  const hive: Hive = game.hives[0];
  return {
    ...game,
    maze: setup.maze ?? room,
    player: { ...game.player, ...(setup.player ?? P) },
    hives: (setup.hives ?? []).map((h) => ({
      ...hive,
      x: h.x,
      y: h.y,
      hits: h.hits ?? 0,
    })),
    snipes: setup.snipes ?? [],
    shots: setup.shots ?? [],
    snipeShots: setup.snipeShots ?? [],
    lives: setup.lives ?? game.lives,
  };
}

function run(state: GameState, ticks: number, input = NO_INPUT): GameState {
  let current = state;
  for (let t = 0; t < ticks; t++) current = step(current, input);
  return current;
}

// Steps, then takes away the snipes and their shots, before they first move, so that a hive
// can wait for a while, or the player fire, with nothing else happening.
function alone(state: GameState, input: InputState): GameState {
  return { ...step(state, input), snipes: [], snipeShots: [] };
}

function quiet(state: GameState): GameState {
  return alone(state, NO_INPUT);
}

// ===========================================================================================

describe("2.7 Levels and scoring: a new game", () => {
  it.each(["A1", "C3", "M5", "W7", "Z9"])(
    "starts at %s with a score of 0, not cleared",
    (skill) => {
      const game = createGame(42, skill);
      expect(game.score).toBe(0);
      expect(game.cleared).toBe(false);
    },
  );

  it("starts without a skill level with a score of 0, not cleared", () => {
    const game = createGame(42);
    expect(game.score).toBe(0);
    expect(game.cleared).toBe(false);
  });

  it("keeps the score and the cleared mark in plain data that can be copied", () => {
    const state = run(createGame(7), 10);
    expect(structuredClone(state)).toEqual(state);
    expect(state.score).toBe(0);
    expect(state.cleared).toBe(false);
  });

  it("is not cleared after a minute of standing still among the hives", () => {
    let state = createGame(3, "A1");
    for (let tick = 1; tick <= MINUTE; tick++) {
      state = step(state, NO_INPUT);
      expect(state.cleared, `tick ${tick}`).toBe(false);
    }
    expect(state.score).toBe(0);
  });
});

describe("2.7 Levels and scoring: points per event", () => {
  it("gives 100 when the player's shot destroys a hive with its 20th hit", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }, H2],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives.map((h) => ({ x: h.x, y: h.y }))).toEqual([H2]);
    expect(after.score).toBe(HIVE_POINTS);
  });

  it.each(Array.from({ length: HITS - 1 }, (_, k) => k))(
    "gives nothing for a hit on a hive that has taken %d hits, which it survives",
    (k) => {
      const state = arena({
        hives: [{ ...H, hits: k }],
        shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
      });
      const after = step(state, NO_INPUT);
      expect(after.hives).toHaveLength(1);
      expect(after.hives[0].hits).toBe(k + 1);
      expect(after.score).toBe(0);
    },
  );

  it("gives 100 once when two of the player's shots enter a hive with 19 hits on one tick", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }, H2],
      shots: [
        shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
        shot(fromRightOfHive(H), LEFT),
      ],
    });
    const after = step(state, NO_INPUT);
    expect(after.shots).toEqual([]);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(HIVE_POINTS);
  });

  it("gives 100 for each hive destroyed, adding up over the game", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }, { ...H2, hits: HITS - 1 }, S2],
      shots: [
        shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
        shot(fromLeft({ x: H2.x, y: H2.y }), RIGHT),
      ],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(2 * HIVE_POINTS);
  });

  it("gives 10 when the player's shot kills a snipe", () => {
    const state = arena({
      hives: [H2],
      snipes: [snipe(S)],
      shots: [shot(fromLeft(S), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.score).toBe(SNIPE_POINTS);
  });

  it("gives 10 for each snipe killed on one tick", () => {
    const state = arena({
      hives: [H2],
      snipes: [snipe(S), snipe(S2)],
      shots: [shot(fromLeft(S), RIGHT), shot(fromLeft(S2), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.score).toBe(2 * SNIPE_POINTS);
  });

  it("gives 110 for a hive and a snipe on one tick, keeping the score already made", () => {
    const state = {
      ...arena({
        hives: [{ ...H, hits: HITS - 1 }, H2],
        snipes: [snipe(S)],
        shots: [
          shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
          shot(fromLeft(S), RIGHT),
        ],
      }),
      score: 1230,
    };
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.snipes).toEqual([]);
    expect(after.score).toBe(1230 + HIVE_POINTS + SNIPE_POINTS);
  });

  it("gives 100 for a hive destroyed by shots the player fires, through the keys", () => {
    // The player fires right; the shot appears just right of its footprint over its middle two
    // rows (2.10) and enters the hive, 2 cells further on, on its first move.
    const centre = { x: 30, y: 22 };
    const hive = { x: centre.x + PLAYER + SHOT, y: centre.y + 1 };
    let state = arena({
      player: centre,
      hives: [{ ...hive, hits: HITS - 2 }, H2],
    });
    const scores: number[] = [];
    for (let tick = 0; tick < 2 * FIRE_TICKS; tick++) {
      state = alone(state, hold(1, 0));
      scores.push(state.score);
    }
    expect(state.hives).toHaveLength(1);
    // The 19th hit gave nothing; the 20th, from the second shot, gave 100.
    expect(scores.slice(0, FIRE_TICKS)).toEqual(
      new Array<number>(FIRE_TICKS).fill(0),
    );
    expect(state.score).toBe(HIVE_POINTS);
  });

  it("gives nothing for shots that only hit walls", () => {
    let state = arena({ hives: [H] });
    for (const [fx, fy] of [
      [-1, 0],
      [0, -1],
      [-1, -1],
    ] as const) {
      for (let t = 0; t < 3 * FIRE_TICKS; t++)
        state = alone(state, hold(fx, fy));
    }
    for (let t = 0; t < SECOND; t++) state = quiet(state);
    expect(state.shots).toEqual([]);
    expect(state.score).toBe(0);
  });

  it("takes nothing away when the player dies", () => {
    // A snipe's shot that enters the player's footprint on its first move kills it (2.2).
    const centre = { x: 30, y: 22 };
    const state = {
      ...arena({
        player: centre,
        hives: [H2],
        snipeShots: [shot({ x: centre.x - SHOT, y: centre.y + 1 }, RIGHT)],
      }),
      score: 470,
    };
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(state.lives - 1);
    expect(after.respawn).toBeGreaterThan(0);
    expect(after.score).toBe(470);
    // Nor while it waits to come back.
    expect(run(after, SECOND).score).toBe(470);
  });
});

describe("2.5 Bullets / 2.7 Levels and scoring: snipe shots give no points", () => {
  it("gives nothing when a snipe's shot destroys a hive", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }, H2],
      snipeShots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(0);
  });

  it("gives nothing for a snipe's shot that hits a hive it does not destroy", () => {
    const state = arena({
      hives: [H],
      snipeShots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives[0].hits).toBe(1);
    expect(after.score).toBe(0);
  });

  it("gives nothing when a snipe's shot kills a snipe", () => {
    const state = arena({
      hives: [H2],
      snipes: [snipe(S)],
      snipeShots: [shot(fromLeft(S), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.score).toBe(0);
  });

  it("gives the player's points but not the snipe's on the same tick", () => {
    // The player's shot kills one snipe and a snipe's shot the other; the player's shot
    // destroys one hive and a snipe's shot the other.
    const state = arena({
      hives: [
        { ...H, hits: HITS - 1 },
        { ...H2, hits: HITS - 1 },
        { x: 50, y: 40 },
      ],
      snipes: [snipe(S), snipe(S2)],
      shots: [
        shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
        shot(fromLeft(S2), RIGHT),
      ],
      snipeShots: [
        shot(fromLeft({ x: H2.x, y: H2.y }), RIGHT),
        shot(fromLeft(S), RIGHT),
      ],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.snipes).toEqual([]);
    expect(after.score).toBe(HIVE_POINTS + SNIPE_POINTS);
  });

  it("gives nothing when two snipes' shots destroy a hive on one tick", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 2 }, H2],
      snipeShots: [
        shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
        shot(fromRightOfHive(H), LEFT),
      ],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(0);
  });

  it("gives nothing when the player's hit was on an earlier tick than a snipe's final one", () => {
    // The player's shot gives the hive its 19th hit; on the next tick a snipe's shot gives it
    // the 20th, with no player's shot hitting it on that tick.
    let state = arena({
      hives: [{ ...H, hits: HITS - 2 }, H2],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    state = step(state, NO_INPUT);
    expect(state.hives[0]).toMatchObject({ ...H, hits: HITS - 1 });
    expect(state.score).toBe(0);
    state = {
      ...state,
      snipeShots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    };
    state = step(state, NO_INPUT);
    expect(state.hives).toHaveLength(1);
    expect(state.score).toBe(0);
  });
});

describe("2.7 Levels and scoring: who scores when a player's shot and a snipe's shot hit on one tick", () => {
  // The player's shot enters from one side and a snipe's shot from the other, on the same move.
  it("gives 100 for a hive with 18 hits that takes one of each", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 2 }, H2],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
      snipeShots: [shot(fromRightOfHive(H), LEFT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives.map((h) => ({ x: h.x, y: h.y }))).toEqual([H2]);
    expect(after.shots).toEqual([]);
    expect(after.snipeShots).toEqual([]);
    expect(after.score).toBe(HIVE_POINTS);
  });

  it("gives 100 for a hive with 18 hits that takes one of each, the snipe's from the left", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 2 }, H2],
      shots: [shot(fromRightOfHive(H), LEFT)],
      snipeShots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(HIVE_POINTS);
  });

  it("gives 100 once for a hive with 19 hits that takes one of each", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }, H2],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
      snipeShots: [shot(fromRightOfHive(H), LEFT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(HIVE_POINTS);
  });

  it("gives 100 once for a hive with 18 hits that takes two of the player's and one snipe's", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 2 }, H2],
      shots: [
        shot(fromLeft({ x: H.x, y: H.y }), RIGHT),
        shot(fromLeft({ x: H.x, y: H.y + 2 }), RIGHT),
      ],
      snipeShots: [shot(fromRightOfHive(H), LEFT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(HIVE_POINTS);
  });

  it("gives 10 once for a snipe that both shots hit", () => {
    const state = arena({
      hives: [H2],
      snipes: [snipe(S)],
      shots: [shot(fromLeft(S), RIGHT)],
      snipeShots: [shot(fromRightOfSnipe(S), LEFT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.shots).toEqual([]);
    expect(after.snipeShots).toEqual([]);
    expect(after.score).toBe(SNIPE_POINTS);
  });

  it("gives 10 once for a snipe that both shots hit, the snipe's from the left", () => {
    const state = arena({
      hives: [H2],
      snipes: [snipe(S)],
      shots: [shot(fromRightOfSnipe(S), LEFT)],
      snipeShots: [shot(fromLeft(S), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.score).toBe(SNIPE_POINTS);
  });

  it("adds the bonus when such a hit clears the level", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 2 }],
      snipes: [snipe(S)],
      shots: [
        shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
        shot(fromLeft(S), RIGHT),
      ],
      snipeShots: [
        shot(fromRightOfHive(H), LEFT),
        shot(fromRightOfSnipe(S), LEFT),
      ],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toEqual([]);
    expect(after.snipes).toEqual([]);
    expect(after.cleared).toBe(true);
    expect(after.score).toBe(
      HIVE_POINTS + SNIPE_POINTS + levelBonus(after.lives, 1),
    );
  });
});

describe("2.7 Levels and scoring: points and bonus the same for every letter and digit", () => {
  // Each skill level gets the same scene: on the first tick the player's shots destroy a hive
  // with 19 hits and kill a snipe. With a second hive the level goes on; without, it is cleared.

  function scene(skill: string, last: boolean, lives?: number): GameState {
    return arena({
      skill,
      lives,
      hives: last ? [{ ...H, hits: HITS - 1 }] : [{ ...H, hits: HITS - 1 }, H2],
      snipes: [snipe(S)],
      shots: [
        shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
        shot(fromLeft(S), RIGHT),
      ],
    });
  }

  // Each digit is its own test, every letter in it, so that no test runs long.
  it.each(DIGITS)(
    "gives 110 for a hive and a snipe at every letter, digit %d",
    (digit) => {
      for (const letter of LETTERS) {
        const skill = `${letter}${digit}`;
        const after = step(scene(skill, false), NO_INPUT);
        expect(after.cleared, skill).toBe(false);
        expect(after.score, skill).toBe(HIVE_POINTS + SNIPE_POINTS);
      }
    },
    SLOW,
  );

  it.each(DIGITS)(
    "gives the same bonus for the same lives and time at every letter, digit %d",
    (digit) => {
      for (const letter of LETTERS) {
        const skill = `${letter}${digit}`;
        const after = step(scene(skill, true, 3), NO_INPUT);
        expect(after.cleared, skill).toBe(true);
        expect(after.lives, skill).toBe(3);
        expect(after.score, skill).toBe(
          HIVE_POINTS + SNIPE_POINTS + levelBonus(3, 1),
        );
      }
    },
    SLOW,
  );

  it.each(DIGITS)(
    "gives the bonus from the digit's own lives at every letter, digit %d",
    (digit) => {
      const lives = LIVES[digit - 1];
      for (const letter of LETTERS) {
        const skill = `${letter}${digit}`;
        const after = step(scene(skill, true), NO_INPUT);
        expect(after.cleared, skill).toBe(true);
        expect(after.lives, skill).toBe(lives);
        expect(after.score, skill).toBe(
          HIVE_POINTS + SNIPE_POINTS + levelBonus(lives, 1),
        );
      }
    },
    SLOW,
  );
});

describe("2.7 Levels and scoring: cleared exactly when no hive and no snipe is left (6.2)", () => {
  it("is not cleared while a hive is left, with no snipes", () => {
    let state = arena({ hives: [H] });
    for (let tick = 1; tick <= SECOND; tick++) {
      state = quiet(state);
      expect(state.cleared, `tick ${tick}`).toBe(false);
    }
  });

  it("is not cleared while a snipe is left, with no hives", () => {
    let state = arena({ snipes: [snipe(S)] });
    for (let tick = 1; tick <= SECOND; tick++) {
      state = step(state, NO_INPUT);
      expect(state.snipes, `tick ${tick}`).toHaveLength(1);
      expect(state.cleared, `tick ${tick}`).toBe(false);
    }
    expect(state.score).toBe(0);
  });

  it("is not cleared when one of two hives is destroyed", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }, H2],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toHaveLength(1);
    expect(after.cleared).toBe(false);
  });

  it("is not cleared when the last hive is destroyed while a snipe is left, and gives no bonus", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }],
      snipes: [snipe(S)],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    let after = step(state, NO_INPUT);
    expect(after.hives).toEqual([]);
    expect(after.snipes).toHaveLength(1);
    expect(after.cleared).toBe(false);
    expect(after.score).toBe(HIVE_POINTS);
    // No hive is left to spawn, and the snipe is still there a while later.
    for (let tick = 2; tick <= 20; tick++) {
      after = step(after, NO_INPUT);
      expect(after.snipes, `tick ${tick}`).toHaveLength(1);
      expect(after.cleared, `tick ${tick}`).toBe(false);
    }
    expect(after.score).toBe(HIVE_POINTS);
  });

  it("is not cleared when one of two snipes is killed", () => {
    const state = arena({
      snipes: [snipe(S), snipe(S2)],
      shots: [shot(fromLeft(S), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toHaveLength(1);
    expect(after.cleared).toBe(false);
    expect(after.score).toBe(SNIPE_POINTS);
  });

  it("is cleared on the tick the player's shot destroys the last hive, with no snipes", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toEqual([]);
    expect(after.snipes).toEqual([]);
    expect(after.cleared).toBe(true);
  });

  it("is cleared on the tick the player's shot kills the last snipe, with no hives", () => {
    const state = arena({
      snipes: [snipe(S)],
      shots: [shot(fromLeft(S), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.cleared).toBe(true);
  });

  it("is cleared when the last hive and the last snipe go on the same tick", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }],
      snipes: [snipe(S)],
      shots: [
        shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT),
        shot(fromLeft(S), RIGHT),
      ],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toEqual([]);
    expect(after.snipes).toEqual([]);
    expect(after.cleared).toBe(true);
  });

  it("is cleared when a snipe's shot destroys the last hive (2.5: it counts toward clearing)", () => {
    const state = arena({
      hives: [{ ...H, hits: HITS - 1 }],
      snipeShots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.hives).toEqual([]);
    expect(after.cleared).toBe(true);
  });

  it("is cleared when a snipe's shot kills the last snipe", () => {
    const state = arena({
      snipes: [snipe(S)],
      snipeShots: [shot(fromLeft(S), RIGHT)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.cleared).toBe(true);
  });

  it("is cleared with a player's shot still in flight", () => {
    const state = arena({
      snipes: [snipe(S)],
      shots: [shot(fromLeft(S), RIGHT), shot({ x: 10, y: 20 }, DOWN)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.shots).toHaveLength(1);
    expect(after.cleared).toBe(true);
  });

  it("is cleared with a snipe's shot still in flight (6.2: no hives, snipes or ghosts)", () => {
    const state = arena({
      snipes: [snipe(S)],
      shots: [shot(fromLeft(S), RIGHT)],
      snipeShots: [shot({ x: 10, y: 20 }, DOWN)],
    });
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.snipeShots).toHaveLength(1);
    expect(after.cleared).toBe(true);
  });

  it("is cleared while the player is out of play, waiting to come back", () => {
    const state = {
      ...arena({ snipes: [snipe(S)], shots: [shot(fromLeft(S), RIGHT)] }),
      respawn: SECOND,
    };
    const after = step(state, NO_INPUT);
    expect(after.snipes).toEqual([]);
    expect(after.respawn).toBeGreaterThan(0);
    expect(after.cleared).toBe(true);
  });

  it("marks a level with no hives and no snipes cleared after one tick (6.2)", () => {
    const after = step(arena({}), NO_INPUT);
    expect(after.hives).toEqual([]);
    expect(after.snipes).toEqual([]);
    expect(after.cleared).toBe(true);
  });

  it("stays cleared while the game is stepped on, moving and firing", () => {
    let state = step(
      arena({
        hives: [{ ...H, hits: HITS - 1 }],
        shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
      }),
      NO_INPUT,
    );
    expect(state.cleared).toBe(true);
    const inputs: InputState[] = [
      NO_INPUT,
      { ...NO_INPUT, moveX: 1, fireX: 1 },
      { ...NO_INPUT, moveY: 1, fireY: 1, fast: true },
      { ...NO_INPUT, moveX: -1, moveY: -1, fireX: -1, fireY: 1 },
    ];
    for (const [i, input] of inputs.entries()) {
      for (let t = 0; t < 2 * SECOND; t++) {
        state = step(state, input);
        expect(state.cleared, `input ${i}, tick ${t}`).toBe(true);
      }
    }
  });

  it("is cleared in a generated maze when the player destroys the last hive", () => {
    // The player is at its start, 5 open cells from its block's left wall and 3 from its top
    // wall (2.10). The block has 15 x 11 open cells, so a hive fits right of the place where the
    // player's shot to the right appears.
    const game = createGame(5, "A1");
    const p = game.player;
    const hive = { x: p.x + PLAYER + SHOT, y: p.y + 1 };
    expect(clear(game.maze, { ...hive, width: HIVE, height: HIVE })).toBe(true);
    let state: GameState = {
      ...game,
      hives: [{ ...game.hives[0], ...hive, hits: HITS - 1 }],
      snipes: [],
    };
    state = step(state, hold(1, 0));
    expect(state.cleared).toBe(false);
    expect(state.shots).toHaveLength(1);
    state = step(state, NO_INPUT);
    expect(state.hives).toEqual([]);
    expect(state.cleared).toBe(true);
    expect(state.score).toBe(HIVE_POINTS + levelBonus(state.lives, 2));
  });
});

describe("2.7 Levels and scoring: the level bonus, levelBonus(lives, ticks)", () => {
  // L is 1 or more: a level cleared by a player with no lives left is open (2.7, WP 13). T
  // counts the level's ticks from 1.
  const LIVES_LEFT = [1, 2, 3, 4, 5];
  const WINDOW = 18_000; // 2.7: the first 5 minutes, in which a faster clear always gives more
  const FASTER = 60; // 2.7: how much faster, in ticks, a clear must be to give strictly more
  const TIMES = [
    1,
    2,
    SECOND,
    10 * SECOND,
    MINUTE,
    3 * MINUTE,
    WINDOW - FASTER,
    WINDOW - 1,
    WINDOW,
    WINDOW + 1,
    10 * MINUTE,
    30 * MINUTE,
    60 * MINUTE,
    10 * 60 * MINUTE,
  ];

  // The pairs (lives, ticks) for which `wrong` is true, at most 10 of them.
  function where(
    wrong: (lives: number, ticks: number) => boolean,
    last: number,
  ): string[] {
    const found: string[] = [];
    for (const lives of LIVES_LEFT) {
      for (let ticks = 1; ticks <= last && found.length < 10; ticks++) {
        if (wrong(lives, ticks)) found.push(`${lives} lives, ${ticks} ticks`);
      }
    }
    return found;
  }

  it("is a whole number, at least 0", () => {
    for (const lives of LIVES_LEFT) {
      for (const ticks of TIMES) {
        const bonus = levelBonus(lives, ticks);
        expect(Number.isInteger(bonus), `${lives} lives, ${ticks} ticks`).toBe(
          true,
        );
        expect(bonus, `${lives} lives, ${ticks} ticks`).toBeGreaterThanOrEqual(
          0,
        );
      }
    }
    expect(
      where(
        (l, t) => !Number.isInteger(levelBonus(l, t)) || levelBonus(l, t) < 0,
        WINDOW + FASTER,
      ),
    ).toEqual([]);
  });

  it("rises with each extra life, at every time", () => {
    for (const ticks of TIMES) {
      for (let lives = 2; lives <= MOST_LIVES; lives++) {
        expect(
          levelBonus(lives, ticks),
          `${lives} lives, ${ticks} ticks`,
        ).toBeGreaterThan(levelBonus(lives - 1, ticks));
      }
    }
  });

  it("never falls for a faster clear, tick by tick in the first 10 minutes", () => {
    expect(
      where((l, t) => levelBonus(l, t) < levelBonus(l, t + 1), 2 * WINDOW),
    ).toEqual([]);
  });

  it("never falls for a faster clear, after that too", () => {
    for (const lives of LIVES_LEFT) {
      for (let i = 1; i < TIMES.length; i++) {
        expect(
          levelBonus(lives, TIMES[i]),
          `${lives} lives, ${TIMES[i]} ticks`,
        ).toBeLessThanOrEqual(levelBonus(lives, TIMES[i - 1]));
      }
    }
  });

  it("is strictly higher for a clear 60 ticks faster, both within the first 18,000 ticks", () => {
    // With the check above, this covers every pair of clears at least 60 ticks apart in the
    // window.
    expect(
      where(
        (l, t) => levelBonus(l, t) <= levelBonus(l, t + FASTER),
        WINDOW - FASTER,
      ),
    ).toEqual([]);
  });

  it("is strictly higher for the fastest clear than for one at the end of the window", () => {
    for (const lives of LIVES_LEFT) {
      expect(levelBonus(lives, 1), `${lives} lives`).toBeGreaterThan(
        levelBonus(lives, WINDOW),
      );
    }
  });

  it("is the same for the same lives and time", () => {
    expect(levelBonus(3, 1234)).toBe(levelBonus(3, 1234));
  });
});

describe("2.7 Levels and scoring: the bonus is given once, when the level is cleared", () => {
  // A lone hive with 19 hits waits `wait` ticks; then a player's shot destroys it on the next
  // tick, which clears the level on its tick T = wait + 1.
  function clearAfter(wait: number, lives: number): GameState {
    let state = arena({ hives: [{ ...H, hits: HITS - 1 }], lives });
    for (let tick = 0; tick < wait; tick++) state = quiet(state);
    expect(state.hives).toHaveLength(1);
    expect(state.cleared).toBe(false);
    expect(state.score).toBe(0);
    state = {
      ...state,
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    };
    const after = step(state, NO_INPUT);
    expect(after.hives).toEqual([]);
    expect(after.cleared).toBe(true);
    expect(after.lives).toBe(lives);
    return after;
  }

  it("adds the bonus to the hive's points on the tick a hive clears the level", () => {
    const after = clearAfter(0, 5);
    expect(after.score).toBe(HIVE_POINTS + levelBonus(5, 1));
  });

  it("adds the bonus to the snipe's points on the tick a snipe clears the level", () => {
    const after = step(
      arena({ snipes: [snipe(S)], shots: [shot(fromLeft(S), RIGHT)] }),
      NO_INPUT,
    );
    expect(after.cleared).toBe(true);
    expect(after.score).toBe(SNIPE_POINTS + levelBonus(after.lives, 1));
  });

  it("gives only the bonus when a snipe's shot clears the level", () => {
    const hive = step(
      arena({
        hives: [{ ...H, hits: HITS - 1 }],
        snipeShots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
      }),
      NO_INPUT,
    );
    expect(hive.cleared).toBe(true);
    expect(hive.score).toBe(levelBonus(hive.lives, 1));

    const snipeKilled = step(
      arena({ snipes: [snipe(S)], snipeShots: [shot(fromLeft(S), RIGHT)] }),
      NO_INPUT,
    );
    expect(snipeKilled.cleared).toBe(true);
    expect(snipeKilled.score).toBe(levelBonus(snipeKilled.lives, 1));
  });

  it("uses the lives left", () => {
    expect(levelBonus(5, SECOND)).toBeGreaterThan(levelBonus(2, SECOND));
    expect(clearAfter(SECOND - 1, 5).score).toBe(
      HIVE_POINTS + levelBonus(5, SECOND),
    );
    expect(clearAfter(SECOND - 1, 2).score).toBe(
      HIVE_POINTS + levelBonus(2, SECOND),
    );
  });

  it("uses the time taken: the ticks of the level up to and including the clearing one", () => {
    expect(levelBonus(5, SECOND)).toBeGreaterThan(levelBonus(5, 5 * MINUTE));
    expect(clearAfter(5 * MINUTE - 1, 5).score).toBe(
      HIVE_POINTS + levelBonus(5, 5 * MINUTE),
    );
    expect(clearAfter(3 * MINUTE - 1, 4).score).toBe(
      HIVE_POINTS + levelBonus(4, 3 * MINUTE),
    );
  });

  it("is given after the last snipe, not when the last hive goes before it", () => {
    let state = arena({
      hives: [{ ...H, hits: HITS - 1 }],
      snipes: [snipe(S)],
      shots: [shot(fromLeft({ x: H.x, y: H.y + 1 }), RIGHT)],
    });
    state = step(state, NO_INPUT);
    expect(state.cleared).toBe(false);
    expect(state.score).toBe(HIVE_POINTS);
    const ticks = 30;
    state = run(state, ticks - 2);
    expect(state.snipes).toHaveLength(1);
    expect(state.score).toBe(HIVE_POINTS);
    // A player's shot just left of where the snipe now is kills it on the next tick.
    state = { ...state, shots: [shot(fromLeft(state.snipes[0]), RIGHT)] };
    state = step(state, NO_INPUT);
    expect(state.snipes).toEqual([]);
    expect(state.cleared).toBe(true);
    expect(state.score).toBe(
      HIVE_POINTS + SNIPE_POINTS + levelBonus(state.lives, ticks),
    );
  });

  it("is never given again on later ticks", () => {
    let state = clearAfter(0, 5);
    const score = state.score;
    for (const input of [
      NO_INPUT,
      hold(1, 0),
      hold(-1, 1),
      { ...NO_INPUT, moveX: 1 as const, moveY: 1 as const },
    ]) {
      for (let t = 0; t < 3 * SECOND; t++) {
        state = step(state, input);
        expect(state.score).toBe(score);
      }
    }
    expect(state.cleared).toBe(true);
  });
});

describe("2.6 Skill level: the digit sets the lives", () => {
  it.each(DIGITS)(
    "digit %d, every letter",
    (digit) => {
      for (const letter of LETTERS) {
        const skill = `${letter}${digit}`;
        expect(createGame(9, skill).lives, skill).toBe(LIVES[digit - 1]);
      }
    },
    SLOW,
  );

  it("does not depend on the seed", () => {
    for (const seed of [0, 1, 77, 2 ** 32 - 1]) {
      for (const digit of DIGITS) {
        expect(createGame(seed, `B${digit}`).lives).toBe(LIVES[digit - 1]);
      }
    }
  });

  it("gives a game without a skill level the lives of a digit", () => {
    expect(LIVES).toContain(createGame(42).lives);
  });

  it.each([
    ["A6", 4],
    ["M8", 3],
    ["Z9", 2],
  ] as const)("at %s, a death leaves one life fewer", (skill, lives) => {
    const centre = { x: 30, y: 22 };
    const game = createGame(1, skill);
    expect(game.lives).toBe(lives);
    const state: GameState = {
      ...game,
      maze: room,
      player: { ...game.player, ...centre },
      hives: [{ ...game.hives[0], ...H2, hits: 0 }],
      snipes: [],
      shots: [],
      snipeShots: [shot({ x: centre.x - SHOT, y: centre.y + 1 }, RIGHT)],
    };
    const after = step(state, NO_INPUT);
    expect(after.lives).toBe(lives - 1);
  });
});

// Guards on the test's own places: every footprint and shot start used above is open.
describe("2.10 Sizes: the places the scoring tests use", () => {
  it("are open in the room", () => {
    for (const h of [H, H2, { x: 50, y: 40 }]) {
      expect(clear(room, { ...h, width: HIVE, height: HIVE })).toBe(true);
    }
    for (const s of [S, S2]) {
      expect(clear(room, { ...s, width: SNIPE_W, height: SNIPE_H })).toBe(true);
      expect(clear(room, { ...fromLeft(s), width: SHOT, height: SHOT })).toBe(
        true,
      );
    }
    expect(clear(room, { ...P, width: PLAYER, height: PLAYER })).toBe(true);
  });
});
