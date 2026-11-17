import { cellAt, wrap, type Grid, type Point } from "../core/grid";
import { HIVE_SIZE, SNIPE_H, SNIPE_W, type Hive } from "../core/hives";
import { PLAYER_SIZE } from "../core/player";
import { SHOT_SIZE } from "../core/shots";
import type { GameState } from "../core/state";

// Spec 2.10 and 3: the view shows VIEW_COLS x VIEW_ROWS square cells of the maze, each CELL_PX
// canvas pixels wide and high, below one HUD row of the same height.
export const VIEW_COLS = 80;
export const VIEW_ROWS = 44;
export const CELL_PX = 8;

// The view cell of the player's top-left cell: as many columns left of the footprint as right
// of it, and as many rows above as below.
const PLAYER_COL = (VIEW_COLS - PLAYER_SIZE) / 2;
const PLAYER_ROW = (VIEW_ROWS - PLAYER_SIZE) / 2;

const FLOOR = "#000";
const WALL = "#2850c8";
const PLAYER = "#f0d000";
const SHOT = "#f0f0f0";
const GUN = "#e04030";
const SNIPE = "#d070f0";
// Spec 2.3: a hive's colour for 0-4, 5-9, 10-14 and 15-19 hits taken.
const HIVE_STAGES = ["#30d0d0", "#40c040", "#f08c20", "#f03c3c"];
const LABEL = "#ccc";

// Spec 2.1 and 3: the maze cell, wrapped into the grid, drawn at the top-left of the view
// that has the player's footprint in its middle.
export function viewOrigin(maze: Grid, player: Point): Point {
  return wrap(maze, { x: player.x - PLAYER_COL, y: player.y - PLAYER_ROW });
}

// Spec 3: draws the part of the maze around the player, below the HUD row, with the player in
// the middle. One maze cell is one square character cell on the canvas.
export function drawGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  const { maze, player } = state;
  const origin = viewOrigin(maze, player);
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, CELL_PX, VIEW_COLS * CELL_PX, VIEW_ROWS * CELL_PX);
  ctx.fillStyle = WALL;
  for (let row = 0; row < VIEW_ROWS; row++) {
    for (let col = 0; col < VIEW_COLS; col++) {
      const at = { x: origin.x + col, y: origin.y + row };
      if (cellAt(maze, at) === "wall") {
        drawWall(ctx, maze, at, col * CELL_PX, (row + 1) * CELL_PX);
      }
    }
  }
  // Spec 2.10: hives, snipes and shots, cut at the view's edge so that they never cover the
  // HUD row.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, CELL_PX, VIEW_COLS * CELL_PX, VIEW_ROWS * CELL_PX);
  ctx.clip();
  for (const hive of state.hives) {
    const at = onCanvas(maze, origin, hive, HIVE_SIZE, HIVE_SIZE);
    if (at) drawHive(ctx, at.x, at.y, hive);
  }
  for (const snipe of state.snipes) {
    const at = onCanvas(maze, origin, snipe, SNIPE_W, SNIPE_H);
    if (at) drawSnipe(ctx, at.x, at.y);
  }
  for (const shot of state.shots) {
    const at = onCanvas(maze, origin, shot, SHOT_SIZE, SHOT_SIZE);
    if (at) drawShot(ctx, at.x, at.y);
  }
  ctx.restore();
  drawPlayer(ctx, PLAYER_COL * CELL_PX, (PLAYER_ROW + 1) * CELL_PX, state.aim);
}

// Where a footprint of `width` x `height` cells at `p` is drawn, in canvas pixels, or undefined
// when no cell of it is in the view. The view column and row are counted from -(width - 1)
// and -(height - 1), so that a footprint is also drawn when only its right or lower cells
// are in the view.
function onCanvas(
  maze: Grid,
  origin: Point,
  p: Point,
  width: number,
  height: number,
): Point | undefined {
  const at = wrap(maze, {
    x: p.x - origin.x + width - 1,
    y: p.y - origin.y + height - 1,
  });
  if (at.x >= VIEW_COLS + width - 1 || at.y >= VIEW_ROWS + height - 1) {
    return undefined;
  }
  return { x: (at.x - width + 1) * CELL_PX, y: (at.y - height + 2) * CELL_PX };
}

// Spec 3: walls are double solid lines, joined to the wall cells next to them.
function drawWall(
  ctx: CanvasRenderingContext2D,
  maze: Grid,
  at: Point,
  x: number,
  y: number,
): void {
  const wall = (dx: number, dy: number): boolean =>
    cellAt(maze, { x: at.x + dx, y: at.y + dy }) === "wall";
  const left = wall(-1, 0);
  const right = wall(1, 0);
  const up = wall(0, -1);
  const down = wall(0, 1);
  if (left || right) {
    const from = left ? 0 : 2;
    const to = right ? CELL_PX : 6;
    ctx.fillRect(x + from, y + 2, to - from, 1);
    ctx.fillRect(x + from, y + 5, to - from, 1);
  }
  if (up || down) {
    const from = up ? 0 : 2;
    const to = down ? CELL_PX : 6;
    ctx.fillRect(x + 2, y + from, 1, to - from);
    ctx.fillRect(x + 5, y + from, 1, to - from);
  }
}

// Our own glyph for the player, over its 4 x 4 cells: a small spacecraft with swept wings and
// two guns pointing in the last firing direction `aim` (spec 3).
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  aim: Point,
): void {
  ctx.fillStyle = PLAYER;
  ctx.fillRect(x + 13, y + 4, 6, 24); // body
  ctx.fillRect(x + 4, y + 14, 24, 6); // wings
  ctx.fillRect(x + 2, y + 18, 4, 8); // wing tips
  ctx.fillRect(x + 26, y + 18, 4, 8);
  ctx.fillStyle = FLOOR;
  ctx.fillRect(x + 15, y + 8, 2, 4); // cockpit
  // Each gun is three 2 x 2 pixel dots on a line from the middle in the aim direction, 3 pixels
  // to either side of it, ending inside the footprint also when aimed diagonally.
  ctx.fillStyle = GUN;
  for (const side of [-3, 3]) {
    for (const reach of [8, 10, 12]) {
      ctx.fillRect(
        x + 15 + aim.x * reach - aim.y * side,
        y + 15 + aim.y * reach + aim.x * side,
        2,
        2,
      );
    }
  }
}

// Spec 2.3: the colour a hive that has taken `hits` hits is drawn in. It changes every 5 hits,
// from cyan through green and orange to red, so the player can see how close it is to
// breaking.
export function hiveColour(hits: number): string {
  return HIVE_STAGES[Math.min(Math.floor(hits / 5), HIVE_STAGES.length - 1)];
}

// Our own glyph for a hive, over its 4 x 4 cells: a square frame in the colour of its stage
// around a core that flashes, on and off every 8 ticks (spec 2.3).
function drawHive(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hive: Hive,
): void {
  ctx.fillStyle = hiveColour(hive.hits);
  ctx.fillRect(x + 2, y + 2, 28, 3);
  ctx.fillRect(x + 2, y + 27, 28, 3);
  ctx.fillRect(x + 2, y + 5, 3, 22);
  ctx.fillRect(x + 27, y + 5, 3, 22);
  if (Math.floor(hive.wait / 8) % 2 === 0) ctx.fillRect(x + 10, y + 10, 12, 12);
}

// Our own glyph for a snipe, over its 4 x 2 cells: a round head with two eyes and a spear
// pointing right.
function drawSnipe(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = SNIPE;
  ctx.fillRect(x + 4, y + 2, 8, 12); // head
  ctx.fillRect(x + 2, y + 4, 12, 8);
  ctx.fillRect(x + 14, y + 7, 14, 2); // spear
  ctx.fillRect(x + 24, y + 4, 2, 8); // spearhead
  ctx.fillRect(x + 26, y + 5, 2, 6);
  ctx.fillRect(x + 28, y + 6, 2, 4);
  ctx.fillStyle = FLOOR;
  ctx.fillRect(x + 5, y + 6, 2, 2); // eyes
  ctx.fillRect(x + 9, y + 6, 2, 2);
}

// Our own glyph for a shot, over its 2 x 2 cells: a small spark in the shape of a plus.
function drawShot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = SHOT;
  ctx.fillRect(x + 6, y + 3, 4, 10);
  ctx.fillRect(x + 3, y + 6, 10, 4);
}

// Spec 5.5 and 9 M0: the title and version stay in the HUD row until the title screen (WP 13)
// shows them.
export function drawLabel(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, VIEW_COLS * CELL_PX, CELL_PX);
  ctx.font = `${CELL_PX}px monospace`;
  ctx.fillStyle = LABEL;
  ctx.textBaseline = "middle";
  ctx.fillText(text, CELL_PX, CELL_PX / 2);
}
