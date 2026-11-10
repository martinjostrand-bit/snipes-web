import { describe, expect, it } from "vitest";
import { createGrid } from "../../src/core/grid";
import { advance, TICK_MS } from "../../src/core/loop";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 3 (frame rate), 4.3 and 9.1 WP 07: game logic runs at a fixed tick through an
// accumulator loop, whatever the display's refresh rate. Every frame,
// `advance(state, input, carriedMs, elapsedMs)` adds the frame's elapsed time to the time
// carried over from earlier frames, runs one `step(state, input)` for every whole tick
// (`TICK_MS`) in it and carries the rest over to the next frame.

const RIGHT: InputState = { ...NO_INPUT, moveX: 1 };

// A new game with the player in the middle of a large open field, so that holding a direction
// changes the state tick after tick and no wall or edge gets in the way.
function inField(): GameState {
  const game = createGame(1);
  const maze = createGrid(301, 301, () => "open");
  return { ...game, maze, player: { ...game.player, x: 150, y: 150 } };
}

function steps(state: GameState, input: InputState, ticks: number): GameState {
  let current = state;
  for (let tick = 0; tick < ticks; tick++) {
    current = step(current, input);
  }
  return current;
}

// Runs frames of the given lengths one after another, as a requestAnimationFrame loop would.
function frames(
  state: GameState,
  input: InputState,
  lengths: readonly number[],
): { state: GameState; carriedMs: number } {
  let result = { state, carriedMs: 0 };
  for (const elapsed of lengths) {
    result = advance(result.state, input, result.carriedMs, elapsed);
  }
  return result;
}

describe("4.3 Game loop: fixed tick", () => {
  it("has a positive, finite tick length", () => {
    expect(TICK_MS).toBeGreaterThan(0);
    expect(Number.isFinite(TICK_MS)).toBe(true);
  });

  it("runs no tick and carries the time while less than one tick has passed", () => {
    const state = inField();
    const result = advance(state, RIGHT, 0, 0.6 * TICK_MS);
    expect(result.state).toEqual(state);
    expect(result.carriedMs).toBeCloseTo(0.6 * TICK_MS, 6);
  });

  it("runs one tick once the carried and elapsed time make a whole tick", () => {
    const state = inField();
    const result = advance(state, RIGHT, 0.6 * TICK_MS, 0.6 * TICK_MS);
    expect(result.state).toEqual(steps(state, RIGHT, 1));
    expect(result.carriedMs).toBeCloseTo(0.2 * TICK_MS, 6);
  });

  it("runs exactly one tick for a frame exactly one tick long", () => {
    const state = inField();
    const result = advance(state, RIGHT, 0, TICK_MS);
    expect(result.state).toEqual(steps(state, RIGHT, 1));
    expect(result.carriedMs).toBeCloseTo(0, 6);
  });

  it("runs one step per whole tick in a long frame and carries the rest", () => {
    const state = inField();
    const result = advance(state, RIGHT, 0, 3.5 * TICK_MS);
    expect(result.state).toEqual(steps(state, RIGHT, 3));
    expect(result.carriedMs).toBeCloseTo(0.5 * TICK_MS, 6);
  });

  it("runs no tick in a frame in which no time passed", () => {
    const state = inField();
    const result = advance(state, RIGHT, 0.3 * TICK_MS, 0);
    expect(result.state).toEqual(state);
    expect(result.carriedMs).toBeCloseTo(0.3 * TICK_MS, 6);
  });

  it("applies the frame's input to every tick it runs", () => {
    const state = inField();
    const result = advance(state, RIGHT, 0, 9.5 * TICK_MS);
    expect(result.state).toEqual(steps(state, RIGHT, 9));
    expect(result.state.player.x).toBeGreaterThan(state.player.x);
    expect(result.state.player.y).toBe(state.player.y);
  });

  it("does not change the state it is given", () => {
    const state = inField();
    const before = structuredClone(state);
    advance(state, RIGHT, 0, 5.5 * TICK_MS);
    expect(state).toEqual(before);
  });

  // Spec 3: rendering at the display's refresh rate, game logic at a fixed tick rate. The same
  // time played gives the same game at 30, 60 and 144 frames per second and with uneven frames.
  // 1010 ms keeps the total away from a tick boundary for any sensible tick rate.
  it.each([
    ["30 Hz", Array.from({ length: 30 }, () => 1010 / 30)],
    ["60 Hz", Array.from({ length: 60 }, () => 1010 / 60)],
    ["144 Hz", Array.from({ length: 144 }, () => 1010 / 144)],
    [
      "uneven frames",
      Array.from({ length: 100 }, (_, i) => [4, 16, 7, 13, 10.5][i % 5]),
    ],
  ])("runs the same ticks for the same time at %s", (_name, lengths) => {
    const total = lengths.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeCloseTo(1010, 6);
    const ticks = Math.floor(1010 / TICK_MS);
    const state = inField();

    const result = frames(state, RIGHT, lengths);

    expect(result.state).toEqual(steps(state, RIGHT, ticks));
    expect(result.carriedMs).toBeCloseTo(1010 - ticks * TICK_MS, 6);
  });

  it("never carries a whole tick or a negative time between frames", () => {
    const lengths = Array.from(
      { length: 200 },
      (_, i) => [0, 1, 5, 16.7, 33.4, 50, 99.9][i % 7],
    );
    let result = { state: inField(), carriedMs: 0 };
    for (const elapsed of lengths) {
      result = advance(result.state, RIGHT, result.carriedMs, elapsed);
      expect(result.carriedMs).toBeGreaterThanOrEqual(0);
      expect(result.carriedMs).toBeLessThan(TICK_MS);
    }
  });
});
