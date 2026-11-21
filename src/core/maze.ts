import { createGrid, type Grid } from "./grid";
import { createRng, nextFloat, type Rng } from "./rng";

// Spec 2.10: the maze is 16 x 20 blocks of 16 x 12 cells, 256 x 240 cells in all. Each block
// has 15 x 11 open cells and a 1-cell wall on its left and top side where the maze has one.
export const BLOCK_W = 16;
export const BLOCK_H = 12;
const BLOCKS_X = 16;
const BLOCKS_Y = 20;
const WIDTH = BLOCKS_X * BLOCK_W;
const HEIGHT = BLOCKS_Y * BLOCK_H;

// The column of the vertical wall lines and the row of the horizontal ones (modulo BLOCK_W
// and BLOCK_H). Away from 0, so that the maze edges run through the middle of blocks and the
// corridors keep their full size across them (2.10), with nothing to open specially there.
export const WALL_X = 8;
export const WALL_Y = 6;

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

// Spec 2.1 and 2.10: a maze generated from a seed, wrapping at all four edges, in which every
// open cell is reachable from every other. A random depth-first search over the blocks, with
// wrap-around, carves a spanning tree: each step opens the wall segment between two blocks.
// A tree has no cycle, so the four segments around a wall crossing are never all open, and
// the crossings stay walls.
export function generateMaze(seed: number): Grid {
  return generateMazeFrom(createRng(seed))[0];
}

// Spec 4.3: a new game draws its maze from the PRNG in its state, so this also returns the
// PRNG moved past the numbers the maze used.
export function generateMazeFrom(start: Rng): [maze: Grid, next: Rng] {
  // The index of block (bx, by), with wrap-around.
  const block = (bx: number, by: number): number =>
    ((by + BLOCKS_Y) % BLOCKS_Y) * BLOCKS_X + ((bx + BLOCKS_X) % BLOCKS_X);
  // Whether the wall segment on a block's left or top side has been opened.
  const openLeft = new Array<boolean>(BLOCKS_X * BLOCKS_Y).fill(false);
  const openTop = new Array<boolean>(BLOCKS_X * BLOCKS_Y).fill(false);
  const visited = new Set<number>([0]);
  const stack = [{ x: 0, y: 0 }];
  let rng = start;
  while (stack.length > 0) {
    const room = stack[stack.length - 1];
    const moves = DIRECTIONS.filter(
      ([dx, dy]) => !visited.has(block(room.x + dx, room.y + dy)),
    );
    if (moves.length === 0) {
      stack.pop();
      continue;
    }
    let pick: number;
    [pick, rng] = randomInt(rng, moves.length);
    const [dx, dy] = moves[pick];
    const from = block(room.x, room.y);
    const to = block(room.x + dx, room.y + dy);
    // The segment between two blocks is on the left or top side of the right or lower one.
    if (dx !== 0) openLeft[dx > 0 ? to : from] = true;
    if (dy !== 0) openTop[dy > 0 ? to : from] = true;
    visited.add(to);
    stack.push({ x: to % BLOCKS_X, y: Math.floor(to / BLOCKS_X) });
  }

  const maze = createGrid(WIDTH, HEIGHT, ({ x, y }) => {
    // Where the cell is in its block, (0, 0) being the crossing at the block's top-left.
    const col = (x - WALL_X + WIDTH) % WIDTH;
    const row = (y - WALL_Y + HEIGHT) % HEIGHT;
    const onLeft = col % BLOCK_W === 0;
    const onTop = row % BLOCK_H === 0;
    const at = block(Math.floor(col / BLOCK_W), Math.floor(row / BLOCK_H));
    if (onLeft && onTop) return "wall";
    if (onLeft) return openLeft[at] ? "open" : "wall";
    if (onTop) return openTop[at] ? "open" : "wall";
    return "open";
  });
  return [maze, rng];
}

function randomInt(rng: Rng, n: number): [value: number, next: Rng] {
  const [value, next] = nextFloat(rng);
  return [Math.floor(value * n), next];
}
