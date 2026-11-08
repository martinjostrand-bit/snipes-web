import { createRng, type Rng } from "./rng";

// Spec 4.3: the game state is plain data, created from a seed and changed only by step().
// WP 06 gives the input its keys; until then the only input is "no keys held".
export type InputState = Readonly<Record<string, never>>;

export const NO_INPUT: InputState = {};

export interface GameState {
  readonly rng: Rng;
}

export function createGame(seed: number): GameState {
  return { rng: createRng(seed) };
}

// Empty until the game has rules (WP 06 on).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- WP 06 reads the input.
export function step(state: GameState, input: InputState): GameState {
  return state;
}
