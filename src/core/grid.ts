// Spec 2.1: a rectangular grid of cells that wraps around at all four edges.
export type Cell = "open" | "wall";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Grid {
  readonly width: number;
  readonly height: number;
  /** Row-major: the cell at (x, y) is `cells[y * width + x]`. */
  readonly cells: readonly Cell[];
}

export function createGrid(
  width: number,
  height: number,
  cellFor: (p: Point) => Cell,
): Grid {
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`Grid width must be a positive integer: ${width}`);
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new RangeError(`Grid height must be a positive integer: ${height}`);
  }
  const cells: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push(cellFor({ x, y }));
    }
  }
  return { width, height, cells };
}

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

export function wrap(grid: Grid, p: Point): Point {
  return { x: mod(p.x, grid.width), y: mod(p.y, grid.height) };
}

export function cellAt(grid: Grid, p: Point): Cell {
  const { x, y } = wrap(grid, p);
  return grid.cells[y * grid.width + x];
}
