import type { Grid } from "./grid";
import { generateMazeFrom, WALL_X, WALL_Y } from "./maze";
import { movePlayer, type Player } from "./player";
import { createRng, type Rng } from "./rng";

// Spec 2.10: the player starts as near the middle of a block as it can, leaning up-left: its
// footprint 5 open cells from the block's left wall and 3 from its top wall.
const START_X = WALL_X + 1 + 5;
const START_Y = WALL_Y + 1 + 3;

// Spec 2.2 and 2.8: the keys held this tick. y grows downwards, so up is moveY = -1.
export interface InputState {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  /** Space held: move faster. */
  readonly fast: boolean;
}

export const NO_INPUT: InputState = { moveX: 0, moveY: 0, fast: false };

// Spec 4.3: the game state is plain data, created from a seed and changed only by step().
export interface GameState {
  readonly rng: Rng;
  readonly maze: Grid;
  readonly player: Player;
}

export function createGame(seed: number): GameState {
  const [maze, rng] = generateMazeFrom(createRng(seed));
  return { rng, maze, player: { x: START_X, y: START_Y, wait: 0 } };
}

export function step(state: GameState, input: InputState): GameState {
  const player = movePlayer(state.maze, state.player, input);
  return player === state.player ? state : { ...state, player };
}
