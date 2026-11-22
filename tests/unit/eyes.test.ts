import { describe, expect, it } from "vitest";
import { createGrid, type Point } from "../../src/core/grid";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 3 (Player) and 9.1 WP 11b: the player is a bird head whose pupils look in the last
// firing direction, one of the 8, and straight ahead at the start.
//
// `state.aim` is where the pupils look: `{ x: 0, y: 0 }` is straight ahead (out of the
// screen, pupils centred), otherwise a firing direction with x and y each -1, 0 or 1 (y grows
// downwards, so up is y = -1). A new game starts looking straight ahead. Each shot the player
// fires turns the pupils to its direction, and they keep looking that way until the next
// shot; moving, or holding no fire key, does not change it.
//
// The cases fire only when a shot is due (2.5: at most one every 13 ticks) in an open field,
// so each fire key held fires a shot.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];

const FIRE_TICKS = 13; // ticks from one shot to the next, at least (2.5)

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

const AHEAD: Point = { x: 0, y: 0 };

function fire([fireX, fireY]: Dir, moveX: Axis = 0, moveY: Axis = 0) {
  return { ...NO_INPUT, fireX, fireY, moveX, moveY };
}

function look(state: GameState): Point {
  return { x: state.aim.x, y: state.aim.y };
}

// A new game in an open field, so that every shot has room to appear (2.5).
function inField(): GameState {
  return {
    ...createGame(1),
    maze: createGrid(64, 48, () => "open"),
    hives: [],
  };
}

function steps(state: GameState, input: InputState, ticks: number) {
  let current = state;
  for (let t = 0; t < ticks; t++) current = step(current, input);
  return current;
}

describe("3 Presentation: Player — the pupils look straight ahead at the start", () => {
  it.each([
    [0, "A1"],
    [1, "A1"],
    [42, "M5"],
    [2026, "Z9"],
    [2 ** 32 - 1, "C3"],
  ])("in a new game (seed %d, %s)", (seed, skill) => {
    expect(look(createGame(seed, skill))).toEqual(AHEAD);
  });

  it("while no fire key has been held, also while the player moves", () => {
    let state = createGame(5);
    for (const input of [
      NO_INPUT,
      { ...NO_INPUT, moveX: 1 as const },
      { ...NO_INPUT, moveY: -1 as const, fast: true },
      { ...NO_INPUT, moveX: -1 as const, moveY: 1 as const },
    ]) {
      state = steps(state, input, 10);
      expect(look(state)).toEqual(AHEAD);
    }
  });
});

describe("3 Presentation: Player — the pupils look in the last firing direction", () => {
  it.each(EIGHT)("firing %s turns them that way", (_name, d) => {
    const fired = step(inField(), fire(d));
    // The test's own check that a shot was fired.
    expect(fired.shots).toHaveLength(1);
    expect(look(fired)).toEqual({ x: d[0], y: d[1] });
  });

  it.each(EIGHT)(
    "after firing %s they keep looking that way when the fire key is released",
    (_name, d) => {
      let state = step(inField(), fire(d));
      state = steps(state, NO_INPUT, 3 * FIRE_TICKS);
      expect(look(state)).toEqual({ x: d[0], y: d[1] });
    },
  );

  it("follow each new firing direction, whichever way the player moves", () => {
    let state = inField();
    const moves: Dir[] = [
      [0, 0],
      [1, 0],
      [-1, -1],
      [0, 1],
    ];
    for (const [i, [, d]] of EIGHT.entries()) {
      const [moveX, moveY] = moves[i % moves.length];
      const before = state.shots.length;
      state = step(state, fire(d, moveX, moveY));
      expect(state.shots.length, `firing ${d.join(",")}`).toBe(before + 1);
      expect(look(state)).toEqual({ x: d[0], y: d[1] });
      // Moving the other way, with no fire key held, does not turn them.
      state = steps(
        state,
        { ...NO_INPUT, moveX: moveY, moveY: moveX },
        FIRE_TICKS,
      );
      expect(look(state)).toEqual({ x: d[0], y: d[1] });
    }
  });
});
