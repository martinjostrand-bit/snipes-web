import type { Grid, Point } from "./grid";
import { generateMazeFrom, WALL_X, WALL_Y } from "./maze";
import { movePlayer, type Player } from "./player";
import { createRng, type Rng } from "./rng";
import { fireShot, moveShots, type Shot } from "./shots";

// Spec 2.10: the player starts as near the middle of a block as it can, leaning up-left: its
// footprint 5 open cells from the block's left wall and 3 from its top wall.
const START_X = WALL_X + 1 + 5;
const START_Y = WALL_Y + 1 + 3;

// Spec 2.5: ticks from one shot to the next while a fire key is held.
const FIRE_TICKS = 13;

// Spec 2.2 and 2.8: the keys held this tick. y grows downwards, so up is moveY = -1 and
// fireY = -1.
export interface InputState {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  /** Space held: move faster. */
  readonly fast: boolean;
  readonly fireX: -1 | 0 | 1;
  readonly fireY: -1 | 0 | 1;
}

export const NO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  fast: false,
  fireX: 0,
  fireY: 0,
};

// Spec 4.3: the game state is plain data, created from a seed and changed only by step().
export interface GameState {
  readonly rng: Rng;
  readonly maze: Grid;
  readonly player: Player;
  /** The shots in flight. */
  readonly shots: readonly Shot[];
  /** Ticks left before the player may fire again. */
  readonly reload: number;
  /** Spec 3: the last firing direction, where the player's guns point; up at the start. */
  readonly aim: Point;
}

export function createGame(seed: number): GameState {
  const [maze, rng] = generateMazeFrom(createRng(seed));
  return {
    rng,
    maze,
    player: { x: START_X, y: START_Y, wait: 0 },
    shots: [],
    reload: 0,
    aim: { x: 0, y: -1 },
  };
}

// Spec 2.2 and 2.5: the shots in flight move on, the player moves, and while a fire key is
// held a new shot appears next to the player, independent of the way it moves, except while
// Space is held. A new shot stays where it appears until the next tick. The guns turn to a
// held fire direction.
export function step(state: GameState, input: InputState): GameState {
  const { maze } = state;
  const aim =
    input.fireX !== 0 || input.fireY !== 0
      ? { x: input.fireX, y: input.fireY }
      : state.aim;
  const player = movePlayer(maze, state.player, input);
  const { shots } = moveShots(maze, state.shots, []);
  const shot =
    state.reload > 0 || input.fast
      ? undefined
      : fireShot(maze, player, input.fireX, input.fireY);
  if (shot === undefined) {
    return {
      ...state,
      player,
      shots,
      reload: Math.max(0, state.reload - 1),
      aim,
    };
  }
  return {
    ...state,
    player,
    shots: [...shots, shot],
    reload: FIRE_TICKS - 1,
    aim,
  };
}
