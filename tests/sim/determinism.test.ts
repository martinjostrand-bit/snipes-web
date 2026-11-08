import { describe, expect, it } from "vitest";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 4.3 and 6.2: the same seed + input log always produces the same final state.
function play(seed: number, inputs: readonly InputState[]): GameState {
  let state = createGame(seed);
  for (const input of inputs) {
    state = step(state, input);
  }
  return state;
}

const TICKS = 30 * 60; // one minute at 30 ticks/s
const idleLog: InputState[] = new Array<InputState>(TICKS).fill(NO_INPUT);

describe("6.2 Determinism", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "seed %d and the same input log give the same final state",
    (seed) => {
      expect(play(seed, idleLog)).toEqual(play(seed, idleLog));
    },
  );

  it("an empty input log leaves the new game as created", () => {
    expect(play(9, [])).toEqual(createGame(9));
  });

  it("different seeds give different final states", () => {
    expect(play(1, idleLog)).not.toEqual(play(2, idleLog));
  });
});
