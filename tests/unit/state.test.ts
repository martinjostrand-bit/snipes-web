import { describe, expect, it } from "vitest";
import { createGame, NO_INPUT, step } from "../../src/core/state";

// Spec 4.3 and 9.1 WP 04: `GameState`, created from a seed, changed only by `step(state, input)`.
// WP 04's step() is empty, so these tests check purity and determinism, not game rules.

describe("4.3 GameState", () => {
  it("is the same for the same seed", () => {
    expect(createGame(42)).toEqual(createGame(42));
  });

  it("holds the seeded PRNG, so different seeds give different states", () => {
    expect(createGame(1)).not.toEqual(createGame(2));
  });

  it("is plain data that can be copied", () => {
    const state = createGame(7);
    expect(structuredClone(state)).toEqual(state);
  });
});

describe("4.3 step(state, input)", () => {
  it("returns a state that can be stepped again", () => {
    let state = createGame(3);
    for (let tick = 0; tick < 10; tick++) {
      state = step(state, NO_INPUT);
    }
    expect(state).toBeDefined();
  });

  it("does not change the state it is given", () => {
    const state = createGame(11);
    const before = structuredClone(state);
    step(state, NO_INPUT);
    expect(state).toEqual(before);
  });

  it("does not change the input it is given", () => {
    const input = structuredClone(NO_INPUT);
    step(createGame(11), input);
    expect(input).toEqual(NO_INPUT);
  });

  it("gives the same next state for the same state and input", () => {
    const state = createGame(5);
    expect(step(state, NO_INPUT)).toEqual(step(state, NO_INPUT));
  });

  it("gives the same next state for a copy of the state", () => {
    let state = createGame(13);
    for (let tick = 0; tick < 5; tick++) {
      state = step(state, NO_INPUT);
    }
    const copy = structuredClone(state);
    expect(step(copy, NO_INPUT)).toEqual(step(state, NO_INPUT));
  });
});
