import { GHOST_SIZE } from "../core/ghosts";
import { cellAt, wrap, type Grid, type Point } from "../core/grid";
import { HIVE_SIZE, type Hive } from "../core/hives";
import { PLAYER_SIZE } from "../core/player";
import { SHOT_SIZE, type Shot } from "../core/shots";
import { facesRight, SNIPE_H, SNIPE_W, type Snipe } from "../core/snipes";
import type { GameState, Slide } from "../core/state";

// Spec 2.10 and 3: the view shows VIEW_COLS x VIEW_ROWS square cells of the maze, each CELL_PX
// canvas pixels wide and high, below one HUD row of the same height.
export const VIEW_COLS = 80;
export const VIEW_ROWS = 44;
export const CELL_PX = 16;

// The view cell of the player's top-left cell: as many columns left of the footprint as right
// of it, and as many rows above as below.
const PLAYER_COL = (VIEW_COLS - PLAYER_SIZE) / 2;
const PLAYER_ROW = (VIEW_ROWS - PLAYER_SIZE) / 2;

const FLOOR = "#0b0e17";
const WALL = "#3d6ee8";
const HEAD = "#f4c430";
const EYE = "#ffffff";
const PUPIL = "#141824";
const BEAK = "#ff7a1a";
const SNIPE = "#c868f0";
const SPEAR = "#ece4ff";
const GHOST = "#8ee8d0";
// A shot's glow: its white core fades through `glow` to nothing at its edge.
const PLAYER_SHOT = { glow: "#7fe0ff", edge: "rgba(127, 224, 255, 0)" };
const SNIPE_SHOT = { glow: "#ff5a8c", edge: "rgba(255, 90, 140, 0)" };
// Spec 2.3: a hive's colour for 0-4, 5-9, 10-14 and 15-19 hits taken.
const HIVE_STAGES = ["#30d0d0", "#40c040", "#f08c20", "#f03c3c"];
const LABEL = "#ccc";

// Spec 3: the player's eyes close for BLINK_MS every BLINK_EVERY_MS.
const BLINK_EVERY_MS = 4000;
const BLINK_MS = 150;

// Spec 2.1 and 3: the maze cell, wrapped into the grid, drawn at the top-left of the view
// that has the player's footprint in its middle. It may be fractional.
export function viewOrigin(maze: Grid, player: Point): Point {
  return wrap(maze, { x: player.x - PLAYER_COL, y: player.y - PLAYER_ROW });
}

// Spec 3: where the player and each snipe, ghost, player's shot and snipe's shot of `state`
// are drawn, `alpha` (0 to 1) of a tick after `step` made it, in maze cells that may be
// fractional and are not wrapped. A step slides at an even speed from the cell it left,
// arriving when the next step is due; a shot slides from its last position by `alpha`, and
// one fired on this tick is drawn where it is. Edges are crossed the short way.
export function drawnPositions(
  state: GameState,
  alpha: number,
): {
  player: Point;
  snipes: Point[];
  ghosts: Point[];
  shots: Point[];
  snipeShots: Point[];
} {
  const { maze, motion } = state;
  const slid = (at: Point, slide: Slide | undefined): Point => {
    if (slide === undefined) return { x: at.x, y: at.y };
    const progress = Math.min(1, (slide.age + alpha) / slide.ticks);
    const short = (to: number, from: number, size: number): number => {
      const d = (((to - from) % size) + size) % size;
      return from + (d > size / 2 ? d - size : d) * progress;
    };
    return {
      x: short(at.x, slide.from.x, maze.width),
      y: short(at.y, slide.from.y, maze.height),
    };
  };
  const flown =
    (moved: number) =>
    (shot: Shot, i: number): Point => {
      const back = i < moved ? 1 - alpha : 0;
      return { x: shot.x - shot.dx * back, y: shot.y - shot.dy * back };
    };
  return {
    player: slid(state.player, motion.player),
    snipes: state.snipes.map((s, i) => slid(s, motion.snipes[i])),
    ghosts: state.ghosts.map((g, i) => slid(g, motion.ghosts[i])),
    shots: state.shots.map(flown(motion.movedShots)),
    snipeShots: state.snipeShots.map(flown(motion.movedSnipeShots)),
  };
}

// Spec 3: draws the part of the maze around the player's drawn position, below the HUD row,
// with the player in the middle, `alpha` of a tick after `state` (see drawnPositions). One
// maze cell is one square character cell on the canvas. `time` (in ms) makes the eyes blink.
export function drawGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  alpha: number,
  time: number,
): void {
  const { maze } = state;
  const drawn = drawnPositions(state, alpha);
  const origin = viewOrigin(maze, drawn.player);
  ctx.save();
  // Everything is cut at the view's edge, so that nothing covers the HUD row.
  ctx.beginPath();
  ctx.rect(0, CELL_PX, VIEW_COLS * CELL_PX, VIEW_ROWS * CELL_PX);
  ctx.clip();
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, CELL_PX, VIEW_COLS * CELL_PX, VIEW_ROWS * CELL_PX);
  drawWalls(ctx, maze, origin);
  // Draws a footprint of `width` x `height` cells at `p` with `draw`, in its own pixels.
  const place = (
    p: Point,
    width: number,
    height: number,
    draw: () => void,
  ): void => {
    const at = onCanvas(maze, origin, p, width, height);
    if (at === undefined) return;
    ctx.save();
    ctx.translate(at.x, at.y);
    draw();
    ctx.restore();
  };
  for (const hive of state.hives) {
    place(hive, HIVE_SIZE, HIVE_SIZE, () => drawHive(ctx, hive));
  }
  state.snipes.forEach((snipe, i) => {
    place(drawn.snipes[i], SNIPE_W, SNIPE_H, () => drawSnipe(ctx, snipe));
  });
  for (const p of drawn.ghosts) {
    place(p, GHOST_SIZE, GHOST_SIZE, () => drawFace(ctx, 16, GHOST));
  }
  for (const p of drawn.shots) {
    place(p, SHOT_SIZE, SHOT_SIZE, () => drawShot(ctx, PLAYER_SHOT));
  }
  for (const p of drawn.snipeShots) {
    place(p, SHOT_SIZE, SHOT_SIZE, () => drawShot(ctx, SNIPE_SHOT));
  }
  // Spec 2.2: the player is not shown while it is out of play, between death and respawn.
  if (state.respawn === 0) {
    ctx.translate(PLAYER_COL * CELL_PX, (PLAYER_ROW + 1) * CELL_PX);
    drawPlayer(ctx, state.aim, time % BLINK_EVERY_MS < BLINK_MS);
  }
  ctx.restore();
}

// Where a footprint of `width` x `height` cells at `p` is drawn, in canvas pixels, or undefined
// when no part of it is in the view. The view column and row are counted from -width and
// -height, so that a footprint is also drawn when only its right or lower part is in the view.
function onCanvas(
  maze: Grid,
  origin: Point,
  p: Point,
  width: number,
  height: number,
): Point | undefined {
  const at = wrap(maze, {
    x: p.x - origin.x + width,
    y: p.y - origin.y + height,
  });
  if (at.x >= VIEW_COLS + width || at.y >= VIEW_ROWS + height) {
    return undefined;
  }
  return { x: (at.x - width) * CELL_PX, y: (at.y - height + 1) * CELL_PX };
}

// Spec 3: walls are double solid lines, joined to the wall cells next to them. Each line runs
// along the edge of a band through the middle of the wall cells: the band is drawn in the
// wall's colour and its middle in the floor's again, so that corners and crossings join.
function drawWalls(
  ctx: CanvasRenderingContext2D,
  maze: Grid,
  origin: Point,
): void {
  const base = { x: Math.floor(origin.x), y: Math.floor(origin.y) };
  const left = (base.x - origin.x) * CELL_PX;
  const top = (base.y - origin.y + 1) * CELL_PX;
  const wall = (x: number, y: number): boolean =>
    cellAt(maze, { x, y }) === "wall";
  ctx.beginPath();
  // One cell more on every side, for the lines that come into the view from outside it.
  for (let row = -1; row <= VIEW_ROWS; row++) {
    for (let col = -1; col <= VIEW_COLS; col++) {
      const x = base.x + col;
      const y = base.y + row;
      if (!wall(x, y)) continue;
      const cx = left + (col + 0.5) * CELL_PX;
      const cy = top + (row + 0.5) * CELL_PX;
      if (wall(x + 1, y)) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + CELL_PX, cy);
      }
      if (wall(x, y + 1)) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + CELL_PX);
      }
    }
  }
  ctx.lineCap = "square";
  ctx.strokeStyle = WALL;
  ctx.lineWidth = CELL_PX / 2;
  ctx.stroke();
  ctx.strokeStyle = FLOOR;
  ctx.lineWidth = CELL_PX / 4;
  ctx.stroke();
}

function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string | CanvasGradient,
): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fill();
}

// The direction (dx, dy) as a vector of length 1.
function unit(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}

// Spec 3: our own bird head for the player, over its 4 x 4 cells (64 x 64 pixels): two large
// eyes in the top half whose pupils look in the last firing direction `aim`, closed while
// `blink`, and a beak of two triangles pointing apart in the bottom half.
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  aim: Point,
  blink: boolean,
): void {
  disc(ctx, 32, 32, 30, HEAD);
  // Straight ahead before the player has fired.
  const look = aim.x === 0 && aim.y === 0 ? aim : unit(aim.x, aim.y);
  for (const x of [21, 43]) {
    if (blink) {
      ctx.strokeStyle = PUPIL;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - 9, 18);
      ctx.quadraticCurveTo(x, 25, x + 9, 18);
      ctx.stroke();
    } else {
      disc(ctx, x, 19, 10, EYE);
      disc(ctx, x + 4.5 * look.x, 19 + 4.5 * look.y, 4.5, PUPIL);
    }
  }
  ctx.fillStyle = BEAK;
  ctx.beginPath();
  ctx.moveTo(10, 45);
  ctx.lineTo(31, 36);
  ctx.lineTo(31, 54);
  ctx.closePath();
  ctx.moveTo(54, 45);
  ctx.lineTo(33, 36);
  ctx.lineTo(33, 54);
  ctx.closePath();
  ctx.fill();
}

// Spec 2.3: the colour a hive that has taken `hits` hits is drawn in. It changes every 5 hits,
// from cyan through green and orange to red, so the player can see how close it is to
// breaking.
export function hiveColour(hits: number): string {
  return HIVE_STAGES[Math.min(Math.floor(hits / 5), HIVE_STAGES.length - 1)];
}

// Spec 2.3 and 3: our own hive, over its 4 x 4 cells: a rounded frame in the colour of its
// stage around a centre that flashes, bright and dim every 8 ticks.
function drawHive(ctx: CanvasRenderingContext2D, hive: Hive): void {
  const colour = hiveColour(hive.hits);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(6, 6, 52, 52, 8);
  ctx.stroke();
  if (Math.floor(hive.wait / 8) % 2 !== 0) ctx.globalAlpha = 0.35;
  disc(ctx, 32, 32, 12, colour);
}

// Spec 3: a round face with two eyes over 2 x 2 cells (32 x 32 pixels) whose middle is `x`
// pixels from the left: a snipe's face, or a ghost, which has no spear.
function drawFace(
  ctx: CanvasRenderingContext2D,
  x: number,
  colour: string,
): void {
  disc(ctx, x, 16, 13, colour);
  disc(ctx, x - 5, 13, 2.5, FLOOR);
  disc(ctx, x + 5, 13, 2.5, FLOOR);
}

// Spec 2.4 and 3: our own snipe, over its 4 x 2 cells (64 x 32 pixels): a round face on its
// face half and, on its spear half, a spear pointing the way it moves.
function drawSnipe(ctx: CanvasRenderingContext2D, snipe: Snipe): void {
  const [face, spear] = facesRight(snipe) ? [48, 18] : [16, 46];
  drawFace(ctx, face, SNIPE);
  const u = unit(snipe.dx, snipe.dy);
  const tip = { x: spear + 12 * u.x, y: 16 + 12 * u.y };
  ctx.strokeStyle = SPEAR;
  ctx.fillStyle = SPEAR;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(spear - 12 * u.x, 16 - 12 * u.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip.x + 2 * u.x, tip.y + 2 * u.y);
  ctx.lineTo(tip.x - 6 * u.x - 5 * u.y, tip.y - 6 * u.y + 5 * u.x);
  ctx.lineTo(tip.x - 6 * u.x + 5 * u.y, tip.y - 6 * u.y - 5 * u.x);
  ctx.closePath();
  ctx.fill();
}

// Spec 3: a small round glowing shot, over its 2 x 2 cells (32 x 32 pixels).
function drawShot(
  ctx: CanvasRenderingContext2D,
  colours: { glow: string; edge: string },
): void {
  const glow = ctx.createRadialGradient(16, 16, 0, 16, 16, 12);
  glow.addColorStop(0, "#fff");
  glow.addColorStop(0.35, "#fff");
  glow.addColorStop(0.6, colours.glow);
  glow.addColorStop(1, colours.edge);
  disc(ctx, 16, 16, 12, glow);
}

// Spec 3: the HUD, one line of `text` in the row above the view.
export function drawHud(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, VIEW_COLS * CELL_PX, CELL_PX);
  ctx.font = `${CELL_PX}px monospace`;
  ctx.fillStyle = LABEL;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, CELL_PX, CELL_PX / 2);
}

// Spec 3: the title screen, its `lines` in the middle of an empty canvas.
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
): void {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, VIEW_COLS * CELL_PX, (VIEW_ROWS + 1) * CELL_PX);
  drawPanel(ctx, lines);
}

// Spec 3: the paused, won and game-over screens, their `lines` on a panel in the middle of the
// view, over the game as it was.
export function drawPanel(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
): void {
  const lineHeight = 2 * CELL_PX;
  const width = 40 * CELL_PX;
  const height = (lines.length + 1) * lineHeight;
  const left = (VIEW_COLS * CELL_PX - width) / 2;
  const top = ((VIEW_ROWS + 2) * CELL_PX - height) / 2;
  ctx.fillStyle = FLOOR;
  ctx.strokeStyle = WALL;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, CELL_PX / 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = `${CELL_PX}px monospace`;
  ctx.fillStyle = LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, (VIEW_COLS * CELL_PX) / 2, top + (i + 1) * lineHeight);
  });
}
