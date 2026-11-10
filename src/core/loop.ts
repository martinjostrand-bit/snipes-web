import { step, type GameState, type InputState } from "./state";

// Spec 4.3: game logic runs at a fixed 30 ticks per second, whatever the frame rate.
export const TICK_MS = 1000 / 30;

// Spec 4.3: the accumulator loop. Runs one step for every whole tick in the time carried over
// from earlier frames plus this frame's, and carries the rest over to the next frame.
export function advance(
  state: GameState,
  input: InputState,
  carriedMs: number,
  elapsedMs: number,
): { state: GameState; carriedMs: number } {
  let current = state;
  let time = carriedMs + elapsedMs;
  while (time >= TICK_MS) {
    current = step(current, input);
    time -= TICK_MS;
  }
  return { state: current, carriedMs: time };
}
