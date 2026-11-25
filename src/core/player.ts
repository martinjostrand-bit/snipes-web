import { cellAt, wrap, type Box, type Grid, type Point } from "./grid";
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

export function playerBox(player: Point): Box {
  return { x: player.x, y: player.y, width: PLAYER_SIZE, height: PLAYER_SIZE };
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

// Spec 2.2 and 2.10: with deadly walls on, the player touches a wall when its step is due (a
// direction is held and the wait is over) and the held direction is not a plain step.
export function touchesWall(
  maze: Grid,
  player: Player,
  input: InputState,
): boolean {
  const { moveX: dx, moveY: dy } = input;
  return (
    player.wait === 0 &&
    (dx !== 0 || dy !== 0) &&
    !plainStep(maze, player.x, player.y, dx, dy)
  );
}

// Spec 2.1, 2.2 and 2.10: a straight step whose position is open, or a diagonal whose diagonal
// position is open and that is not through a corner gap, each tested with the whole footprint.
function plainStep(
  maze: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
): boolean {
  const open = (mx: number, my: number): boolean => fits(maze, x + mx, y + my);
  if (!open(dx, dy)) return false;
  return dx === 0 || dy === 0 || open(dx, 0) || open(0, dy);
}

// Spec 2.2 and 2.10: the plain step, or else for a diagonal the horizontal step and then the
// vertical step, each tested with the whole footprint. Undefined means the player stays put.
function nextMove(
  maze: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { dx: number; dy: number } | undefined {
  if (dx === 0 && dy === 0) return undefined;
  if (plainStep(maze, x, y, dx, dy)) return { dx, dy };
  if (dx === 0 || dy === 0) return undefined;
  if (fits(maze, x + dx, y)) return { dx, dy: 0 };
  if (fits(maze, x, y + dy)) return { dx: 0, dy };
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
