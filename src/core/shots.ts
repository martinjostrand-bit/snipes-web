import { cellAt, wrap, type Grid, type Point } from "./grid";
import { PLAYER_SIZE } from "./player";

// Spec 2.10: a shot covers SHOT_SIZE x SHOT_SIZE cells; its position is the top-left one.
const SHOT_SIZE = 2;

// Spec 2.5: cells a shot moves per tick, faster than any creature (the player moves at most
// one cell every two ticks).
const SHOT_SPEED = 2;

export interface Shot {
  readonly x: number;
  readonly y: number;
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Spec 2.10: a player's shot appears just outside the player's footprint in the firing
// direction: over its middle two columns or rows when fired straight, touching the matching
// corner when fired diagonally. Undefined when no fire key is held or a cell there is a wall.
export function fireShot(
  maze: Grid,
  player: Point,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): Shot | undefined {
  if (dx === 0 && dy === 0) return undefined;
  const at = wrap(maze, {
    x: player.x + spawnOffset(dx),
    y: player.y + spawnOffset(dy),
  });
  return fits(maze, at.x, at.y) ? { ...at, dx, dy } : undefined;
}

function spawnOffset(d: -1 | 0 | 1): number {
  if (d < 0) return -SHOT_SIZE;
  return d > 0 ? PLAYER_SIZE : (PLAYER_SIZE - SHOT_SIZE) / 2;
}

// Spec 2.1, 2.5 and 2.10: moves every shot on by one tick, one cell at a time along its line.
// A shot disappears when its next cell would put its footprint on a wall or squeeze it
// diagonally through a corner gap, and when it enters a cell of a target's footprint; then
// `hits` gets that target's index. Walls are unharmed.
export function moveShots(
  maze: Grid,
  shots: readonly Shot[],
  targets: readonly Box[],
): { shots: Shot[]; hits: number[] } {
  const flying: Shot[] = [];
  const hits: number[] = [];
  for (const shot of shots) {
    let { x, y } = shot;
    let gone = false;
    for (let n = 0; n < SHOT_SPEED && !gone; n++) {
      const next = wrap(maze, { x: x + shot.dx, y: y + shot.dy });
      const blocked =
        !fits(maze, next.x, next.y) ||
        (shot.dx !== 0 &&
          shot.dy !== 0 &&
          !fits(maze, next.x, y) &&
          !fits(maze, x, next.y));
      const hit = targets.findIndex((t) => overlaps(maze, next, t));
      if (!blocked && hit >= 0) hits.push(hit);
      gone = blocked || hit >= 0;
      ({ x, y } = next);
    }
    if (!gone) flying.push({ ...shot, x, y });
  }
  return { shots: flying, hits };
}

// Spec 2.10: a position is open when every cell of the footprint there is open, with wrap-around.
function fits(maze: Grid, x: number, y: number): boolean {
  for (let dy = 0; dy < SHOT_SIZE; dy++) {
    for (let dx = 0; dx < SHOT_SIZE; dx++) {
      if (cellAt(maze, { x: x + dx, y: y + dy }) === "wall") return false;
    }
  }
  return true;
}

// Whether the shot's footprint at `at` shares a cell with the box, with wrap-around.
function overlaps(maze: Grid, at: Point, box: Box): boolean {
  return (
    spans(at.x, box.x, box.width, maze.width) &&
    spans(at.y, box.y, box.height, maze.height)
  );
}

// Whether [a, a + SHOT_SIZE) and [b, b + length) meet on an axis that wraps after `size`.
function spans(a: number, b: number, length: number, size: number): boolean {
  const offset = (((a - b) % size) + size) % size;
  return offset < length || offset > size - SHOT_SIZE;
}
