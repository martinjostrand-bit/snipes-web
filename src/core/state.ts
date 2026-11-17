import type { Grid, Point } from "./grid";
import {
  hitHives,
  hiveBox,
  placeHives,
  spawnSnipes,
  type Hive,
  type Snipe,
} from "./hives";
import { generateMazeFrom, WALL_X, WALL_Y } from "./maze";
import { movePlayer, PLAYER_SIZE, type Player } from "./player";
import { createRng, type Rng } from "./rng";
import { fireShot, moveShots, type Shot } from "./shots";
import { checkSkill, hiveCount, maxEnemies } from "./skill";

// Spec 2.10: the player starts as near the middle of a block as it can, leaning up-left: its
// footprint 5 open cells from the block's left wall and 3 from its top wall.
const START_X = WALL_X + 1 + 5;
const START_Y = WALL_Y + 1 + 3;

// Spec 2.6: the skill level of a game started without one, until the title screen (WP 13)
// lets the player choose.
const DEFAULT_SKILL = "A1";

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
  /** Spec 2.6: the skill level, such as "A1". */
  readonly skill: string;
  readonly rng: Rng;
  readonly maze: Grid;
  readonly player: Player;
  /** The shots in flight. */
  readonly shots: readonly Shot[];
  /** Ticks left before the player may fire again. */
  readonly reload: number;
  /** Spec 3: the last firing direction, where the player's guns point; up at the start. */
  readonly aim: Point;
  /** Spec 2.3: the hives still alive. */
  readonly hives: readonly Hive[];
  /** Spec 2.4: the snipes on the map. */
  readonly snipes: readonly Snipe[];
}

// Spec 2.3 and 2.6: a new game at a skill level such as "A1"; anything other than a letter
// A to Z followed by a digit 1 to 9 is a RangeError.
export function createGame(seed: number, skill = DEFAULT_SKILL): GameState {
  checkSkill(skill);
  const [maze, afterMaze] = generateMazeFrom(createRng(seed));
  const player = { x: START_X, y: START_Y, wait: 0 };
  const [hives, rng] = placeHives(maze, afterMaze, hiveCount(skill), {
    x: player.x,
    y: player.y,
    width: PLAYER_SIZE,
    height: PLAYER_SIZE,
  });
  return {
    skill,
    rng,
    maze,
    player,
    shots: [],
    reload: 0,
    aim: { x: 0, y: -1 },
    hives,
    snipes: [],
  };
}

// Spec 2.2, 2.3 and 2.5: the shots in flight move on, and each one that is on a hive (fired
// onto it) or enters one hits it and disappears. The hives that are due spawn their snipes, the player moves, and while a
// fire key is held a new shot appears next to the player, independent of the way it moves,
// except while Space is held. A new shot stays where it appears until the next tick. The
// guns turn to a held fire direction.
export function step(state: GameState, input: InputState): GameState {
  const { maze } = state;
  const aim =
    input.fireX !== 0 || input.fireY !== 0
      ? { x: input.fireX, y: input.fireY }
      : state.aim;
  const { shots, hits } = moveShots(
    maze,
    state.shots,
    state.hives.map(hiveBox),
  );
  const { rng, hives, snipes } = spawnSnipes(
    maze,
    state.rng,
    hitHives(state.hives, hits),
    state.snipes,
    maxEnemies(state.skill),
  );
  const player = movePlayer(maze, state.player, input);
  const shot =
    state.reload > 0 || input.fast
      ? undefined
      : fireShot(maze, player, input.fireX, input.fireY);
  const next = { ...state, rng, hives, snipes, player, aim };
  if (shot === undefined) {
    return { ...next, shots, reload: Math.max(0, state.reload - 1) };
  }
  return { ...next, shots: [...shots, shot], reload: FIRE_TICKS - 1 };
}
