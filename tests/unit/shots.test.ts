import { describe, expect, it } from "vitest";
import {
  cellAt,
  createGrid,
  wrap,
  type Grid,
  type Point,
} from "../../src/core/grid";
import { moveShots, type Shot } from "../../src/core/shots";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.1, 2.2, 2.5, 2.8, 2.10, 4.3, 6.2 and 9.1 WP 08: bullets.
//
// The fire keys held this tick are `input.fireX` and `input.fireY` (-1, 0 or 1; y grows
// downwards, so up is fireY = -1), next to the movement keys. The shots in flight are
// `state.shots`, each a 2 x 2 footprint whose position (`x`, `y`) is its top-left cell, and
// whose direction is (`dx`, `dy`). A shot appears just outside the player's footprint in the
// firing direction (2.10), travels in a straight line faster than any creature, and
// disappears when it would enter a wall or squeeze diagonally through a corner gap; the wall
// is unharmed.
//
// `moveShots(maze, shots, targets)` moves every shot on by one tick and returns the shots
// still flying and `hits`: for every shot that entered a cell of a target's footprint this
// tick, the index of that target in `targets`. A shot that hits a target disappears. WP 08
// has no enemies yet, so the targets (hives, snipes, ghosts, the player, in later work
// packages) are plain footprints here.
//
// The tests do not assume a speed or fire rate. They hold the fire keys until a shot
// appears and then release them, and allow the shot to move any whole number of cells along
// its line in a tick, as long as it never passes a wall or a target.

type Axis = InputState["moveX"];
type Direction = [name: string, dx: Axis, dy: Axis];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)
const PATIENCE = 60;

const DIRECTIONS: Direction[] = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
  ["up-left", -1, -1],
  ["up-right", 1, -1],
  ["down-left", -1, 1],
  ["down-right", 1, 1],
];
const STRAIGHT = DIRECTIONS.filter(([, dx, dy]) => dx === 0 || dy === 0);
const DIAGONALS = DIRECTIONS.filter(([, dx, dy]) => dx !== 0 && dy !== 0);
const MOVES: Direction[] = [["nowhere", 0, 0], ...DIRECTIONS];

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

// The signed distance from a to b along an axis that wraps after `size`, the short way round.
function delta(a: number, b: number, size: number): number {
  const d = mod(b - a, size);
  return d > size / 2 ? d - size : d;
}

function input(
  moveX: Axis,
  moveY: Axis,
  fireX: Axis,
  fireY: Axis,
  fast = false,
): InputState {
  return { ...NO_INPUT, moveX, moveY, fireX, fireY, fast };
}

function cells(box: Box): Point[] {
  const result: Point[] = [];
  for (let dy = 0; dy < box.height; dy++) {
    for (let dx = 0; dx < box.width; dx++) {
      result.push({ x: box.x + dx, y: box.y + dy });
    }
  }
  return result;
}

function shotBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SHOT, height: SHOT };
}

function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
}

// Whether the footprint has no wall cell, with wrap-around (2.10).
function clear(maze: Grid, box: Box): boolean {
  return cells(box).every((c) => cellAt(maze, c) === "open");
}

function fits(maze: Grid, p: Point): boolean {
  return clear(maze, shotBox(p));
}

// Whether two footprints share a cell, with wrap-around.
function overlaps(maze: Grid, a: Box, b: Box): boolean {
  const keys = new Set(
    cells(a).map((c) => `${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
  return cells(b).some((c) =>
    keys.has(`${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
}

function inside(maze: Grid, { x, y }: Point): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < maze.width &&
    y >= 0 &&
    y < maze.height
  );
}

function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function openExcept(width: number, height: number, walls: Point[]): Grid {
  const keys = new Set(
    walls.map(({ x, y }) => `${mod(x, width)},${mod(y, height)}`),
  );
  return createGrid(width, height, ({ x, y }) =>
    keys.has(`${x},${y}`) ? "wall" : "open",
  );
}

// Spec 2.10: where a player's shot appears, not wrapped. Straight up or down it covers the
// footprint's middle two columns, left or right its middle two rows; diagonally it touches
// the matching corner from outside.
function spawnFor(player: Point, dx: number, dy: number): Point {
  return {
    x: dx < 0 ? player.x - SHOT : dx > 0 ? player.x + PLAYER : player.x + 1,
    y: dy < 0 ? player.y - SHOT : dy > 0 ? player.y + PLAYER : player.y + 1,
  };
}

interface Plan {
  /** Every position the shot may stand on, in order, wrapped into the grid. */
  readonly path: Point[];
  /** The target the shot hits after the last position, or null. */
  readonly hit: number | null;
  /** The shot enters a wall and a target, or two targets, at the same step. */
  readonly ambiguous: boolean;
  /** False if the shot was still flying after `limit` positions. */
  readonly ended: boolean;
}

// Spec 2.1, 2.5 and 2.10, the test's own model: from `start` the shot steps one cell at a time
// along (dx, dy). It stops before a position whose footprint covers a wall, and before a
// diagonal step whose two straight positions both cover a wall (a corner gap). It hits the
// first target whose footprint the next position overlaps.
function plan(
  maze: Grid,
  start: Point,
  dx: number,
  dy: number,
  targets: readonly Box[] = [],
  limit = 2000,
): Plan {
  if (!fits(maze, start)) {
    return { path: [], hit: null, ambiguous: false, ended: true };
  }
  const path = [wrap(maze, start)];
  let p = start;
  while (path.length < limit) {
    const next = { x: p.x + dx, y: p.y + dy };
    const blocked =
      !fits(maze, next) ||
      (dx !== 0 &&
        dy !== 0 &&
        !fits(maze, { x: next.x, y: p.y }) &&
        !fits(maze, { x: p.x, y: next.y }));
    const entered = targets.flatMap((t, i) =>
      overlaps(maze, shotBox(next), t) ? [i] : [],
    );
    if (blocked || entered.length > 0) {
      return {
        path,
        hit: !blocked && entered.length === 1 ? entered[0] : null,
        ambiguous: entered.length > (blocked ? 0 : 1),
        ended: true,
      };
    }
    path.push(wrap(maze, next));
    p = next;
  }
  return { path, hit: null, ambiguous: false, ended: false };
}

// --- Through step(state, input) ------------------------------------------------------------

function place(maze: Grid, at: Point): GameState {
  const game = createGame(1);
  return { ...game, maze, player: { ...game.player, x: at.x, y: at.y } };
}

// Holds the fire keys (and the movement keys, all along) until a shot appears or PATIENCE
// ticks have passed, then releases the fire keys. Returns the state after each of `ticks`
// ticks.
function shoot(
  state: GameState,
  fireX: Axis,
  fireY: Axis,
  ticks: number,
  moveX: Axis = 0,
  moveY: Axis = 0,
  fast = false,
): GameState[] {
  const states: GameState[] = [];
  let current = state;
  let fired = false;
  for (let tick = 0; tick < ticks; tick++) {
    const holding = !fired && tick < PATIENCE;
    current = step(
      current,
      input(moveX, moveY, holding ? fireX : 0, holding ? fireY : 0, fast),
    );
    states.push(current);
    if (current.shots.length > 0) fired = true;
  }
  return states;
}

// The positions of the one shot fired, from the tick it appeared until it disappeared.
function trackOne(states: readonly GameState[]): Point[] {
  const first = states.findIndex((s) => s.shots.length > 0);
  if (first === -1) return [];
  const track: Point[] = [];
  let gone = false;
  for (const [i, s] of states.slice(first).entries()) {
    expect(s.shots.length, `tick ${first + i}`).toBeLessThanOrEqual(1);
    if (s.shots.length === 0) {
      gone = true;
      continue;
    }
    expect(gone, `a shot appeared again at tick ${first + i}`).toBe(false);
    track.push({ x: s.shots[0].x, y: s.shots[0].y });
  }
  return track;
}

// The cells per tick the shot moves through step() in an open field, at most.
let stepSpeed: number | undefined;
function shotSpeed(): number {
  if (stepSpeed !== undefined) return stepSpeed;
  const field = createGrid(301, 301, () => "open");
  let speed = 0;
  for (const [, dx, dy] of DIRECTIONS) {
    const track = trackOne(shoot(place(field, { x: 150, y: 150 }), dx, dy, 30));
    for (let i = 1; i < track.length; i++) {
      speed = Math.max(
        speed,
        Math.abs(delta(track[i - 1].x, track[i].x, field.width)),
        Math.abs(delta(track[i - 1].y, track[i].y, field.height)),
      );
    }
  }
  stepSpeed = speed;
  return speed;
}

// Fires one shot from a player standing at `at` and checks its whole flight against the plan:
// it appears where 2.10 says, stays on its line, never covers a wall, goes all the way to the
// last open position before the wall (it may skip cells within a tick, never the wall) and then
// disappears, leaving the wall unharmed.
function checkFlight(maze: Grid, at: Point, fireX: Axis, fireY: Axis): Plan {
  const expected = plan(maze, spawnFor(at, fireX, fireY), fireX, fireY);
  expect(expected.ended, "the test's flight never ends").toBe(true);
  const states = shoot(
    place(maze, at),
    fireX,
    fireY,
    PATIENCE + 3 * expected.path.length + 10,
  );

  for (const [tick, s] of states.entries()) {
    for (const shot of s.shots) {
      expect(inside(maze, shot), `tick ${tick}: ${shot.x},${shot.y}`).toBe(
        true,
      );
      expect(fits(maze, shot), `tick ${tick}: shot on a wall`).toBe(true);
    }
  }
  const track = trackOne(states);
  const last = states[states.length - 1];
  expect(last.maze).toEqual(maze);
  if (expected.path.length === 0) {
    expect(track).toEqual([]);
    return expected;
  }

  expect(track[0]).toEqual(expected.path[0]);
  const steps = track.map((p) => expected.path.findIndex((q) => same(p, q)));
  expect(steps, `track ${JSON.stringify(track)}`).not.toContain(-1);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
  }
  expect(steps[steps.length - 1]).toBeGreaterThanOrEqual(
    expected.path.length - Math.max(1, shotSpeed()),
  );
  expect(last.shots).toEqual([]);
  return expected;
}

// --- Through moveShots(maze, shots, targets) ----------------------------------------------

function shotAt(p: Point, dx: Axis, dy: Axis): Shot {
  return { x: p.x, y: p.y, dx, dy };
}

interface Flight {
  readonly path: Point[];
  readonly hits: number[];
  readonly ended: boolean;
}

// Moves one shot tick by tick until it disappears. The first position is the start.
function fly(
  maze: Grid,
  shot: Shot,
  targets: readonly Box[],
  maxTicks = 2000,
): Flight {
  const path: Point[] = [{ x: shot.x, y: shot.y }];
  const hits: number[] = [];
  let shots: readonly Shot[] = [shot];
  for (let tick = 0; tick < maxTicks; tick++) {
    const result = moveShots(maze, shots, targets);
    expect(result.shots.length).toBeLessThanOrEqual(1);
    hits.push(...result.hits);
    if (result.hits.length > 0) {
      expect(result.shots, "a shot that hits disappears").toEqual([]);
    }
    if (result.shots.length === 0) return { path, hits, ended: true };
    shots = result.shots;
    path.push({ x: result.shots[0].x, y: result.shots[0].y });
  }
  return { path, hits, ended: false };
}

// The cells per tick moveShots moves a shot in an open field, at most.
let movedSpeed: number | undefined;
function moveSpeed(): number {
  if (movedSpeed !== undefined) return movedSpeed;
  const field = createGrid(301, 301, () => "open");
  let speed = 0;
  for (const [, dx, dy] of DIRECTIONS) {
    let shots: readonly Shot[] = [shotAt({ x: 150, y: 150 }, dx, dy)];
    for (let tick = 0; tick < 20 && shots.length === 1; tick++) {
      const next = moveShots(field, shots, []).shots;
      if (next.length !== 1) break;
      speed = Math.max(
        speed,
        Math.abs(delta(shots[0].x, next[0].x, field.width)),
        Math.abs(delta(shots[0].y, next[0].y, field.height)),
      );
      shots = next;
    }
  }
  movedSpeed = speed;
  return speed;
}

// Moves one shot with moveShots and checks the flight against the plan: it stays on its
// line, never covers a wall or a target, goes up to the last position before the wall or
// target, and hits exactly the target the plan says.
function checkShot(maze: Grid, shot: Shot, targets: readonly Box[]): Plan {
  const expected = plan(maze, shot, shot.dx, shot.dy, targets);
  expect(expected.ended, "the test's flight never ends").toBe(true);
  expect(expected.ambiguous, "the test's flight is ambiguous").toBe(false);
  const flight = fly(maze, shot, targets, 3 * expected.path.length + 10);

  expect(flight.ended).toBe(true);
  expect(flight.hits).toEqual(expected.hit === null ? [] : [expected.hit]);
  for (const p of flight.path) {
    expect(fits(maze, p), `shot on a wall at ${p.x},${p.y}`).toBe(true);
    for (const t of targets) {
      expect(overlaps(maze, shotBox(p), t), `${p.x},${p.y} in a target`).toBe(
        false,
      );
    }
  }
  const steps = flight.path.map((p) =>
    expected.path.findIndex((q) => same(wrap(maze, p), q)),
  );
  expect(steps, `path ${JSON.stringify(flight.path)}`).not.toContain(-1);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
  }
  expect(steps[steps.length - 1]).toBeGreaterThanOrEqual(
    expected.path.length - Math.max(1, moveSpeed()),
  );
  return expected;
}

// A square room whose walls are its top row and left column; the grid wraps, so they are also
// its bottom and right walls. Every line a shot can fly along ends at a wall.
const room = createGrid(40, 40, ({ x, y }) =>
  x === 0 || y === 0 ? "wall" : "open",
);

// ===========================================================================================

describe("4.3 GameState: shots", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "a new game has no shots (seed %d)",
    (seed) => {
      expect(createGame(seed).shots).toEqual([]);
    },
  );

  it("fires nothing while no fire key is held", () => {
    const field = createGrid(151, 151, () => "open");
    for (const [, dx, dy] of MOVES) {
      for (const fast of [false, true]) {
        let state = place(field, { x: 75, y: 75 });
        for (let tick = 0; tick < 3 * PATIENCE; tick++) {
          state = step(state, input(dx, dy, 0, 0, fast));
          expect(state.shots).toEqual([]);
        }
      }
    }
  });

  it("fires nothing in a generated maze while only moving", () => {
    let state = createGame(17);
    for (let tick = 0; tick < 4 * PATIENCE; tick++) {
      const [, dx, dy] = DIRECTIONS[Math.floor(tick / 15) % DIRECTIONS.length];
      state = step(state, input(dx, dy, 0, 0, tick % 2 === 0));
      expect(state.shots).toEqual([]);
    }
  });
});

describe("2.10 Sizes: a player's shot appears just outside its footprint", () => {
  const field = createGrid(151, 151, () => "open");
  const player = { x: 75, y: 75 };
  // The player covers x and y 75 to 78; the shot covers 2 x 2 cells from its position.
  const SPAWNS: [name: string, dx: Axis, dy: Axis, at: Point][] = [
    ["up", 0, -1, { x: 76, y: 73 }],
    ["down", 0, 1, { x: 76, y: 79 }],
    ["left", -1, 0, { x: 73, y: 76 }],
    ["right", 1, 0, { x: 79, y: 76 }],
    ["up-left", -1, -1, { x: 73, y: 73 }],
    ["up-right", 1, -1, { x: 79, y: 73 }],
    ["down-left", -1, 1, { x: 73, y: 79 }],
    ["down-right", 1, 1, { x: 79, y: 79 }],
  ];

  it.each(SPAWNS)("fired %s, it appears at %j", (_name, dx, dy, at) => {
    const track = trackOne(shoot(place(field, player), dx, dy, PATIENCE + 5));
    expect(track.length).toBeGreaterThan(0);
    expect(track[0]).toEqual(at);
    // Just outside: next to the player's footprint, never on it.
    expect(overlaps(field, shotBox(at), playerBox(player))).toBe(false);
  });

  it.each(SPAWNS)("fired %s, it appears once per press", (_name, dx, dy) => {
    const states = shoot(place(field, player), dx, dy, PATIENCE + 5);
    const first = states.findIndex((s) => s.shots.length > 0);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(states[first].shots).toHaveLength(1);
    expect(states[first].shots[0]).toMatchObject({ dx, dy });
  });

  // The grid wraps, so a shot fired over an edge appears on the other side (2.1).
  const W = 13;
  const H = 11;
  const small = createGrid(W, H, () => "open");
  const EDGES: [name: string, player: Point, dx: Axis, dy: Axis, at: Point][] =
    [
      ["up over the top edge", { x: 4, y: 0 }, 0, -1, { x: 5, y: H - 2 }],
      ["left over the left edge", { x: 0, y: 3 }, -1, 0, { x: W - 2, y: 4 }],
      ["right over the right edge", { x: W - 4, y: 3 }, 1, 0, { x: 0, y: 4 }],
      ["down over the bottom edge", { x: 4, y: H - 4 }, 0, 1, { x: 5, y: 0 }],
      ["up-left over a corner", { x: 0, y: 0 }, -1, -1, { x: W - 2, y: H - 2 }],
      [
        "down-right over a corner",
        { x: W - 4, y: H - 4 },
        1,
        1,
        { x: 0, y: 0 },
      ],
      [
        "up-right half over an edge",
        { x: W - 5, y: 1 },
        1,
        -1,
        { x: W - 1, y: H - 1 },
      ],
    ];

  it.each(EDGES)("fired %s, it appears wrapped", (_name, at, dx, dy, spawn) => {
    const track = trackOne(shoot(place(small, at), dx, dy, PATIENCE + 1));
    expect(track.length).toBeGreaterThan(0);
    expect(track[0]).toEqual(spawn);
  });

  // A single wall cell on or around the player's footprint: the shot appears unless the wall
  // is on a cell of the 2 x 2 position where it would appear (it would be on a wall, 6.2).
  // The cells beside that position, such as the corner columns above the footprint for a
  // shot fired up, do not stop it.
  const near = { x: 13, y: 13 };
  const ring: Point[] = [];
  for (let y = near.y - SHOT; y < near.y + PLAYER + SHOT; y++) {
    for (let x = near.x - SHOT; x < near.x + PLAYER + SHOT; x++) {
      if (!overlaps(field, playerBox(near), { x, y, width: 1, height: 1 })) {
        ring.push({ x, y });
      }
    }
  }

  it.each(DIRECTIONS)(
    "fired %s, it appears unless a wall is where it would appear",
    (_name, dx, dy) => {
      const spawn = spawnFor(near, dx, dy);
      expect(ring).toHaveLength(8 * 8 - PLAYER * PLAYER);
      for (const wall of ring) {
        const maze = openExcept(31, 31, [wall]);
        const states = shoot(place(maze, near), dx, dy, PATIENCE + 1);
        const track = trackOne(states);
        const blocked = overlaps(maze, shotBox(spawn), {
          ...wall,
          width: 1,
          height: 1,
        });
        const where = `wall at ${wall.x},${wall.y}`;
        if (blocked) {
          expect(track, where).toEqual([]);
        } else {
          expect(track.length, where).toBeGreaterThan(0);
          expect(track[0], where).toEqual(spawn);
        }
        expect(states[states.length - 1].maze, where).toEqual(maze);
      }
    },
  );
});

describe("2.5 Bullets: a bullet stops at the first wall", () => {
  // One block of the maze (2.10): 16 x 12 cells with a wall on its left and top side, which
  // the wrapping grid also makes its right and bottom side. The player stands at (6, 4).
  const block = createGrid(16, 12, ({ x, y }) =>
    x === 0 || y === 0 ? "wall" : "open",
  );
  const start = { x: 6, y: 4 };
  const LAST: Record<string, Point> = {
    up: { x: 7, y: 1 },
    down: { x: 7, y: 10 },
    left: { x: 1, y: 5 },
    right: { x: 14, y: 5 },
    "up-left": { x: 3, y: 1 },
    "up-right": { x: 11, y: 1 },
    "down-left": { x: 2, y: 10 },
    "down-right": { x: 12, y: 10 },
  };

  it.each(DIRECTIONS)(
    "fired %s inside a block, it flies to the wall and disappears",
    (name, dx, dy) => {
      const expected = checkFlight(block, start, dx, dy);
      expect(expected.path[expected.path.length - 1]).toEqual(LAST[name]);
    },
  );

  // A wall line one cell thick across the shot's way, 0 to 12 open cells beyond the place
  // where the shot appears. However fast the shot is, it never jumps over the wall. A
  // diagonal shot whose way is blocked stops: it does not slide along the wall (2.5).
  const player = { x: 20, y: 20 };
  const distances = Array.from({ length: 13 }, (_, g) => g);

  it.each(DIRECTIONS)(
    "fired %s at a thin wall across its way, it stops before the wall",
    (_name, dx, dy) => {
      const spawn = spawnFor(player, dx, dy);
      for (const g of distances) {
        if (dx !== 0) {
          const column = dx > 0 ? spawn.x + SHOT + g : spawn.x - 1 - g;
          const maze = createGrid(64, 64, ({ x }) =>
            x === column ? "wall" : "open",
          );
          const expected = checkFlight(maze, player, dx, dy);
          expect(expected.path).toHaveLength(g + 1);
        }
        if (dy !== 0) {
          const row = dy > 0 ? spawn.y + SHOT + g : spawn.y - 1 - g;
          const maze = createGrid(64, 64, ({ y }) =>
            y === row ? "wall" : "open",
          );
          const expected = checkFlight(maze, player, dx, dy);
          expect(expected.path).toHaveLength(g + 1);
        }
      }
    },
  );

  it.each(STRAIGHT)(
    "fired %s at a single wall cell in its way, it stops before that cell",
    (_name, dx, dy) => {
      // A wall cell 5 cells beyond the spawn, in line with either of the shot's two cells.
      const spawn = spawnFor(player, dx, dy);
      for (const side of [0, 1]) {
        const wall = {
          x:
            dx !== 0
              ? dx > 0
                ? spawn.x + SHOT + 5
                : spawn.x - 6
              : spawn.x + side,
          y:
            dy !== 0
              ? dy > 0
                ? spawn.y + SHOT + 5
                : spawn.y - 6
              : spawn.y + side,
        };
        const expected = checkFlight(
          openExcept(64, 64, [wall]),
          player,
          dx,
          dy,
        );
        expect(expected.path).toHaveLength(6);
      }
    },
  );

  it.each(STRAIGHT)(
    "fired %s past a single wall cell just beside its way, it flies on",
    (_name, dx, dy) => {
      const spawn = spawnFor(player, dx, dy);
      for (const side of [-1, SHOT]) {
        const wall = {
          x:
            dx !== 0
              ? dx > 0
                ? spawn.x + SHOT + 5
                : spawn.x - 6
              : spawn.x + side,
          y:
            dy !== 0
              ? dy > 0
                ? spawn.y + SHOT + 5
                : spawn.y - 6
              : spawn.y + side,
        };
        // A wall line further on ends the flight.
        const maze = createGrid(64, 64, (p) =>
          same(p, wall) ||
          (dx !== 0 && p.x === mod(spawn.x + 20 * dx, 64)) ||
          (dy !== 0 && p.y === mod(spawn.y + 20 * dy, 64))
            ? "wall"
            : "open",
        );
        const expected = checkFlight(maze, player, dx, dy);
        expect(expected.path.length).toBeGreaterThan(6);
      }
    },
  );

  // A corridor as high as the player, 296 cells long: there is no limit to how far a shot
  // flies before it reaches a wall.
  const corridor = createGrid(300, 6, ({ x, y }) =>
    y >= 1 && y <= PLAYER && x >= 1 && x <= 298 ? "open" : "wall",
  );

  it("flies the whole length of a long corridor to the wall at its end", () => {
    const right = checkFlight(corridor, { x: 1, y: 1 }, 1, 0);
    expect(right.path[right.path.length - 1]).toEqual({ x: 297, y: 2 });
    const left = checkFlight(corridor, { x: 295, y: 1 }, -1, 0);
    expect(left.path[left.path.length - 1]).toEqual({ x: 1, y: 2 });
  });

  it.each(DIRECTIONS.filter(([, , dy]) => dy !== 0))(
    "fired %s into a wall right next to the player, no shot appears",
    (_name, dx, dy) => {
      // The corridor is exactly as high as the player, so up and down are walls at once.
      const expected = checkFlight(corridor, { x: 100, y: 1 }, dx, dy);
      expect(expected.path).toEqual([]);
    },
  );

  // A wall line across the grid and a shot that crosses one or two edges on its way to it.
  const crossing = createGrid(40, 40, ({ x, y }) =>
    x === 20 || y === 20 ? "wall" : "open",
  );
  const EDGE_FLIGHTS: [
    name: string,
    player: Point,
    dx: Axis,
    dy: Axis,
    last: Point,
  ][] = [
    ["right over the right edge", { x: 24, y: 4 }, 1, 0, { x: 18, y: 5 }],
    ["left over the left edge", { x: 2, y: 4 }, -1, 0, { x: 21, y: 5 }],
    ["down over the bottom edge", { x: 4, y: 24 }, 0, 1, { x: 5, y: 18 }],
    ["up over the top edge", { x: 4, y: 2 }, 0, -1, { x: 5, y: 21 }],
    ["down-right over a corner", { x: 34, y: 34 }, 1, 1, { x: 18, y: 18 }],
    ["up-left over a corner", { x: 2, y: 2 }, -1, -1, { x: 21, y: 21 }],
  ];

  it.each(EDGE_FLIGHTS)(
    "fired %s, it wraps and stops at the wall",
    (_name, at, dx, dy, last) => {
      const expected = checkFlight(crossing, at, dx, dy);
      expect(expected.path[expected.path.length - 1]).toEqual(last);
    },
  );

  // 9 M2: a bullet fired along a corridor of a generated maze stops at the first wall.
  it.each([1, 2, 3, 42, 7919, 123456789])(
    "fired in each direction from the start of a generated maze (seed %d)",
    (seed) => {
      const game = createGame(seed);
      const at = { x: game.player.x, y: game.player.y };
      for (const [, dx, dy] of DIRECTIONS) {
        const expected = checkFlight(game.maze, at, dx, dy);
        expect(expected.path.length).toBeGreaterThan(0);
      }
    },
  );
});

describe("2.1 Maze / 2.10 Sizes: a diagonal shot stops at a corner gap", () => {
  // From the place where the shot appears, after g diagonal steps the next diagonal position
  // is open, but a wall cell shuts the horizontal position and another the vertical one.
  function gapWalls(spawn: Point, dx: number, dy: number, g: number) {
    const p = { x: spawn.x + g * dx, y: spawn.y + g * dy };
    return {
      horizontal: {
        x: dx > 0 ? p.x + SHOT : p.x - 1,
        y: dy > 0 ? p.y : p.y + 1,
      },
      vertical: { x: dx > 0 ? p.x : p.x + 1, y: dy > 0 ? p.y + SHOT : p.y - 1 },
    };
  }
  const player = { x: 20, y: 20 };

  it.each(DIAGONALS)(
    "fired %s, it disappears at a corner gap and the walls are unharmed",
    (_name, dx, dy) => {
      const spawn = spawnFor(player, dx, dy);
      for (let g = 0; g <= 6; g++) {
        const { horizontal, vertical } = gapWalls(spawn, dx, dy, g);
        const maze = openExcept(64, 64, [horizontal, vertical]);
        const expected = checkFlight(maze, player, dx, dy);
        // The test's own check: the diagonal position beyond is open, so only the gap stops it.
        expect(
          fits(maze, { x: spawn.x + (g + 1) * dx, y: spawn.y + (g + 1) * dy }),
        ).toBe(true);
        expect(expected.path).toHaveLength(g + 1);
      }
    },
  );

  it.each(DIAGONALS)(
    "fired %s, it passes where only one of the two straight positions is shut",
    (_name, dx, dy) => {
      const spawn = spawnFor(player, dx, dy);
      for (let g = 0; g <= 6; g++) {
        const { horizontal, vertical } = gapWalls(spawn, dx, dy, g);
        for (const wall of [horizontal, vertical]) {
          // A wall line further on ends the flight.
          const end = mod(spawn.x + 20 * dx, 64);
          const maze = createGrid(64, 64, (p) =>
            same(p, wall) || p.x === end ? "wall" : "open",
          );
          const expected = checkFlight(maze, player, dx, dy);
          expect(expected.path.length).toBeGreaterThan(g + 1);
        }
      }
    },
  );
});

describe("2.2 Player / 2.5 Bullets: movement and shooting are independent", () => {
  const field = createGrid(301, 301, () => "open");
  const centre = { x: 150, y: 150 };

  it.each(MOVES)(
    "moving %s, the player takes the same path whether or not a fire key is held",
    (_name, mx, my) => {
      for (const fast of [false, true]) {
        for (const [, fx, fy] of DIRECTIONS) {
          let firing = place(field, centre);
          let still = firing;
          for (let tick = 0; tick < PATIENCE; tick++) {
            firing = step(firing, input(mx, my, fx, fy, fast));
            still = step(still, input(mx, my, 0, 0, fast));
            expect({ x: firing.player.x, y: firing.player.y }).toEqual({
              x: still.player.x,
              y: still.player.y,
            });
          }
        }
      }
    },
  );

  it.each(MOVES)(
    "moving %s, a shot flies the way it was fired, as it would standing still",
    (_name, mx, my) => {
      for (const [fireName, fx, fy] of DIRECTIONS) {
        const standing = trackOne(shoot(place(field, centre), fx, fy, 30));
        const states = shoot(place(field, centre), fx, fy, 30, mx, my);
        const moving = trackOne(states);
        expect(moving.length, fireName).toBeGreaterThan(1);

        // It appears just outside the player's footprint, before or after this tick's step.
        const first = states.findIndex((s) => s.shots.length > 0);
        const before = first === 0 ? centre : states[first - 1].player;
        const after = states[first].player;
        expect(
          [spawnFor(before, fx, fy), spawnFor(after, fx, fy)].map((p) =>
            wrap(field, p),
          ),
          fireName,
        ).toContainEqual(moving[0]);

        // From there it flies exactly as a shot fired standing still.
        const relative = (track: Point[]): Point[] =>
          track.map((p) => ({
            x: delta(track[0].x, p.x, field.width),
            y: delta(track[0].y, p.y, field.height),
          }));
        expect(relative(moving), fireName).toEqual(relative(standing));
      }
    },
  );

  it("can fire one way while moving the opposite way", () => {
    const states = shoot(place(field, centre), -1, 0, 30, 1, 0);
    const track = trackOne(states);
    const end = states[states.length - 1];
    expect(end.player.x).toBeGreaterThan(centre.x);
    expect(track[track.length - 1].x).toBeLessThan(centre.x);
  });
});

describe("2.5 Bullets: travel in a straight line, faster than any creature", () => {
  const field = createGrid(301, 301, () => "open");
  const centre = { x: 150, y: 150 };
  const TICKS = 20;

  it.each(DIRECTIONS)("fired %s, it keeps to its line", (_name, dx, dy) => {
    const track = trackOne(
      shoot(place(field, centre), dx, dy, TICKS + PATIENCE),
    );
    expect(track.length).toBeGreaterThan(TICKS);
    let travelled = 0;
    for (let i = 1; i < track.length; i++) {
      const stepX = delta(track[i - 1].x, track[i].x, field.width);
      const stepY = delta(track[i - 1].y, track[i].y, field.height);
      const cellsThisTick = Math.max(Math.abs(stepX), Math.abs(stepY));
      // Each tick it moves along (dx, dy) by a whole number of cells, never back or aside.
      expect({ x: stepX, y: stepY }).toEqual({
        x: cellsThisTick * dx,
        y: cellsThisTick * dy,
      });
      travelled += cellsThisTick;
    }
    expect(travelled).toBeGreaterThan(TICKS);
  });

  it.each(DIRECTIONS)(
    "fired %s, it covers more cells than the player moving fast in the same time",
    (_name, dx, dy) => {
      const states = shoot(place(field, centre), dx, dy, PATIENCE + TICKS);
      const first = states.findIndex((s) => s.shots.length > 0);
      const track = trackOne(states).slice(0, TICKS + 1);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(track).toHaveLength(TICKS + 1);
      const shotCells = Math.max(
        Math.abs(delta(track[0].x, track[TICKS].x, field.width)),
        Math.abs(delta(track[0].y, track[TICKS].y, field.height)),
      );

      let runner = place(field, centre);
      for (let tick = 0; tick < TICKS; tick++) {
        runner = step(runner, input(dx, dy, 0, 0, true));
      }
      const playerCells = Math.max(
        Math.abs(runner.player.x - centre.x),
        Math.abs(runner.player.y - centre.y),
      );
      expect(playerCells).toBeGreaterThan(0);
      expect(shotCells).toBeGreaterThan(playerCells);
    },
  );
});

describe("4.3 step(state, input) with shots", () => {
  const field = createGrid(151, 151, () => "open");

  // A state with a shot in flight in a generated maze, the player moving and firing.
  function busy(): GameState {
    let state = createGame(29);
    for (let tick = 0; tick < 40; tick++) {
      const [, fx, fy] = DIRECTIONS[tick % DIRECTIONS.length];
      state = step(state, input(1, 0, fx, fy));
    }
    return state;
  }

  it("does not change the state it is given while shots fly", () => {
    const state = shoot(place(field, { x: 75, y: 75 }), 1, 1, PATIENCE).find(
      (s) => s.shots.length > 0,
    );
    if (state === undefined) throw new Error("No shot was fired");
    const before = structuredClone(state);
    for (const [, dx, dy] of DIRECTIONS) {
      step(state, input(dx, dy, dx, dy, true));
    }
    expect(state).toEqual(before);
  });

  it("does not change the input it is given", () => {
    const fire = input(1, -1, -1, 1, true);
    const before = structuredClone(fire);
    step(busy(), fire);
    expect(fire).toEqual(before);
  });

  it("gives the same next state for the same state and input", () => {
    const state = busy();
    expect(step(state, input(0, 1, 1, 0))).toEqual(
      step(structuredClone(state), input(0, 1, 1, 0)),
    );
  });

  it("keeps the shots plain data that can be copied", () => {
    const state = busy();
    expect(structuredClone(state)).toEqual(state);
  });

  it("keeps the maze unchanged while shots hit its walls", () => {
    const game = createGame(4);
    let state = game;
    for (let tick = 0; tick < 20 * PATIENCE; tick++) {
      const [, mx, my] = DIRECTIONS[Math.floor(tick / 30) % DIRECTIONS.length];
      const [, fx, fy] = DIRECTIONS[Math.floor(tick / 7) % DIRECTIONS.length];
      state = step(state, input(mx, my, fx, fy, tick % 3 === 0));
    }
    expect(state.maze).toEqual(game.maze);
  });
});

describe("2.5 Bullets: moveShots stops shots at walls and corner gaps", () => {
  it("returns no shots and no hits for no shots", () => {
    expect(moveShots(room, [], [])).toEqual({ shots: [], hits: [] });
    expect(moveShots(room, [], [{ x: 5, y: 5, width: 4, height: 4 }])).toEqual({
      shots: [],
      hits: [],
    });
  });

  it.each(DIRECTIONS)(
    "a shot flying %s in a room stops at its wall",
    (_name, dx, dy) => {
      for (const start of [
        { x: 19, y: 19 },
        { x: 1, y: 1 },
        { x: 37, y: 37 },
        { x: 5, y: 30 },
      ]) {
        checkShot(room, shotAt(start, dx, dy), []);
      }
    },
  );

  it.each(DIAGONALS)(
    "a shot flying %s stops at a corner gap, also across the edges",
    (_name, dx, dy) => {
      // Two 2 x 2 holes in the walls that overlap diagonally: between them both straight
      // positions cover a wall. The second set puts the gap across both edges.
      const W = 12;
      const H = 11;
      for (const a of [
        { x: 4, y: 4 },
        { x: dx > 0 ? W - 1 : 0, y: dy > 0 ? H - 1 : 0 },
      ]) {
        const b = { x: a.x + dx, y: a.y + dy };
        const holes = [...cells(shotBox(a)), ...cells(shotBox(b))];
        const keys = new Set(holes.map((c) => `${mod(c.x, W)},${mod(c.y, H)}`));
        const maze = createGrid(W, H, ({ x, y }) =>
          keys.has(`${x},${y}`) ? "open" : "wall",
        );
        expect(fits(maze, b)).toBe(true);
        const flight = fly(maze, shotAt(a, dx, dy), []);
        expect(flight).toEqual({ path: [a], hits: [], ended: true });
        expect(maze.cells).toEqual(
          createGrid(W, H, ({ x, y }) =>
            keys.has(`${x},${y}`) ? "open" : "wall",
          ).cells,
        );
      }
    },
  );

  it("moves several shots independently of each other", () => {
    // In lanes of their own, so they never meet.
    const shots = [
      shotAt({ x: 5, y: 3 }, 0, 1),
      shotAt({ x: 12, y: 37 }, 0, -1),
      shotAt({ x: 20, y: 10 }, 0, 1),
      shotAt({ x: 28, y: 30 }, 0, -1),
      shotAt({ x: 34, y: 20 }, 0, 1),
    ];
    const flights = shots.map((s) => fly(room, s, []));
    const longest = Math.max(...flights.map((f) => f.path.length));

    let together: readonly Shot[] = shots;
    for (let tick = 1; tick < longest + 5; tick++) {
      const result = moveShots(room, together, []);
      expect(result.hits).toEqual([]);
      together = result.shots;
      const expected = flights
        .filter((f) => tick < f.path.length)
        .map((f) => `${f.path[tick].x},${f.path[tick].y}`)
        .sort();
      expect(
        together.map((s) => `${s.x},${s.y}`).sort(),
        `tick ${tick}`,
      ).toEqual(expected);
    }
    expect(together).toEqual([]);
  });

  it("does not change the maze, shots or targets it is given", () => {
    const maze = createGrid(40, 40, ({ x, y }) =>
      x === 0 || y === 0 ? "wall" : "open",
    );
    const shots = [
      shotAt({ x: 5, y: 5 }, 1, 0),
      shotAt({ x: 2, y: 2 }, -1, -1),
    ];
    const targets = [{ x: 8, y: 4, width: 4, height: 4 }];
    const before = structuredClone({ maze, shots, targets });
    moveShots(maze, shots, targets);
    expect({ maze, shots, targets }).toEqual(before);
  });
});

describe("2.5 Bullets: a shot hits an entity when it enters a cell of its footprint", () => {
  // Footprints of the entities in 2.10: ghost (and shot) 2 x 2, snipe 4 x 2, hive 4 x 4.
  const SIZES: [name: string, width: number, height: number][] = [
    ["2 x 2", 2, 2],
    ["4 x 2", 4, 2],
    ["4 x 4", 4, 4],
  ];
  const start = { x: 19, y: 19 };

  // A target whose footprint the shot first enters at its k-th step, by the cell of the shot's
  // footprint that leads in its direction: by a corner cell for a diagonal shot.
  function ahead(
    dx: number,
    dy: number,
    k: number,
    width: number,
    height: number,
  ): Box {
    const lead = {
      x: start.x + k * dx + (dx > 0 ? 1 : 0),
      y: start.y + k * dy + (dy > 0 ? 1 : 0),
    };
    return {
      x: dx < 0 ? lead.x - width + 1 : lead.x,
      y: dy < 0 ? lead.y - height + 1 : lead.y,
      width,
      height,
    };
  }

  const cases = DIRECTIONS.flatMap(([name, dx, dy]) =>
    SIZES.map(
      ([size, width, height]) => [name, size, dx, dy, width, height] as const,
    ),
  );

  it.each(cases)(
    "flying %s, it hits a %s target at any distance and never passes it",
    (_name, _size, dx, dy, width, height) => {
      for (let k = 1; k <= 12; k++) {
        const target = ahead(dx, dy, k, width, height);
        const expected = checkShot(room, shotAt(start, dx, dy), [target]);
        // The test's own check: the target is entered at the k-th step.
        expect(expected.hit).toBe(0);
        expect(expected.path).toHaveLength(k);
      }
    },
  );

  it.each(cases)(
    "flying %s, it hits a %s target beside its line exactly when a cell overlaps",
    (_name, _size, dx, dy, width, height) => {
      // Slides the target across the shot's line, one cell at a time, from well clear of it
      // on one side to well clear on the other.
      const target = ahead(dx, dy, 6, width, height);
      const across = dy === 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
      let hits = 0;
      let misses = 0;
      for (let offset = -7; offset <= 7; offset++) {
        const moved = {
          ...target,
          x: target.x + offset * across.x,
          y: target.y + offset * across.y,
        };
        if (overlaps(room, shotBox(start), moved) || !clear(room, moved))
          continue;
        const expected = checkShot(room, shotAt(start, dx, dy), [moved]);
        if (expected.hit === null) misses++;
        else hits++;
      }
      // The test's own check: the sweep has both hits and near misses.
      expect(hits).toBeGreaterThan(0);
      expect(misses).toBeGreaterThan(1);
    },
  );

  it.each(STRAIGHT)(
    "flying %s, it passes a target that is next to its line but not on it",
    (_name, dx, dy) => {
      // A 4 x 2 target right beside the shot's two cells, on either side.
      for (const side of [-1, 1]) {
        const target: Box =
          dx !== 0
            ? {
                x: start.x + 5 * dx,
                y: side < 0 ? start.y - 2 : start.y + SHOT,
                width: 4,
                height: 2,
              }
            : {
                x: side < 0 ? start.x - 4 : start.x + SHOT,
                y: start.y + 5 * dy,
                width: 4,
                height: 2,
              };
        const expected = checkShot(room, shotAt(start, dx, dy), [target]);
        expect(expected.hit).toBeNull();
      }
    },
  );

  it.each(DIAGONALS)(
    "flying %s, it passes a target just beside the cells it sweeps",
    (_name, dx, dy) => {
      // A 2 x 2 target the shot would hit, moved sideways out of its way: by 2 cells it still
      // overlaps a cell the shot sweeps, by 3 it is just beside them.
      const lead = ahead(dx, dy, 5, 2, 2);
      for (const target of [
        { ...lead, x: lead.x + 2 * dx },
        { ...lead, y: lead.y + 2 * dy },
      ]) {
        expect(checkShot(room, shotAt(start, dx, dy), [target]).hit).toBe(0);
      }
      for (const target of [
        { ...lead, x: lead.x + 3 * dx },
        { ...lead, y: lead.y + 3 * dy },
      ]) {
        const expected = checkShot(room, shotAt(start, dx, dy), [target]);
        expect(expected.hit).toBeNull();
      }
    },
  );

  it.each(DIRECTIONS)(
    "flying %s, it hits only the nearer of two targets in its way",
    (_name, dx, dy) => {
      const near = ahead(dx, dy, 3, 2, 2);
      const far = ahead(dx, dy, 8, 4, 4);
      expect(checkShot(room, shotAt(start, dx, dy), [near, far]).hit).toBe(0);
      expect(checkShot(room, shotAt(start, dx, dy), [far, near]).hit).toBe(1);
    },
  );

  it.each(DIRECTIONS)(
    "flying %s, it does not hit a target behind it",
    (_name, dx, dy) => {
      const behind = ahead(-dx, -dy, 4, 4, 4);
      const expected = checkShot(room, shotAt(start, dx, dy), [behind]);
      expect(expected.hit).toBeNull();
    },
  );

  it.each(DIRECTIONS)(
    "flying %s, a wall in front of a target stops it and a target in front of a wall is hit",
    (_name, dx, dy) => {
      const target = ahead(dx, dy, 8, 2, 2);
      // A wall line across the shot's way, 3 cells beyond the place where it starts.
      const blocking = createGrid(40, 40, ({ x, y }) =>
        x === 0 ||
        y === 0 ||
        (dx !== 0 && x === start.x + (dx > 0 ? SHOT + 3 : -4)) ||
        (dx === 0 && y === start.y + (dy > 0 ? SHOT + 3 : -4))
          ? "wall"
          : "open",
      );
      const stopped = checkShot(blocking, shotAt(start, dx, dy), [target]);
      expect(stopped.hit).toBeNull();
      expect(stopped.path).toHaveLength(4);

      // The same wall line beyond the target.
      const beyond = createGrid(40, 40, ({ x, y }) =>
        x === 0 ||
        y === 0 ||
        (dx !== 0 && x === start.x + (dx > 0 ? SHOT + 12 : -13)) ||
        (dx === 0 && y === start.y + (dy > 0 ? SHOT + 12 : -13))
          ? "wall"
          : "open",
      );
      expect(checkShot(beyond, shotAt(start, dx, dy), [target]).hit).toBe(0);
    },
  );

  it("hits a target whose footprint wraps over an edge", () => {
    const W = 30;
    const H = 24;
    const open = createGrid(W, H, () => "open");
    // A 4 x 2 target over the right edge (columns 28, 29, 0, 1), shot at from either side.
    const target = { x: W - 2, y: 10, width: 4, height: 2 };
    expect(checkShot(open, shotAt({ x: 20, y: 10 }, 1, 0), [target]).hit).toBe(
      0,
    );
    expect(checkShot(open, shotAt({ x: 8, y: 11 }, -1, 0), [target]).hit).toBe(
      0,
    );
    // A 4 x 4 target over the bottom-right corner, shot at diagonally.
    const corner = { x: W - 2, y: H - 2, width: 4, height: 4 };
    expect(checkShot(open, shotAt({ x: 10, y: 4 }, 1, 1), [corner]).hit).toBe(
      0,
    );
    expect(checkShot(open, shotAt({ x: 10, y: 9 }, -1, -1), [corner]).hit).toBe(
      0,
    );
  });

  it("counts a hit for every shot that hits, also on the same target", () => {
    const target = { x: 18, y: 18, width: 4, height: 4 };
    const shots = [
      shotAt({ x: 5, y: 19 }, 1, 0),
      shotAt({ x: 33, y: 20 }, -1, 0),
      shotAt({ x: 19, y: 5 }, 0, 1),
    ];
    const others = [{ x: 30, y: 30, width: 2, height: 2 }, target];
    const hits: number[] = [];
    let flying: readonly Shot[] = shots;
    for (let tick = 0; tick < 100 && flying.length > 0; tick++) {
      const result = moveShots(room, flying, others);
      hits.push(...result.hits);
      flying = result.shots;
    }
    expect(flying).toEqual([]);
    expect(hits).toEqual([1, 1, 1]);
  });

  it("a shot that hits disappears while the others fly on", () => {
    const target = { x: 10, y: 5, width: 2, height: 2 };
    const hitter = shotAt({ x: 5, y: 5 }, 1, 0);
    const passer = shotAt({ x: 5, y: 30 }, 1, 0);
    const alone = fly(room, passer, []);
    let flying: readonly Shot[] = [hitter, passer];
    let hitAt = -1;
    for (let tick = 1; tick < alone.path.length; tick++) {
      const result = moveShots(room, flying, [target]);
      flying = result.shots;
      if (result.hits.length > 0) {
        expect(result.hits).toEqual([0]);
        hitAt = tick;
      }
      expect(flying.map((s) => ({ x: s.x, y: s.y }))).toContainEqual(
        alone.path[tick],
      );
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(flying).toHaveLength(1);
  });
});
