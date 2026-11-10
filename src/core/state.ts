import type { Grid } from "./grid";
import { generateMazeFrom } from "./maze";
import { movePlayer, type Player } from "./player";
import { createRng, type Rng } from "./rng";

// Maze size in cells. Spec 10 leaves the exact size open; it must be even (see maze.ts).
const MAZE_WIDTH = 64;
const MAZE_HEIGHT = 48;

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
  const [maze, rng] = generateMazeFrom(
    createRng(seed),
    MAZE_WIDTH,
    MAZE_HEIGHT,
  );
  // Every open cell is reachable (2.1), so the first one is as good a start as any.
  const start = maze.cells.indexOf("open");
  return {
    rng,
    maze,
    player: {
      x: start % maze.width,
      y: Math.floor(start / maze.width),
      wait: 0,
    },
  };
}

export function step(state: GameState, input: InputState): GameState {
  const player = movePlayer(state.maze, state.player, input);
  return player === state.player ? state : { ...state, player };
}
