import type { Cell, Grid } from "./grid";
import { createRng, nextFloat, type Rng } from "./rng";

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

// Spec 2.1: a maze generated from a seed, wrapping at all four edges, in which every open
// cell is reachable from every other. Rooms sit on the cells with even x and even y; the
// cells between them are walls until a passage is carved. A random depth-first search
// over the rooms, with wrap-around, carves a spanning tree, so every room is connected.
// Sizes must be even, so that the edge cell is the wall between the last room and the first.
export function generateMaze(
  seed: number,
  width: number,
  height: number,
): Grid {
  return generateMazeFrom(createRng(seed), width, height)[0];
}

// Spec 4.3: a new game draws its maze from the PRNG in its state, so this also returns the
// PRNG moved past the numbers the maze used.
export function generateMazeFrom(
  start: Rng,
  width: number,
  height: number,
): [maze: Grid, next: Rng] {
  checkSize("width", width);
  checkSize("height", height);
  const cells = new Array<Cell>(width * height).fill("wall");
  const open = (x: number, y: number): void => {
    cells[((y + height) % height) * width + ((x + width) % width)] = "open";
  };
  const roomsX = width / 2;
  const roomsY = height / 2;
  const visited = new Set<number>([0]);
  const stack = [{ x: 0, y: 0 }];
  let rng = start;
  let pick: number;
  open(0, 0);
  while (stack.length > 0) {
    const room = stack[stack.length - 1];
    const moves = DIRECTIONS.filter(
      ([dx, dy]) =>
        !visited.has(
          ((room.y + dy + roomsY) % roomsY) * roomsX +
            ((room.x + dx + roomsX) % roomsX),
        ),
    );
    if (moves.length === 0) {
      stack.pop();
      continue;
    }
    [pick, rng] = randomInt(rng, moves.length);
    const [dx, dy] = moves[pick];
    const next = {
      x: (room.x + dx + roomsX) % roomsX,
      y: (room.y + dy + roomsY) % roomsY,
    };
    open(2 * room.x + dx, 2 * room.y + dy);
    open(2 * next.x, 2 * next.y);
    visited.add(next.y * roomsX + next.x);
    stack.push(next);
  }
  // A spanning tree may never cross an edge, so open one passage across the left and
  // right edges and one across the top and bottom. Extra passages disconnect nothing.
  [pick, rng] = randomInt(rng, roomsY);
  open(width - 1, 2 * pick);
  [pick, rng] = randomInt(rng, roomsX);
  open(2 * pick, height - 1);
  return [{ width, height, cells }, rng];
}

function checkSize(name: string, size: number): void {
  if (!Number.isInteger(size) || size < 2 || size % 2 !== 0) {
    throw new RangeError(
      `Maze ${name} must be a positive even integer: ${size}`,
    );
  }
}

function randomInt(rng: Rng, n: number): [value: number, next: Rng] {
  const [value, next] = nextFloat(rng);
  return [Math.floor(value * n), next];
}
