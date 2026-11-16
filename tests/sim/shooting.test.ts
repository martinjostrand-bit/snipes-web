import { describe, expect, it } from "vitest";
import {
  cellAt,
  createGrid,
  wrap,
  type Grid,
  type Point,
} from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import { moveShots, type Shot } from "../../src/core/shots";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";

// Spec 2.1, 2.5, 2.10, 6.2 and 9.1 WP 08: whole games with shooting, run headless from a seed
// and scripted input. `state.shots` holds the shots in flight, each a 2 x 2 footprint whose
// position is its top-left cell. Every tick no cell of a shot or of the player's footprint is
// a wall, and the maze is unchanged (walls are unharmed by default). `moveShots(maze, shots,
// targets)` moves shots on by one tick and reports, per shot that entered a target's
// footprint, the target's index in `hits`; every flight follows the rules of 2.5 and 2.10.

type Axis = InputState["moveX"];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4;
const SHOT = 2;
const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7919 + 3);
const TICKS = 60 * 60; // one minute at 60 ticks/s (4.3)
const AXES: Axis[] = [-1, 0, 1];
const STRAIGHT: [Axis, Axis][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
const DIRECTIONS: [Axis, Axis][] = AXES.flatMap((dx) =>
  AXES.filter((dy) => dx !== 0 || dy !== 0).map((dy): [Axis, Axis] => [dx, dy]),
);

// Draws whole numbers in [0, n) from the seeded PRNG, so a script is the same on every run.
function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
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

function clear(maze: Grid, box: Box): boolean {
  return cells(box).every((c) => cellAt(maze, c) === "open");
}

function fits(maze: Grid, p: Point, size = SHOT): boolean {
  return clear(maze, { x: p.x, y: p.y, width: size, height: size });
}

function overlaps(maze: Grid, a: Box, b: Box): boolean {
  const keys = new Set(
    cells(a).map((c) => `${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
  return cells(b).some((c) =>
    keys.has(`${mod(c.x, maze.width)},${mod(c.y, maze.height)}`),
  );
}

function shotBox(p: Point): Box {
  return { x: p.x, y: p.y, width: SHOT, height: SHOT };
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

function randomInput(draw: (n: number) => number): InputState {
  return {
    ...NO_INPUT,
    moveX: AXES[draw(3)],
    moveY: AXES[draw(3)],
    fast: draw(2) === 1,
    fireX: AXES[draw(3)],
    fireY: AXES[draw(3)],
  };
}

// A fixed input log: random movement, Space and fire keys every 5 to 40 ticks.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  while (log.length < ticks) {
    const input = randomInput(draw);
    for (let i = 5 + draw(36); i > 0 && log.length < ticks; i--) {
      log.push(input);
    }
  }
  return log;
}

// A walk that explores the maze while firing: every 5 to 24 ticks it holds new keys. Three
// times in four it moves in a straight direction in which the player's footprint has room.
function explore(
  seed: number,
  ticks: number,
  onTick: (state: GameState, tick: number) => void,
): GameState {
  const draw = drawer(seed);
  let state = createGame(seed);
  let tick = 0;
  while (tick < ticks) {
    let input = randomInput(draw);
    if (draw(4) > 0) {
      const { x, y } = state.player;
      const open = STRAIGHT.filter(([dx, dy]) =>
        fits(state.maze, { x: x + dx, y: y + dy }, PLAYER),
      );
      if (open.length > 0) {
        const [moveX, moveY] = open[draw(open.length)];
        input = { ...input, moveX, moveY };
      }
    }
    for (let i = 5 + draw(20); i > 0 && tick < ticks; i--, tick++) {
      state = step(state, input);
      onTick(state, tick);
    }
  }
  return state;
}

function play(seed: number, log: readonly InputState[]): GameState {
  let state = createGame(seed);
  for (const input of log) {
    state = step(state, input);
  }
  return state;
}

interface Plan {
  readonly path: Point[];
  readonly hit: number | null;
  readonly ambiguous: boolean;
  readonly ended: boolean;
}

// Spec 2.1, 2.5 and 2.10, the test's own model of a flight: one cell at a time along (dx, dy),
// stopping before a wall or a corner gap, hitting the first target whose footprint it enters.
function plan(
  maze: Grid,
  start: Point,
  dx: number,
  dy: number,
  targets: readonly Box[],
  limit = 2000,
): Plan {
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

// A rough, seeded grid: about one cell in twenty is a wall, scattered, and here and there two
// wall cells two steps apart diagonally, the shape of a corner gap for a 2 x 2 shot. Shots
// meet corner gaps and single wall cells everywhere, unlike in a generated maze.
function roughGrid(seed: number, width: number, height: number): Grid {
  const draw = drawer(seed);
  const walls = new Set<string>();
  const add = (x: number, y: number): void => {
    walls.add(`${mod(x, width)},${mod(y, height)}`);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (draw(20) === 0) add(x, y);
      if (draw(30) === 0) {
        add(x, y);
        add(x + 2, draw(2) === 0 ? y + 2 : y - 2);
      }
    }
  }
  return createGrid(width, height, ({ x, y }) =>
    walls.has(`${x},${y}`) ? "wall" : "open",
  );
}

// The cells per tick moveShots moves a shot in an open field, at most.
function moveSpeed(): number {
  const field = createGrid(301, 301, () => "open");
  let speed = 0;
  for (const [dx, dy] of DIRECTIONS) {
    let shots: readonly Shot[] = [{ x: 150, y: 150, dx, dy }];
    for (let tick = 0; tick < 20; tick++) {
      const next = moveShots(field, shots, []).shots;
      if (next.length !== 1) break;
      speed = Math.max(
        speed,
        Math.abs(next[0].x - shots[0].x),
        Math.abs(next[0].y - shots[0].y),
      );
      shots = next;
    }
  }
  return Math.max(1, speed);
}

describe("6.2 Invariants: no cell covered by a bullet or the player is ever a wall (2.10)", () => {
  it.each(SEEDS)(
    "holds every tick of a minute's walk while firing (seed %d)",
    (seed) => {
      const game = createGame(seed);
      const maze = game.maze;
      const problems: string[] = [];
      const shotCells = new Set<string>();
      let shotTicks = 0;

      const end = explore(seed, TICKS, (state, tick) => {
        if (!fits(maze, state.player, PLAYER)) {
          problems.push(`tick ${tick}: player on a wall`);
        }
        if (state.shots.length > 0) shotTicks++;
        for (const shot of state.shots) {
          if (!inside(maze, shot)) {
            problems.push(`tick ${tick}: shot outside at ${shot.x},${shot.y}`);
          } else if (!fits(maze, shot)) {
            problems.push(
              `tick ${tick}: shot on a wall at ${shot.x},${shot.y}`,
            );
          }
          shotCells.add(`${shot.x},${shot.y}`);
        }
      });

      expect(problems).toEqual([]);
      expect(end.maze).toEqual(maze);
      // Guards against a game in which hardly any shot flies, which would pass the checks.
      expect(shotTicks).toBeGreaterThan(50);
      expect(shotCells.size).toBeGreaterThan(30);
    },
  );
});

describe("2.5 Bullets: every flight follows the rules (2.1, 2.10)", () => {
  // Random shots in rough grids full of corner gaps, with up to three targets of the 2.10
  // sizes on open cells. Each shot is moved alone until it disappears; its path and hits must
  // be those of the test's model, except where the model cannot tell which comes first.
  const SIZES: [number, number][] = [
    [2, 2],
    [4, 2],
    [4, 4],
  ];

  it.each(SEEDS.slice(0, 10))("in a rough grid (seed %d)", (seed) => {
    const maze = roughGrid(seed, 48, 40);
    const draw = drawer(seed + 1);
    const problems: string[] = [];
    let checked = 0;
    let hit = 0;
    let gaps = 0;
    // A shot may skip cells within a tick, but not stop while a tick's flight of room is left.
    const speed = moveSpeed();

    for (let n = 0; n < 300; n++) {
      const start = { x: draw(maze.width), y: draw(maze.height) };
      if (!fits(maze, start)) continue;
      const [dx, dy] = DIRECTIONS[draw(DIRECTIONS.length)];
      const targets: Box[] = [];
      for (let t = draw(4); t > 0; t--) {
        const [width, height] = SIZES[draw(SIZES.length)];
        // Half of the targets anywhere, half a few cells ahead of the shot, near its way.
        const ahead = 2 + draw(6);
        const box =
          draw(2) === 0
            ? { x: draw(maze.width), y: draw(maze.height), width, height }
            : {
                x: mod(start.x + ahead * dx + draw(7) - 3, maze.width),
                y: mod(start.y + ahead * dy + draw(7) - 3, maze.height),
                width,
                height,
              };
        if (clear(maze, box) && !overlaps(maze, box, shotBox(start))) {
          targets.push(box);
        }
      }
      const expected = plan(maze, start, dx, dy, targets);
      if (!expected.ended || expected.ambiguous) continue;

      const path: Point[] = [start];
      const hits: number[] = [];
      let shots: readonly Shot[] = [{ x: start.x, y: start.y, dx, dy }];
      for (let tick = 0; tick < 3 * expected.path.length + 10; tick++) {
        const result = moveShots(maze, shots, targets);
        hits.push(...result.hits);
        shots = result.shots;
        if (shots.length !== 1) break;
        path.push({ x: shots[0].x, y: shots[0].y });
      }

      const what = `shot ${start.x},${start.y} going ${dx},${dy}`;
      const steps = path.map((p) =>
        expected.path.findIndex((q) => q.x === p.x && q.y === p.y),
      );
      if (shots.length !== 0) problems.push(`${what}: did not disappear`);
      if (steps.includes(-1)) {
        problems.push(`${what}: left its way at ${JSON.stringify(path)}`);
      }
      if (steps.some((s, i) => i > 0 && s < steps[i - 1])) {
        problems.push(`${what}: went back`);
      }
      if (steps[steps.length - 1] < expected.path.length - speed) {
        problems.push(`${what}: stopped early at ${steps[steps.length - 1]}`);
      }
      const want = expected.hit === null ? [] : [expected.hit];
      if (JSON.stringify(hits) !== JSON.stringify(want)) {
        problems.push(
          `${what}: hits ${JSON.stringify(hits)}, want ${JSON.stringify(want)}`,
        );
      }

      checked++;
      if (expected.hit !== null) hit++;
      const last = expected.path[expected.path.length - 1];
      if (
        dx !== 0 &&
        dy !== 0 &&
        expected.hit === null &&
        fits(maze, { x: last.x + dx, y: last.y + dy })
      ) {
        gaps++;
      }
    }

    expect(problems).toEqual([]);
    // Guards: enough flights, some hitting targets and some stopped by corner gaps.
    expect(checked).toBeGreaterThan(100);
    expect(hit).toBeGreaterThan(5);
    expect(gaps).toBeGreaterThan(0);
  });
});

describe("6.2 Determinism with shooting", () => {
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "seed %d and the same input log with firing give the same states",
    (seed) => {
      const log = inputLog(seed + 5, TICKS);
      let a = createGame(seed);
      let b = createGame(seed);
      for (const input of log) {
        a = step(a, input);
        b = step(b, input);
        expect(a.shots).toEqual(b.shots);
      }
      expect(a).toEqual(b);
      expect(play(seed, log)).toEqual(a);
    },
  );

  it("firing differently gives different shots on the same walk", () => {
    const walk = inputLog(300, TICKS);
    const shotsOf = (fireX: Axis, fireY: Axis): string[] => {
      let state = createGame(3);
      return walk.map((input) => {
        state = step(state, { ...input, fireX, fireY });
        return JSON.stringify(state.shots);
      });
    };
    expect(shotsOf(1, 0)).not.toEqual(shotsOf(0, 1));
    expect(shotsOf(1, 0)).not.toEqual(shotsOf(0, 0));
  });
});
