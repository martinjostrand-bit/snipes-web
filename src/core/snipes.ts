import { fits, overlaps, wrap, type Box, type Grid, type Point } from "./grid";
import { nextFloat, type Rng } from "./rng";
import { fireShot, type Shot } from "./shots";

// Spec 2.10: a snipe covers SNIPE_W x SNIPE_H cells; its position is its top-left cell.
export const SNIPE_W = 4;
export const SNIPE_H = 2;

type Axis = -1 | 0 | 1;
type Turn = 1 | -1;

// Spec 2.4: the 8 directions clockwise on the screen, from up (y grows downwards). A random
// direction is item floor(v * 8) of this list, and turning one-eighth of a turn in sense
// `turn` moves `turn` places along it.
const DIRECTIONS: readonly (readonly [Axis, Axis])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
// Spec 2.4: a random turning sense is item floor(v * 2) of this list.
const TURNS: readonly Turn[] = [1, -1];

// Spec 2.4: the chances of keeping the current direction and of turning at random.
const KEEP_CHANCE = 3 / 4;
const RANDOM_TURN_CHANCE = 1 / 4;
// Spec 2.4: ticks from a straight step (or staying put) and from a diagonal step to the next.
const STRAIGHT_TICKS = 10;
const DIAGONAL_TICKS = 13;
// Spec 2.4: the largest s at which a snipe fires, and how far off the diagonal |(|dx| - |dy|)|
// may be for a diagonal shot.
const MAX_FIRE_S = 10;
const DIAGONAL_SLACK = 4;

export interface Snipe {
  readonly x: number;
  readonly y: number;
  readonly dx: Axis;
  readonly dy: Axis;
  /** 1 turns clockwise on the screen, -1 anticlockwise. */
  readonly turn: Turn;
  /** Ticks left before the snipe takes its next step. */
  readonly wait: number;
}

export function snipeBox(snipe: Point): Box {
  return { x: snipe.x, y: snipe.y, width: SNIPE_W, height: SNIPE_H };
}

// Spec 2.4: a new snipe at `at` draws its direction, then its turning sense. Its wait runs
// out in the tick it appears, so it takes its first step on the next tick.
export function createSnipe(start: Rng, at: Point): [snipe: Snipe, next: Rng] {
  const [v, rng] = nextFloat(start);
  const [w, next] = nextFloat(rng);
  const [dx, dy] = DIRECTIONS[Math.floor(v * DIRECTIONS.length)];
  const turn = TURNS[Math.floor(w * TURNS.length)];
  return [{ x: at.x, y: at.y, dx, dy, turn, wait: 1 }, next];
}

// Spec 2.4 and 4.3: every snipe whose wait is over steps and may fire, in the order they
// appeared. `hives` block them, and `player` is where the player is after this tick's move.
// Returns the snipes and the shots they fired.
export function stepSnipes(
  maze: Grid,
  start: Rng,
  hives: readonly Box[],
  snipes: readonly Snipe[],
  player: Point,
  accuracy: number,
): { rng: Rng; snipes: Snipe[]; shots: Shot[] } {
  let rng = start;
  const shots: Shot[] = [];
  const next = snipes.map((snipe) => {
    if (snipe.wait > 0) return { ...snipe, wait: snipe.wait - 1 };
    let moved: Snipe;
    let shot: Shot | undefined;
    [moved, rng] = moveSnipe(maze, rng, hives, snipe, player);
    [shot, rng] = aimAndFire(maze, rng, moved, player, accuracy);
    if (shot !== undefined) shots.push(shot);
    return moved;
  });
  return { rng, snipes: next, shots };
}

// Spec 2.4: one step. It keeps its direction on the keep chance if that way is open;
// otherwise it starts from a random direction or the one to the player and turns one-eighth
// at a time in its own sense until a way is open. With none open it stays put.
function moveSnipe(
  maze: Grid,
  start: Rng,
  hives: readonly Box[],
  snipe: Snipe,
  player: Point,
): [snipe: Snipe, next: Rng] {
  const open = (i: number): boolean => canStep(maze, hives, snipe, i);
  let [v, rng] = nextFloat(start);
  let dir = directionIndex(snipe.dx, snipe.dy);
  if (v >= KEEP_CHANCE || !open(dir)) {
    [v, rng] = nextFloat(rng);
    let first: number;
    if (v < RANDOM_TURN_CHANCE) {
      [v, rng] = nextFloat(rng);
      first = Math.floor(v * DIRECTIONS.length);
    } else {
      first = toward(maze, snipe, player).dir;
    }
    let found = false;
    for (let k = 0; k < DIRECTIONS.length && !found; k++) {
      dir = (first + k * snipe.turn + DIRECTIONS.length) % DIRECTIONS.length;
      found = open(dir);
    }
    if (!found) {
      const [dx, dy] = DIRECTIONS[dir];
      return [{ ...snipe, dx, dy, wait: STRAIGHT_TICKS - 1 }, rng];
    }
  }
  const [dx, dy] = DIRECTIONS[dir];
  const to = wrap(maze, { x: snipe.x + dx, y: snipe.y + dy });
  const ticks = dx !== 0 && dy !== 0 ? DIAGONAL_TICKS : STRAIGHT_TICKS;
  return [{ ...snipe, ...to, dx, dy, wait: ticks - 1 }, rng];
}

// Spec 2.1, 2.4 and 2.10: whether the snipe at `from` can step in direction `i`: its
// footprint there covers no wall and no hive cell, and a diagonal step has at least one of
// the two straight positions on the way open too (no corner gaps).
function canStep(
  maze: Grid,
  hives: readonly Box[],
  from: Point,
  i: number,
): boolean {
  const open = (mx: number, my: number): boolean => {
    const box = snipeBox({ x: from.x + mx, y: from.y + my });
    return fits(maze, box) && !hives.some((h) => overlaps(maze, box, h));
  };
  const [dx, dy] = DIRECTIONS[i];
  if (!open(dx, dy)) return false;
  return dx === 0 || dy === 0 || open(dx, 0) || open(0, dy);
}

// Spec 2.4: after its step, a snipe going the way of the player (for a diagonal, nearly on
// it) and near enough fires on the fire chance, 1 / 2^(s + 1). No shot appears where its
// start would cover a wall.
function aimAndFire(
  maze: Grid,
  rng: Rng,
  snipe: Snipe,
  player: Point,
  accuracy: number,
): [shot: Shot | undefined, next: Rng] {
  const { dir, dx, dy } = toward(maze, snipe, player);
  const diagonal = snipe.dx !== 0 && snipe.dy !== 0;
  const aligned =
    dir === directionIndex(snipe.dx, snipe.dy) &&
    (!diagonal || Math.abs(Math.abs(dx) - Math.abs(dy)) < DIAGONAL_SLACK);
  const s = Math.floor((Math.abs(dx) + Math.abs(dy)) / 2 ** (accuracy + 1));
  if (!aligned || s > MAX_FIRE_S) return [undefined, rng];
  const [v, next] = nextFloat(rng);
  if (v >= 1 / 2 ** (s + 1)) return [undefined, next];
  return [fireShot(maze, snipeBox(snipe), snipe.dx, snipe.dy), next];
}

// Spec 2.4: the shortest signed distances from `from` to `to` with wrap-around (exactly half
// the maze counts as positive), and the direction to `to`: straight up or down when less than
// 2 columns off, straight left or right when less than 2 rows off, otherwise diagonal.
function toward(
  maze: Grid,
  from: Point,
  to: Point,
): { dir: number; dx: number; dy: number } {
  const ahead = wrap(maze, { x: to.x - from.x, y: to.y - from.y });
  const dx = ahead.x > maze.width / 2 ? ahead.x - maze.width : ahead.x;
  const dy = ahead.y > maze.height / 2 ? ahead.y - maze.height : ahead.y;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  if (Math.abs(dx) < 2) return { dir: directionIndex(0, sy), dx, dy };
  if (Math.abs(dy) < 2) return { dir: directionIndex(sx, 0), dx, dy };
  return { dir: directionIndex(sx, sy), dx, dy };
}

function directionIndex(dx: number, dy: number): number {
  return DIRECTIONS.findIndex(([x, y]) => x === dx && y === dy);
}
