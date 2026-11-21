import { cellAt, wrap, type Box, type Grid, type Point } from "./grid";

// Spec 2.10: a shot covers SHOT_SIZE x SHOT_SIZE cells; its position is the top-left one.
export const SHOT_SIZE = 2;

export interface Shot {
  readonly x: number;
  readonly y: number;
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
}

// Spec 2.4 and 2.10: a shot appears just outside the footprint of whoever fires it (the
// player or a snipe), in the firing direction: over the footprint's middle two columns or
// rows when fired straight, touching the matching corner when fired diagonally. Undefined
// when no direction is given or a cell there is a wall.
export function fireShot(
  maze: Grid,
  from: Box,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): Shot | undefined {
  if (dx === 0 && dy === 0) return undefined;
  const at = wrap(maze, {
    x: from.x + spawnOffset(dx, from.width),
    y: from.y + spawnOffset(dy, from.height),
  });
  return fits(maze, at.x, at.y) ? { ...at, dx, dy } : undefined;
}

function spawnOffset(d: -1 | 0 | 1, size: number): number {
  if (d < 0) return -SHOT_SIZE;
  return d > 0 ? size : (size - SHOT_SIZE) / 2;
}

// Spec 2.1, 2.5 and 2.10: moves every shot on by one cell along its line, one tick's flight.
// A shot disappears when that cell would put its footprint on a wall or squeeze it diagonally
// through a corner gap, and when its footprint already covers a cell of a target's footprint
// (a shot fired onto a target) or enters one; then `hits` gets that target's index. Walls are
// unharmed.
export function moveShots(
  maze: Grid,
  shots: readonly Shot[],
  targets: readonly Box[],
): { shots: Shot[]; hits: number[] } {
  const flying: Shot[] = [];
  const hits: number[] = [];
  for (const shot of shots) {
    const { x, y, dx, dy } = shot;
    const struck = targets.findIndex((t) => overlaps(maze, shot, t));
    if (struck >= 0) {
      hits.push(struck);
      continue;
    }
    const next = wrap(maze, { x: x + dx, y: y + dy });
    const blocked =
      !fits(maze, next.x, next.y) ||
      (dx !== 0 &&
        dy !== 0 &&
        !fits(maze, next.x, y) &&
        !fits(maze, x, next.y));
    if (blocked) continue;
    const hit = targets.findIndex((t) => overlaps(maze, next, t));
    if (hit >= 0) hits.push(hit);
    else flying.push({ ...shot, ...next });
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
