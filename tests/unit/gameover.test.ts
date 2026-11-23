import { describe, expect, it } from "vitest";
import { createGrid, type Point } from "../../src/core/grid";
import { levelBonus } from "../../src/core/score";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2, 2.2, 2.7, 4.3, 6.2 and 9.1 WP 13: one level per game. Clearing the level wins the
// game; losing the last life ends it 120 ticks later, unless the level is cleared first. After
// that, `step` changes nothing.
//
// - `state.gameOver` (new in WP 13) is false in a new game. It becomes true at the end of the
//   120th tick after the tick of the death that leaves 0 lives, whether or not a spot is safe,
//   unless the level is cleared on or before that tick. It is never true while the player has
//   lives left.
// - `state.cleared` (WP 12) is the game being won: the level is cleared, and there is one
//   level per game (2.7). A game is never both won and over.
// - The death that leaves 0 lives is the last: the player stays out of play (`state.respawn`
//   above 0, WP 11) and does not come back, so it neither moves nor fires.
// - A clear while the player has no lives left wins, with the bonus for L = 0:
//   levelBonus(0, T), T being the ticks of the level up to and including the clearing one.
// - `step` on a won or lost game returns it unchanged, whatever the input and whatever is in
//   flight (2.7, 6.2: no tick runs after the game is won or over).
//
// The games are built from a new game (A1) in an open field, as in the WP 11 and 12 tests, so
// the level's first `step` is its tick 1. A level with no hive and no snipe is cleared on its
// first tick (2.7), so every game here keeps at least one hive. The hives here never spawn:
// their wait for the next spawn (`Hive.wait`, WP 09) never runs out, so nothing else happens.

type Axis = InputState["moveX"];
type Hive = GameState["hives"][number];
type Shot = GameState["shots"][number];

const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)
const HIVE = 4; // a hive's footprint is HIVE x HIVE cells (2.10)
const HITS = 20; // the 20th hit destroys a hive (2.3)
const HIVE_POINTS = 100; // 2.7
const OVER_TICKS = 120; // 2.2: the game is over at the end of the 120th tick after the death
const BLOCK_W = 16; // the maze's blocks are BLOCK_W x BLOCK_H cells (2.10)
const BLOCK_H = 12;
const NEVER = Number.MAX_SAFE_INTEGER; // a hive's wait that never runs out

// An open field of 8 x 8 blocks, wrapping at its edges.
const field = createGrid(8 * BLOCK_W, 8 * BLOCK_H, () => "open");

// The player, and a hive well away from it: columns 100 to 103, rows 70 to 73.
const P = { x: 30, y: 30 };
const H = { x: 100, y: 70 };

// Inputs that would move and fire the player in play.
const INPUTS: readonly InputState[] = [
  NO_INPUT,
  { ...NO_INPUT, moveX: 1, fireX: 1 },
  { ...NO_INPUT, moveY: -1, fireX: -1, fireY: -1 },
  { ...NO_INPUT, moveX: -1, moveY: 1, fast: true },
  { ...NO_INPUT, fireY: 1 },
];

function input(tick: number): InputState {
  return INPUTS[tick % INPUTS.length];
}

// A hive at `p` with `hits` hits taken, that never spawns.
function hive(p: Point, hits = 0): Hive {
  return { ...createGame(1).hives[0], x: p.x, y: p.y, hits, wait: NEVER };
}

function shot(p: Point, dx: Axis, dy: Axis): Shot {
  return { x: p.x, y: p.y, dx, dy };
}

// A shot going right that enters the player's footprint on its `move`th move (1 or more).
function atPlayer(player: Point, move = 1): Shot {
  return shot({ x: player.x - SHOT - (move - 1), y: player.y + 1 }, 1, 0);
}

// A shot going right that enters the hive at `p` on its first move.
function atHive(p: Point): Shot {
  return shot({ x: p.x - SHOT, y: p.y + 1 }, 1, 0);
}

interface Setup {
  readonly lives?: number;
  readonly player?: Point;
  readonly hives?: readonly Hive[];
  readonly shots?: readonly Shot[];
  readonly snipeShots?: readonly Shot[];
}

// A new game at A1 in the field, with the player at P and only what the setup names: by
// default one hive at H that never spawns, and nothing in flight.
function arena(setup: Setup = {}): GameState {
  const game = createGame(1, "A1");
  return {
    ...game,
    maze: field,
    player: { ...game.player, ...(setup.player ?? P) },
    hives: setup.hives ?? [hive(H)],
    snipes: [],
    shots: setup.shots ?? [],
    snipeShots: setup.snipeShots ?? [],
    lives: setup.lives ?? game.lives,
  };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

// A hive at the middle of every block of the field, so that no block is safe (2.2).
function everyBlock(): Hive[] {
  const hives: Hive[] = [];
  for (let by = 0; by < field.height / BLOCK_H; by++) {
    for (let bx = 0; bx < field.width / BLOCK_W; bx++) {
      hives.push(hive({ x: bx * BLOCK_W + 6, y: by * BLOCK_H + 4 }));
    }
  }
  return hives;
}

interface LastDeath {
  /** The state at the end of the tick the player died on. */
  readonly dead: GameState;
  /** That tick, counted from the level's first. */
  readonly tick: number;
}

// Steps with no key held until the player dies; at most 60 ticks.
function untilDeath(start: GameState): LastDeath {
  let state = start;
  for (let tick = 1; tick <= 60; tick++) {
    state = step(state, NO_INPUT);
    if (state.lives < start.lives) return { dead: state, tick };
  }
  throw new Error("The player did not die");
}

// The player's last life, lost on tick `move` to a snipe's shot.
function lastDeath(setup: Setup = {}, move = 1): LastDeath {
  const player = setup.player ?? P;
  const death = untilDeath(
    arena({ ...setup, lives: 1, snipeShots: [atPlayer(player, move)] }),
  );
  expect(death.tick).toBe(move);
  expect(death.dead.lives).toBe(0);
  return death;
}

// Steps `ticks` times, holding the inputs in turn.
function run(state: GameState, ticks: number): GameState {
  let current = state;
  for (let t = 1; t <= ticks; t++) current = step(current, input(t));
  return current;
}

// ===========================================================================================

describe("2.2 Player / 2.7 Levels and scoring: a new game is neither won nor over", () => {
  it.each(["A1", "M5", "Z9"])("at %s", (skill) => {
    const game = createGame(7, skill);
    expect(game.gameOver).toBe(false);
    expect(game.cleared).toBe(false);
  });

  it("without a skill level", () => {
    expect(createGame(7).gameOver).toBe(false);
  });

  it("keeps the mark in plain data that can be copied", () => {
    const state = run(createGame(3), 10);
    expect(state.gameOver).toBe(false);
    expect(structuredClone(state)).toEqual(state);
  });
});

describe("2.2 Player: the game is over at the end of the 120th tick after the last death", () => {
  it("is not over on the death tick or the 119 ticks after it, and is over on the 120th", () => {
    const { dead } = lastDeath();
    expect(dead.gameOver).toBe(false);
    expect(dead.respawn).toBeGreaterThan(0);
    let state = dead;
    for (let t = 1; t < OVER_TICKS; t++) {
      state = step(state, input(t));
      expect(state.gameOver, `tick ${t} after the death`).toBe(false);
      expect(state.cleared, `tick ${t} after the death`).toBe(false);
      expect(state.lives, `tick ${t} after the death`).toBe(0);
    }
    state = step(state, input(OVER_TICKS));
    expect(state.gameOver).toBe(true);
    expect(state.cleared).toBe(false);
    expect(state.lives).toBe(0);
  });

  it("counts the 120 ticks from the tick of the death, not from the start", () => {
    // The shot enters the player's footprint on its 10th move: the player dies on tick 10.
    const { dead, tick } = lastDeath({}, 10);
    expect(tick).toBe(10);
    const before = run(dead, OVER_TICKS - 1);
    expect(before.gameOver).toBe(false);
    expect(before.ticks).toBe(tick + OVER_TICKS - 1);
    const over = step(before, NO_INPUT);
    expect(over.gameOver).toBe(true);
    expect(over.ticks).toBe(tick + OVER_TICKS);
  });

  it("does not bring the player back: out of play, it neither moves nor fires", () => {
    const { dead } = lastDeath();
    const died = where(dead.player);
    let state = dead;
    for (let t = 1; t <= OVER_TICKS; t++) {
      state = step(state, input(t));
      expect(state.respawn, `tick ${t} after the death`).toBeGreaterThan(0);
      expect(where(state.player), `tick ${t} after the death`).toEqual(died);
      expect(state.shots, `tick ${t} after the death`).toEqual([]);
    }
    expect(state.gameOver).toBe(true);
  });

  it("is over on the 120th tick although a spot is safe", () => {
    // The field has one hive, so nearly every block is safe; with a life left the player
    // would come back on this tick (2.2).
    const over = run(lastDeath().dead, OVER_TICKS);
    expect(over.gameOver).toBe(true);
    expect(over.respawn).toBeGreaterThan(0);
  });

  it("is over on the 120th tick when no spot is safe", () => {
    const over = run(lastDeath({ hives: everyBlock() }).dead, OVER_TICKS);
    expect(over.gameOver).toBe(true);
    expect(over.hives).toHaveLength(everyBlock().length);
  });

  it("with a life left, the player comes back instead, and the game goes on", () => {
    const dead = untilDeath(
      arena({ lives: 2, snipeShots: [atPlayer(P)] }),
    ).dead;
    expect(dead.lives).toBe(1);
    let state = dead;
    for (let t = 1; t <= OVER_TICKS; t++) {
      state = step(state, input(t));
      expect(state.gameOver, `tick ${t} after the death`).toBe(false);
    }
    expect(state.respawn).toBe(0);
    expect(state.lives).toBe(1);
    // And it goes on for a while longer, still not over.
    const later = run(state, 3 * OVER_TICKS);
    expect(later.gameOver).toBe(false);
    expect(later.ticks).toBe(state.ticks + 3 * OVER_TICKS);
  });

  it("with a life left and no safe spot, it is not over while the player waits", () => {
    const dead = untilDeath(
      arena({ lives: 2, hives: everyBlock(), snipeShots: [atPlayer(P)] }),
    ).dead;
    let state = dead;
    for (let t = 1; t <= 2 * OVER_TICKS; t++) {
      state = step(state, input(t));
      expect(state.gameOver, `tick ${t} after the death`).toBe(false);
      expect(state.respawn, `tick ${t} after the death`).toBeGreaterThan(0);
    }
    expect(state.lives).toBe(1);
  });

  it("is over 120 ticks after the second death when the first left a life", () => {
    const first = untilDeath(arena({ lives: 2, snipeShots: [atPlayer(P)] }));
    let state = run(first.dead, OVER_TICKS);
    expect(state.respawn).toBe(0);
    expect(state.gameOver).toBe(false);
    // Back in play: a shot that enters its footprint on the next tick kills it again.
    state = { ...state, snipeShots: [atPlayer(state.player)] };
    state = step(state, NO_INPUT);
    expect(state.lives).toBe(0);
    expect(state.respawn).toBeGreaterThan(0);
    const before = run(state, OVER_TICKS - 1);
    expect(before.gameOver).toBe(false);
    expect(step(before, NO_INPUT).gameOver).toBe(true);
  });
});

describe("2.7 Levels and scoring: a clear before or on the game-over tick wins, with L = 0", () => {
  // After the last death, the hive is given 19 hits and a shot that enters it on the next
  // tick, which is `after` ticks after the death.
  function clearAfter(after: number, byPlayer: boolean): GameState {
    const { dead, tick } = lastDeath();
    let state = run(dead, after - 1);
    expect(state.gameOver).toBe(false);
    expect(state.score).toBe(0);
    const last = atHive(H);
    state = {
      ...state,
      hives: [hive(H, HITS - 1)],
      shots: byPlayer ? [last] : [],
      snipeShots: byPlayer ? [] : [last],
    };
    const won = step(state, NO_INPUT);
    expect(won.hives).toEqual([]);
    expect(won.ticks).toBe(tick + after);
    return won;
  }

  it.each([1, 2, 60, OVER_TICKS - 1, OVER_TICKS])(
    "a player's shot that destroys the last hive %d ticks after the last death wins",
    (after) => {
      const won = clearAfter(after, true);
      expect(won.cleared).toBe(true);
      expect(won.gameOver).toBe(false);
      expect(won.lives).toBe(0);
      expect(won.score).toBe(HIVE_POINTS + levelBonus(0, won.ticks));
    },
  );

  it.each([1, OVER_TICKS])(
    "a snipe's shot that destroys the last hive %d ticks after the last death wins, with only the bonus",
    (after) => {
      const won = clearAfter(after, false);
      expect(won.cleared).toBe(true);
      expect(won.gameOver).toBe(false);
      expect(won.score).toBe(levelBonus(0, won.ticks));
    },
  );

  it("a clear on the tick of the last death itself wins", () => {
    // On tick 1 a snipe's shot kills the player and the player's shot destroys the last hive.
    const state = arena({
      lives: 1,
      hives: [hive(H, HITS - 1)],
      shots: [atHive(H)],
      snipeShots: [atPlayer(P)],
    });
    const won = step(state, NO_INPUT);
    expect(won.lives).toBe(0);
    expect(won.hives).toEqual([]);
    expect(won.cleared).toBe(true);
    expect(won.gameOver).toBe(false);
    expect(won.score).toBe(HIVE_POINTS + levelBonus(0, 1));
    // It stays won, and never becomes over.
    const later = run(won, 2 * OVER_TICKS);
    expect(later.cleared).toBe(true);
    expect(later.gameOver).toBe(false);
    expect(later.score).toBe(won.score);
  });

  it("a clear one tick after the game is over is too late", () => {
    const over = run(lastDeath().dead, OVER_TICKS);
    expect(over.gameOver).toBe(true);
    const state = {
      ...over,
      hives: [hive(H, HITS - 1)],
      shots: [atHive(H)],
    };
    const after = step(state, NO_INPUT);
    expect(after).toStrictEqual(state);
    expect(after.cleared).toBe(false);
    expect(after.hives).toHaveLength(1);
    expect(after.score).toBe(0);
  });

  it("the level bonus for L = 0 is a whole number, at least 0, below the bonus for 1 life", () => {
    for (const ticks of [
      1, 2, 60, 121, 3600, 17_999, 18_000, 18_001, 360_000,
    ]) {
      const bonus = levelBonus(0, ticks);
      expect(Number.isInteger(bonus), `${ticks} ticks`).toBe(true);
      expect(bonus, `${ticks} ticks`).toBeGreaterThanOrEqual(0);
      expect(levelBonus(1, ticks), `${ticks} ticks`).toBeGreaterThan(bonus);
    }
  });

  it("the level bonus for L = 0 is strictly higher for a clear 60 ticks faster within the first 18,000 ticks", () => {
    for (let ticks = 1; ticks + 60 <= 18_000; ticks++) {
      if (levelBonus(0, ticks) <= levelBonus(0, ticks + 60)) {
        expect.fail(`levelBonus(0, ${ticks}) <= levelBonus(0, ${ticks + 60})`);
      }
      if (levelBonus(0, ticks) < levelBonus(0, ticks + 1)) {
        expect.fail(`levelBonus(0, ${ticks}) < levelBonus(0, ${ticks + 1})`);
      }
    }
  });
});

describe("2.7 Levels and scoring / 4.3 Game loop: step changes nothing after the game is won", () => {
  // The level is cleared on tick 1 by the player's shot, with lives left and the player in
  // play; a snipe's shot is on its way to the player and another player's shot is in flight.
  function won(): GameState {
    const state = arena({
      hives: [hive(H, HITS - 1)],
      shots: [atHive(H), shot({ x: 60, y: 10 }, 0, 1)],
      snipeShots: [atPlayer(P, 3)],
    });
    const after = step(state, NO_INPUT);
    expect(after.cleared).toBe(true);
    expect(after.gameOver).toBe(false);
    expect(after.lives).toBe(state.lives);
    expect(after.respawn).toBe(0);
    expect(after.shots).toHaveLength(1);
    expect(after.snipeShots).toHaveLength(1);
    return after;
  }

  it.each(INPUTS.map((i, n) => [n, i] as const))(
    "returns the won game unchanged with input %d",
    (_n, held) => {
      const state = won();
      expect(step(state, held)).toStrictEqual(state);
    },
  );

  it("nothing in flight hits anything after the clearing tick, however long it is stepped", () => {
    const state = won();
    const later = run(state, 2 * OVER_TICKS);
    expect(later).toStrictEqual(state);
    // The snipe's shot was 2 moves from the player: it never reaches it.
    expect(later.lives).toBe(state.lives);
    expect(later.snipeShots).toEqual(state.snipeShots);
    expect(later.shots).toEqual(state.shots);
    expect(later.ticks).toBe(1);
  });

  it("keeps a player who was out of play with lives left out of play", () => {
    const dead = untilDeath(
      arena({
        lives: 3,
        hives: [hive(H, HITS - 1)],
        snipeShots: [atPlayer(P)],
      }),
    ).dead;
    expect(dead.lives).toBe(2);
    const state = step({ ...dead, shots: [atHive(H)] }, NO_INPUT);
    expect(state.cleared).toBe(true);
    expect(state.score).toBe(HIVE_POINTS + levelBonus(2, 2));
    const later = run(state, 2 * OVER_TICKS);
    expect(later).toStrictEqual(state);
    expect(later.respawn).toBeGreaterThan(0);
    expect(later.gameOver).toBe(false);
  });

  it("adds the bonus once: the score stays as it was on the clearing tick", () => {
    const state = won();
    expect(state.score).toBe(HIVE_POINTS + levelBonus(state.lives, 1));
    expect(run(state, OVER_TICKS).score).toBe(state.score);
  });
});

describe("2.2 Player / 4.3 Game loop: step changes nothing after the game is over", () => {
  function over(): GameState {
    // A player's shot and a snipe's shot are still in flight, far from anything.
    const { dead } = lastDeath();
    const state = run(
      {
        ...dead,
        shots: [shot({ x: 60, y: 10 }, 0, 1)],
        snipeShots: [shot({ x: 70, y: 10 }, 0, 1)],
      },
      OVER_TICKS,
    );
    expect(state.gameOver).toBe(true);
    expect(state.shots).toHaveLength(1);
    expect(state.snipeShots).toHaveLength(1);
    return state;
  }

  it.each(INPUTS.map((i, n) => [n, i] as const))(
    "returns the lost game unchanged with input %d",
    (_n, held) => {
      const state = over();
      expect(step(state, held)).toStrictEqual(state);
    },
  );

  it("stays over, with nothing moving, however long it is stepped", () => {
    const state = over();
    const later = run(state, 2 * OVER_TICKS);
    expect(later).toStrictEqual(state);
    expect(later.gameOver).toBe(true);
    expect(later.cleared).toBe(false);
    expect(later.ticks).toBe(state.ticks);
  });

  it("does not let a snipe's shot that reaches a hive change it", () => {
    const state = { ...over(), snipeShots: [atHive(H)] };
    const after = step(state, NO_INPUT);
    expect(after).toStrictEqual(state);
    expect(after.hives[0].hits).toBe(0);
  });
});

// Guards on the test's own places.
describe("2.10 Sizes: the places the game-over tests use", () => {
  it("keep the hive well away from the player", () => {
    const apart = (a: number, b: number, size: number) =>
      Math.min(Math.abs(a - b), size - Math.abs(a - b));
    expect(apart(P.x, H.x, field.width)).toBeGreaterThan(HIVE + 8);
    expect(apart(P.y, H.y, field.height)).toBeGreaterThan(HIVE + 8);
  });

  it("put a hive cell in every 16 x 12 block, wherever the blocks start", () => {
    const cells = new Set<string>();
    for (const h of everyBlock()) {
      for (let dy = 0; dy < HIVE; dy++) {
        for (let dx = 0; dx < HIVE; dx++) cells.add(`${h.x + dx},${h.y + dy}`);
      }
    }
    for (let y0 = 0; y0 < BLOCK_H; y0++) {
      for (let x0 = 0; x0 < BLOCK_W; x0++) {
        let found = false;
        for (let y = y0; y < y0 + BLOCK_H && !found; y++) {
          for (let x = x0; x < x0 + BLOCK_W && !found; x++) {
            found = cells.has(`${x},${y}`);
          }
        }
        expect(found, `block at ${x0},${y0}`).toBe(true);
      }
    }
  });
});
