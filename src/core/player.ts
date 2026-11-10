import { cellAt, wrap, type Grid } from "./grid";
import type { InputState } from "./state";

// Spec 2.2: ticks between two steps of the player, at normal speed and with Space held.
const STEP_TICKS = 4;
const FAST_STEP_TICKS = 2;

export interface Player {
  readonly x: number;
  readonly y: number;
  /** Ticks left before the player may take its next step. */
  readonly wait: number;
}

// Spec 2.1 and 2.2: one cell at a time in 8 directions, faster with Space, blocked by walls,
// wrapping at the edges. Holding a key keeps the player moving; releasing it stops the player.
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

// Spec 2.2: a diagonal takes the first possible of the diagonal step (open, and not between
// two walls that touch at a corner, 2.1), the horizontal step and the vertical step.
// Undefined means the player stays put.
function nextMove(
  maze: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { dx: number; dy: number } | undefined {
  const open = (mx: number, my: number): boolean =>
    cellAt(maze, { x: x + mx, y: y + my }) === "open";
  if (dx === 0 && dy === 0) return undefined;
  if (dx === 0 || dy === 0) return open(dx, dy) ? { dx, dy } : undefined;
  const horizontal = open(dx, 0);
  const vertical = open(0, dy);
  if (open(dx, dy) && (horizontal || vertical)) return { dx, dy };
  if (horizontal) return { dx, dy: 0 };
  if (vertical) return { dx: 0, dy };
  return undefined;
}
