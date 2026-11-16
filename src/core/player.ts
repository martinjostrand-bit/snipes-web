import { cellAt, wrap, type Grid } from "./grid";
import type { InputState } from "./state";

// Spec 2.2: ticks between two steps of the player, at normal speed and with Space held.
const STEP_TICKS = 3;
const FAST_STEP_TICKS = 2;

// Spec 2.10: the player covers PLAYER_SIZE x PLAYER_SIZE cells; its position is the top-left one.
export const PLAYER_SIZE = 4;

export interface Player {
  readonly x: number;
  readonly y: number;
  /** Ticks left before the player may take its next step. */
  readonly wait: number;
}

// Spec 2.1, 2.2 and 2.10: one cell at a time in 8 directions, faster with Space, blocked by
// walls under any cell of the footprint, wrapping at the edges. Holding a key keeps the player
// moving; releasing it stops the player.
export function movePlayer(
  maze: Grid,
  player: Player,
  input: InputState,
): Player {
  if (player.wait > 0) return { ...player, wait: player.wait - 1 };
  const move = nextMove(maze, player.x, player.y, input.moveX, input.moveY);
  if (!move) return player;
  const to = wrap(maze, { x: player.x + move.dx, y: player.y + move.dy });
  const wait = (input.fast ? FAST_STEP_TICKS : STEP_TICKS) - 1;
  return { ...player, x: to.x, y: to.y, wait };
}

// Spec 2.2 and 2.10: a diagonal takes the first possible of the diagonal step (open, and not
// between two walls that touch at a corner, 2.1), the horizontal step and the vertical step,
// each tested with the whole footprint. Undefined means the player stays put.
function nextMove(
  maze: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { dx: number; dy: number } | undefined {
  const open = (mx: number, my: number): boolean => fits(maze, x + mx, y + my);
  if (dx === 0 && dy === 0) return undefined;
  if (dx === 0 || dy === 0) return open(dx, dy) ? { dx, dy } : undefined;
  const horizontal = open(dx, 0);
  const vertical = open(0, dy);
  if (open(dx, dy) && (horizontal || vertical)) return { dx, dy };
  if (horizontal) return { dx, dy: 0 };
  if (vertical) return { dx: 0, dy };
  return undefined;
}

// Spec 2.10: a position is open when every cell of the footprint there is open, with wrap-around.
function fits(maze: Grid, x: number, y: number): boolean {
  for (let dy = 0; dy < PLAYER_SIZE; dy++) {
    for (let dx = 0; dx < PLAYER_SIZE; dx++) {
      if (cellAt(maze, { x: x + dx, y: y + dy }) === "wall") return false;
    }
  }
  return true;
}
