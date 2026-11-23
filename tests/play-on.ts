import { step, type GameState, type InputState } from "../src/core/state";

// Spec 2.7 (v0.16, WP 13): a level with no hive, snipe or ghost left is cleared at the end of
// its first tick, which wins the game (`state.cleared`), and `step` on a won game returns it
// unchanged. The tests of WP 06 to 12 that need the player alone in a maze, or that go on
// after the last hive or snipe is gone, keep the game going instead: each tick is stepped
// from the game as it is, but not marked won, so `step` runs it as before WP 13.
export function playOn(state: GameState, input: InputState): GameState {
  return step({ ...state, cleared: false }, input);
}
