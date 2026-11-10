import { cellAt, wrap, type Grid, type Point } from "../core/grid";
import type { GameState } from "../core/state";

// Spec 2.1 and 3: the view shows VIEW_COLS x VIEW_ROWS cells of the maze, each CELL_PX square
// canvas pixels. Odd sizes put the player on the exact middle cell.
export const VIEW_COLS = 39;
export const VIEW_ROWS = 21;
export const CELL_PX = 16;

const FLOOR = "#000";
const WALL = "#2850c8";
const PLAYER = "#f0d000";
const LABEL = "#ccc";

// Spec 2.1: the maze cell, wrapped into the grid, drawn at the top-left of a view of
// cols x rows cells centred on `centre`.
export function viewOrigin(
  maze: Grid,
  centre: Point,
  cols: number,
  rows: number,
): Point {
  return wrap(maze, {
    x: centre.x - Math.floor((cols - 1) / 2),
    y: centre.y - Math.floor((rows - 1) / 2),
  });
}

// Spec 3: draws the part of the maze around the player, with the player in the middle.
export function drawGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const { maze, player } = state;
  const origin = viewOrigin(maze, player, VIEW_COLS, VIEW_ROWS);
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, VIEW_COLS * CELL_PX, VIEW_ROWS * CELL_PX);
  ctx.fillStyle = WALL;
  for (let row = 0; row < VIEW_ROWS; row++) {
    for (let col = 0; col < VIEW_COLS; col++) {
      if (cellAt(maze, { x: origin.x + col, y: origin.y + row }) === "wall") {
        ctx.fillRect(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }
  drawPlayer(
    ctx,
    Math.floor((VIEW_COLS - 1) / 2) * CELL_PX,
    Math.floor((VIEW_ROWS - 1) / 2) * CELL_PX,
  );
}

// Our own glyph for the player: a yellow face with two eyes.
function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PLAYER;
  ctx.fillRect(x + 2, y + 2, CELL_PX - 4, CELL_PX - 4);
  ctx.fillStyle = FLOOR;
  ctx.fillRect(x + 5, y + 5, 2, 2);
  ctx.fillRect(x + 9, y + 5, 2, 2);
}

// Spec 5.5 and 9 M0: the title and version stay on screen, in the top-left corner over the
// maze, until the title screen (WP 13) shows them.
export function drawLabel(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.font = "12px monospace";
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, Math.ceil(ctx.measureText(text).width) + 8, CELL_PX);
  ctx.fillStyle = LABEL;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, CELL_PX / 2);
}
