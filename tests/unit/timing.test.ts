import { describe, expect, it } from "vitest";
import {
  cellAt,
  createGrid,
  wrap,
  type Grid,
  type Point,
} from "../../src/core/grid";
import { advance, TICK_MS } from "../../src/core/loop";
import { moveShots, type Shot } from "../../src/core/shots";
import {
  createGame,
  NO_INPUT,
  type GameState,
  type InputState,
} from "../../src/core/state";
// Spec 2.7 (WP 13): these tests go on after a level is cleared; see play-on.ts.
import { playOn as step } from "../play-on";

// Spec 2.2, 2.5, 4.3 and 9.1 WP 08b: speeds.
//
// - Logic runs at 60 ticks per second: `TICK_MS` is 1000 / 60, and `advance` runs one
//   `step(state, input)` per whole tick (4.3).
// - The player steps on the first tick a direction is held and the previous wait is over;
//   after a step it waits 2 more ticks, or 1 if Space was held at that step. So it steps every
//   3 ticks (20 cells/s), or every 2 with Space (30 cells/s). The wait runs on whether or not a
//   key is held, and staying put does not use up a step (2.2).
// - A shot moves one cell per tick (60 cells/s) (2.5).
// - A shot fires on any tick a fire key is held and at least 13 ticks have passed since the
//   last shot; tapping cannot fire faster. A shot whose start position is a wall is not fired
//   and uses no time. No shot is fired while Space is held, but the 13 ticks run on (2.2, 2.5).
//
// Ticks are counted from 1: tick 1 is the first `step` after the start.

type Axis = InputState["moveX"];
type Direction = [name: string, dx: Axis, dy: Axis];

const STEP_TICKS = 3; // ticks from one step to the next (2.2)
const FAST_STEP_TICKS = 2; // the same with Space held at the step (2.2)
const FIRE_TICKS = 13; // ticks from one shot to the next, at least (2.5)
const TICKS_PER_SECOND = 60; // 4.3
const PLAYER = 4; // the player's footprint is PLAYER x PLAYER cells (2.10)
const SHOT = 2; // a shot's footprint is SHOT x SHOT cells (2.10)

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

function go(dx: Axis, dy: Axis, fast = false): InputState {
  return input(dx, dy, 0, 0, fast);
}

function fire(dx: Axis, dy: Axis, fast = false): InputState {
  return input(0, 0, dx, dy, fast);
}

const SPACE = input(0, 0, 0, 0, true);

function repeat(keys: InputState, ticks: number): InputState[] {
  return new Array<InputState>(ticks).fill(keys);
}

// An input log written one character per tick, each character standing for the keys held.
function script(ticks: string, keys: Record<string, InputState>): InputState[] {
  return [...ticks].map((c) => {
    const held = keys[c];
    if (held === undefined) throw new Error(`No keys for '${c}'`);
    return held;
  });
}

// first, first + gap, first + 2 * gap, … up to and including `last`.
function every(first: number, gap: number, last: number): number[] {
  const ticks: number[] = [];
  for (let t = first; t <= last; t += gap) ticks.push(t);
  return ticks;
}

function openExcept(width: number, height: number, walls: Point[]): Grid {
  const keys = new Set(
    walls.map(({ x, y }) => `${mod(x, width)},${mod(y, height)}`),
  );
  return createGrid(width, height, ({ x, y }) =>
    keys.has(`${x},${y}`) ? "wall" : "open",
  );
}

// An open field large enough that in the 200 ticks a test runs at most, neither the player
// nor a shot reaches an edge of it and comes round again.
const field = createGrid(301, 301, () => "open");
const centre = { x: 150, y: 150 };

// The player alone in `maze`: no hives or snipes (WP 09) to stop the shots.
function place(maze: Grid, at: Point): GameState {
  const game = createGame(1);
  return {
    ...game,
    maze,
    player: { ...game.player, x: at.x, y: at.y },
    hives: [],
    snipes: [],
  };
}

function at(state: GameState): Point {
  return { x: state.player.x, y: state.player.y };
}

// The state after each tick of the log; states[i] is the state after tick i + 1.
function run(start: GameState, log: readonly InputState[]): GameState[] {
  const states: GameState[] = [];
  let state = start;
  for (const keys of log) {
    state = step(state, keys);
    states.push(state);
  }
  return states;
}

// The ticks on which the player left its position.
function moveTicks(start: GameState, log: readonly InputState[]): number[] {
  const ticks: number[] = [];
  let previous = at(start);
  run(start, log).forEach((state, i) => {
    const now = at(state);
    if (now.x !== previous.x || now.y !== previous.y) ticks.push(i + 1);
    previous = now;
  });
  return ticks;
}

// The ticks on which a new shot appeared. The tests that use this keep every shot clear of
// walls until the log ends, so a new shot is one more shot in flight.
function fireTicks(start: GameState, log: readonly InputState[]): number[] {
  const ticks: number[] = [];
  let previous = start.shots.length;
  run(start, log).forEach((state, i) => {
    const added = state.shots.length - previous;
    expect(added, `tick ${i + 1}: a shot disappeared`).toBeGreaterThanOrEqual(
      0,
    );
    expect(added, `tick ${i + 1}: more than one new shot`).toBeLessThanOrEqual(
      1,
    );
    if (added === 1) ticks.push(i + 1);
    previous = state.shots.length;
  });
  return ticks;
}

// The test's own model of 2.2, for a player with room to move every way: the ticks on which it
// steps.
function modelSteps(log: readonly InputState[]): number[] {
  const ticks: number[] = [];
  let ready = 1;
  log.forEach((keys, i) => {
    const tick = i + 1;
    if ((keys.moveX !== 0 || keys.moveY !== 0) && tick >= ready) {
      ticks.push(tick);
      ready = tick + (keys.fast ? FAST_STEP_TICKS : STEP_TICKS);
    }
  });
  return ticks;
}

// The test's own model of 2.5: the ticks on which a shot fires. `blocked` says whether a wall
// is where the shot would start.
function modelShots(
  log: readonly InputState[],
  blocked: (keys: InputState) => boolean = () => false,
): number[] {
  const ticks: number[] = [];
  let ready = 1;
  log.forEach((keys, i) => {
    const tick = i + 1;
    const held = keys.fireX !== 0 || keys.fireY !== 0;
    if (held && !keys.fast && tick >= ready && !blocked(keys)) {
      ticks.push(tick);
      ready = tick + FIRE_TICKS;
    }
  });
  return ticks;
}

// Spec 2.10: where a player's shot appears, not wrapped.
function spawnFor(player: Point, dx: number, dy: number): Point {
  return {
    x: dx < 0 ? player.x - SHOT : dx > 0 ? player.x + PLAYER : player.x + 1,
    y: dy < 0 ? player.y - SHOT : dy > 0 ? player.y + PLAYER : player.y + 1,
  };
}

function fitsShot(maze: Grid, p: Point): boolean {
  for (let dy = 0; dy < SHOT; dy++) {
    for (let dx = 0; dx < SHOT; dx++) {
      if (cellAt(maze, { x: p.x + dx, y: p.y + dy }) === "wall") return false;
    }
  }
  return true;
}

// Spec 2.1, 2.5 and 2.10, the test's own model of a flight with no targets: every position
// the shot stands on, one cell apart, up to the last one before a wall or a corner gap.
function flightPath(maze: Grid, start: Point, dx: number, dy: number): Point[] {
  const path = [wrap(maze, start)];
  let p = start;
  for (;;) {
    const next = { x: p.x + dx, y: p.y + dy };
    const blocked =
      !fitsShot(maze, next) ||
      (dx !== 0 &&
        dy !== 0 &&
        !fitsShot(maze, { x: next.x, y: p.y }) &&
        !fitsShot(maze, { x: p.x, y: next.y }));
    if (blocked) return path;
    path.push(wrap(maze, next));
    p = next;
  }
}

// ===========================================================================================

describe("4.3 Game loop: 60 ticks per second", () => {
  const RIGHT = go(1, 0);

  // `advance` steps the game with the game's own `step`, so the player is not alone here: a
  // hive far from its way and from its shots' keeps the level from being cleared (2.7, WP 13).
  // The hive never spawns: its wait for its next spawn never runs out.
  function lone(): GameState {
    const game = place(field, centre);
    return {
      ...game,
      hives: [
        {
          ...createGame(1).hives[0],
          x: 20,
          y: 20,
          hits: 0,
          wait: Number.MAX_SAFE_INTEGER,
        },
      ],
    };
  }

  it("one tick is 1/60 s", () => {
    expect(TICK_MS).toBeCloseTo(1000 / TICKS_PER_SECOND, 9);
  });

  it("runs 60 ticks in a second, and 59 in just under a second", () => {
    const start = lone();
    const states = run(start, repeat(RIGHT, TICKS_PER_SECOND));

    const second = advance(start, RIGHT, 0, 1005);
    expect(second.state).toEqual(states[59]);
    expect(second.carriedMs).toBeCloseTo(1005 - 60 * (1000 / 60), 6);

    const under = advance(start, RIGHT, 0, 995);
    expect(under.state).toEqual(states[58]);
  });

  it("runs exactly one tick in each frame of a 60 Hz screen", () => {
    const start = lone();
    const states = run(start, repeat(RIGHT, 120));
    let result = { state: start, carriedMs: 0 };
    for (let frame = 0; frame < 120; frame++) {
      // A 60 Hz frame, a little longer than 1/60 s as real frames often are.
      result = advance(result.state, RIGHT, result.carriedMs, 16.7);
      expect(result.state, `frame ${frame + 1}`).toEqual(states[frame]);
    }
  });

  it("runs two ticks in each frame of a 30 Hz screen", () => {
    const start = lone();
    const states = run(start, repeat(RIGHT, 120));
    let result = { state: start, carriedMs: 0 };
    for (let frame = 0; frame < 60; frame++) {
      result = advance(result.state, RIGHT, result.carriedMs, 33.4);
      expect(result.state, `frame ${frame + 1}`).toEqual(states[2 * frame + 1]);
    }
  });

  it("in one second of play, the player moves 20 cells, or 30 with Space", () => {
    const start = lone();
    const normal = advance(start, RIGHT, 0, 1005).state;
    const fast = advance(start, go(1, 0, true), 0, 1005).state;
    expect(at(normal)).toEqual({ x: centre.x + 20, y: centre.y });
    expect(at(fast)).toEqual({ x: centre.x + 30, y: centre.y });
  });

  it("in one second of holding a fire key, 5 shots are fired (about 4.6 a second)", () => {
    const end = advance(lone(), fire(1, 0), 0, 1005).state;
    expect(end.shots).toHaveLength(5);
  });

  it("in one second, a shot flies 60 cells", () => {
    // Fired on one tick, then flying for a whole second: 60 more ticks.
    const start = lone();
    const fired = step(start, fire(0, 1));
    expect(fired.shots).toHaveLength(1);
    const flown = advance(fired, NO_INPUT, 0, 1005).state;
    expect(flown.shots).toHaveLength(1);
    expect(flown.shots[0].x).toBe(fired.shots[0].x);
    expect(flown.shots[0].y).toBe(fired.shots[0].y + 60);
  });
});

describe("2.2 Player: one step every 3 ticks, every 2 with Space", () => {
  it.each(DIRECTIONS)(
    "holding %s, it steps on ticks 1, 4, 7, …: 20 cells in 60 ticks",
    (_name, dx, dy) => {
      const start = place(field, centre);
      const log = repeat(go(dx, dy), 60);
      const ticks = moveTicks(start, log);
      expect(ticks).toEqual(every(1, STEP_TICKS, 60));
      expect(ticks).toHaveLength(20);
      expect(at(run(start, log)[59])).toEqual({
        x: centre.x + 20 * dx,
        y: centre.y + 20 * dy,
      });
    },
  );

  it.each(DIRECTIONS)(
    "holding %s with Space, it steps on ticks 1, 3, 5, …: 30 cells in 60 ticks",
    (_name, dx, dy) => {
      const start = place(field, centre);
      const log = repeat(go(dx, dy, true), 60);
      const ticks = moveTicks(start, log);
      expect(ticks).toEqual(every(1, FAST_STEP_TICKS, 60));
      expect(ticks).toHaveLength(30);
      expect(at(run(start, log)[59])).toEqual({
        x: centre.x + 30 * dx,
        y: centre.y + 30 * dy,
      });
    },
  );

  it.each([0, 1, 2, 3, 5, 17])(
    "steps on the first tick a direction is held, after %d ticks with none",
    (idle) => {
      for (const fast of [false, true]) {
        for (const before of [NO_INPUT, SPACE]) {
          const log = [...repeat(before, idle), ...repeat(go(0, -1, fast), 7)];
          const gap = fast ? FAST_STEP_TICKS : STEP_TICKS;
          expect(moveTicks(place(field, centre), log)).toEqual(
            every(idle + 1, gap, idle + 7),
          );
        }
      }
    },
  );

  // n: right, f: right with Space, s: Space alone, .: nothing held.
  const KEYS = { n: go(1, 0), f: go(1, 0, true), s: SPACE, ".": NO_INPUT };
  const SCRIPTS: [what: string, ticks: string, steps: number[]][] = [
    ["Space pressed after a normal step", "nfffffffff", [1, 4, 6, 8, 10]],
    ["Space released after a fast step", "fnnnnnnnnn", [1, 3, 6, 9]],
    ["Space on and off every tick, on at the first", "fnfnfnfn", [1, 3, 5, 7]],
    [
      "Space on and off every tick, off at the first",
      "nfnfnfnfnf",
      [1, 4, 6, 8, 10],
    ],
    ["Space alone during the wait", "nssnnn", [1, 4]],
    ["a key released for a tick in the wait", "n.nnnn", [1, 4]],
    ["a key released for the whole wait", "n..nnn", [1, 4]],
    ["a key released past the wait", "n...nnn", [1, 5]],
    ["a key released long", "n.......n", [1, 9]],
    ["tapping every other tick", "n.n.n.n.n.n.n.n.", [1, 5, 9, 13]],
    ["tapping every other tick with Space", "f.f.f.f.", [1, 3, 5, 7]],
    ["tapping in step with the wait", "n..n..n..n..", [1, 4, 7, 10]],
    ["tapping one tick too early", "n.n.n.n.n.n.", [1, 5, 9]],
    ["released for one tick in three", "nn.nn.nn.nn.", [1, 4, 7, 10]],
    ["a fast key released for a tick", "f.fff", [1, 3, 5]],
  ];

  it.each(SCRIPTS)("%s: %s steps on ticks %j", (_what, ticks, steps) => {
    const log = script(ticks, KEYS);
    // The test's own check that its model agrees with the spec's examples.
    expect(modelSteps(log)).toEqual(steps);
    expect(moveTicks(place(field, centre), log)).toEqual(steps);
  });

  it("tapping a key cannot move the player faster than holding it", () => {
    const patterns = ["n.", "n..", "nn.", "n.n..", "f.", "f..", "ff."];
    for (const pattern of patterns) {
      const log = script(pattern.repeat(60).slice(0, 120), KEYS);
      const tapped = moveTicks(place(field, centre), log);
      expect(tapped, pattern).toEqual(modelSteps(log));
      for (let i = 1; i < tapped.length; i++) {
        expect(tapped[i] - tapped[i - 1], pattern).toBeGreaterThanOrEqual(
          FAST_STEP_TICKS,
        );
      }
    }
  });

  it("turning to another direction during the wait does not cut it short", () => {
    for (const [, dx, dy] of DIRECTIONS) {
      const log = [go(1, 0), ...repeat(go(dx, dy), 6)];
      const start = place(field, centre);
      expect(moveTicks(start, log)).toEqual([1, 4, 7]);
      const states = run(start, log);
      expect(at(states[2])).toEqual({ x: centre.x + 1, y: centre.y });
      expect(at(states[3])).toEqual({ x: centre.x + 1 + dx, y: centre.y + dy });
    }
  });

  it.each(DIAGONALS)(
    "sliding %s along a wall takes one step's time",
    (_name, dx, dy) => {
      // Corridors exactly as high, or as wide, as the footprint: every diagonal slides.
      const across = createGrid(301, 6, ({ y }) =>
        y >= 1 && y <= PLAYER ? "open" : "wall",
      );
      const downwards = createGrid(6, 301, ({ x }) =>
        x >= 1 && x <= PLAYER ? "open" : "wall",
      );
      for (const fast of [false, true]) {
        const gap = fast ? FAST_STEP_TICKS : STEP_TICKS;
        const sideways = place(across, { x: 150, y: 1 });
        expect(moveTicks(sideways, repeat(go(dx, dy, fast), 60))).toEqual(
          every(1, gap, 60),
        );
        expect(at(run(sideways, repeat(go(dx, dy, fast), 60))[59])).toEqual({
          x: 150 + (60 / gap) * dx,
          y: 1,
        });
        const upOrDown = place(downwards, { x: 1, y: 150 });
        expect(moveTicks(upOrDown, repeat(go(dx, dy, fast), 60))).toEqual(
          every(1, gap, 60),
        );
      }
    },
  );
});

describe("2.2 Player: staying put does not use up a step", () => {
  // A dead end: a corridor as high as the footprint, open from x = 75 rightwards.
  const deadEnd = createGrid(301, 6, ({ x, y }) =>
    y >= 1 && y <= PLAYER && x >= 75 ? "open" : "wall",
  );
  const end = { x: 75, y: 1 };
  const BLOCKED: Direction[] = [
    ["left", -1, 0],
    ["up", 0, -1],
    ["down", 0, 1],
    ["up-left", -1, -1],
    ["down-left", -1, 1],
  ];

  it.each(BLOCKED)(
    "after holding %s against the wall, the player steps on the very tick it turns",
    (_name, dx, dy) => {
      for (const fast of [false, true]) {
        for (let held = 1; held <= 8; held++) {
          const log = [
            ...repeat(go(dx, dy, fast), held),
            ...repeat(go(1, 0, fast), 2),
          ];
          expect(moveTicks(place(deadEnd, end), log), `held ${held}`).toEqual([
            held + 1,
          ]);
        }
      }
    },
  );

  it.each([false, true])(
    "a blocked try on the tick the wait ends does not start a new wait (fast: %s)",
    (fast) => {
      const gap = fast ? FAST_STEP_TICKS : STEP_TICKS;
      // Tick 1 steps left into the dead end. The wait ends on tick 1 + gap, when left is
      // blocked; the step right on the tick after comes at once.
      const log = [
        ...repeat(go(-1, 0, fast), 1 + gap),
        ...repeat(go(1, 0, fast), 1),
      ];
      const start = place(deadEnd, { x: 76, y: 1 });
      expect(moveTicks(start, log)).toEqual([1, gap + 2]);
      const states = run(start, log);
      expect(at(states[gap])).toEqual(end);
      expect(at(states[gap + 1])).toEqual({ x: 76, y: 1 });
    },
  );
});

describe("2.5 Bullets: one cell per tick", () => {
  it.each(DIRECTIONS)(
    "fired %s, it moves exactly one cell along its line every tick",
    (_name, dx, dy) => {
      const states = run(place(field, centre), [
        fire(dx, dy),
        ...repeat(NO_INPUT, 120),
      ]);
      expect(states[0].shots).toHaveLength(1);
      expect(states[0].shots[0]).toMatchObject(spawnFor(centre, dx, dy));
      for (let i = 1; i < states.length; i++) {
        expect(states[i].shots, `tick ${i + 1}`).toHaveLength(1);
        const before = states[i - 1].shots[0];
        const after = states[i].shots[0];
        expect(
          {
            x: delta(before.x, after.x, field.width),
            y: delta(before.y, after.y, field.height),
          },
          `tick ${i + 1}`,
        ).toEqual({ x: dx, y: dy });
      }
    },
  );

  // One block of the maze (2.10), 16 x 12 cells with walls on its left and top side, which the
  // wrapping grid also makes its right and bottom side.
  const block = createGrid(16, 12, ({ x, y }) =>
    x === 0 || y === 0 ? "wall" : "open",
  );
  const start = { x: 6, y: 4 };

  it.each(DIRECTIONS)(
    "fired %s in a block, it stands on every position up to the wall, one per tick, then disappears",
    (_name, dx, dy) => {
      const path = flightPath(block, spawnFor(start, dx, dy), dx, dy);
      expect(path.length).toBeGreaterThan(1);
      const states = run(place(block, start), [
        fire(dx, dy),
        ...repeat(NO_INPUT, path.length + 5),
      ]);
      path.forEach((p, i) => {
        expect(
          states[i].shots.map((s) => ({ x: s.x, y: s.y })),
          `tick ${i + 1}`,
        ).toEqual([p]);
      });
      for (let i = path.length; i < states.length; i++) {
        expect(states[i].shots, `tick ${i + 1}`).toEqual([]);
      }
    },
  );

  it.each(DIRECTIONS)(
    "moveShots moves a shot flying %s by one cell, also across the edges",
    (_name, dx, dy) => {
      const W = 13;
      const H = 11;
      const open = createGrid(W, H, () => "open");
      for (const from of [
        { x: 5, y: 4 },
        { x: 0, y: 0 },
        { x: W - 1, y: H - 1 },
        { x: W - 1, y: 0 },
        { x: 0, y: H - 1 },
      ]) {
        const shot: Shot = { x: from.x, y: from.y, dx, dy };
        const result = moveShots(open, [shot], []);
        expect(result.hits).toEqual([]);
        expect(result.shots).toHaveLength(1);
        expect(result.shots[0]).toMatchObject({
          ...wrap(open, { x: from.x + dx, y: from.y + dy }),
          dx,
          dy,
        });
      }
    },
  );

  it.each(DIRECTIONS)(
    "moveShots moves a shot flying %s up to a wall one cell at a time",
    (_name, dx, dy) => {
      for (const gap of [0, 1, 2, 5]) {
        // A wall line `gap` open steps beyond the shot.
        const from = { x: 20, y: 20 };
        const maze = createGrid(64, 64, ({ x, y }) =>
          (dx !== 0 &&
            x === (dx > 0 ? from.x + SHOT + gap : from.x - 1 - gap)) ||
          (dx === 0 && y === (dy > 0 ? from.y + SHOT + gap : from.y - 1 - gap))
            ? "wall"
            : "open",
        );
        let shots: readonly Shot[] = [{ ...from, dx, dy }];
        for (let tick = 1; tick <= gap; tick++) {
          shots = moveShots(maze, shots, []).shots;
          expect(shots, `gap ${gap}, tick ${tick}`).toHaveLength(1);
          expect(shots[0]).toMatchObject({
            x: from.x + tick * dx,
            y: from.y + tick * dy,
          });
        }
        expect(moveShots(maze, shots, []).shots, `gap ${gap}`).toEqual([]);
      }
    },
  );

  it.each(DIRECTIONS)(
    "moveShots reports a hit flying %s on the tick the shot enters the target",
    (_name, dx, dy) => {
      const room = createGrid(40, 40, ({ x, y }) =>
        x === 0 || y === 0 ? "wall" : "open",
      );
      const from = { x: 19, y: 19 };
      for (let k = 1; k <= 8; k++) {
        // A 2 x 2 target the shot's footprint first overlaps at its k-th step.
        const target = {
          x: from.x + k * dx + (dx > 0 ? 1 : dx < 0 ? -1 : 0),
          y: from.y + k * dy + (dy > 0 ? 1 : dy < 0 ? -1 : 0),
          width: 2,
          height: 2,
        };
        let shots: readonly Shot[] = [{ ...from, dx, dy }];
        for (let tick = 1; tick < k; tick++) {
          const result = moveShots(room, shots, [target]);
          expect(result.hits, `k ${k}, tick ${tick}`).toEqual([]);
          shots = result.shots;
          expect(shots, `k ${k}, tick ${tick}`).toHaveLength(1);
        }
        const result = moveShots(room, shots, [target]);
        expect(result.hits, `k ${k}`).toEqual([0]);
        expect(result.shots, `k ${k}`).toEqual([]);
      }
    },
  );

  it.each(DIRECTIONS)(
    "fired %s, it covers 60 cells in 60 ticks, twice as far as the player with Space",
    (_name, dx, dy) => {
      const start = place(field, centre);
      const states = run(start, [fire(dx, dy), ...repeat(NO_INPUT, 60)]);
      const first = states[0].shots[0];
      const later = states[60].shots[0];
      const shotCells = Math.max(
        Math.abs(delta(first.x, later.x, field.width)),
        Math.abs(delta(first.y, later.y, field.height)),
      );

      const runner = (fast: boolean): number => {
        const end = at(run(start, repeat(go(dx, dy, fast), 60))[59]);
        return Math.max(Math.abs(end.x - centre.x), Math.abs(end.y - centre.y));
      };

      expect(shotCells).toBe(60);
      expect(runner(true)).toBe(30);
      expect(runner(false)).toBe(20);
      expect(shotCells).toBeGreaterThan(runner(true));
    },
  );
});

describe("2.5 Bullets: holding a fire key fires every 13 ticks", () => {
  it.each(DIRECTIONS)(
    "holding %s, it fires on ticks 1, 14, 27, …",
    (_name, dx, dy) => {
      const ticks = fireTicks(place(field, centre), repeat(fire(dx, dy), 200));
      expect(ticks).toEqual(every(1, FIRE_TICKS, 200));
      expect(ticks).toHaveLength(16);
    },
  );

  it.each(DIRECTIONS)(
    "holding %s, each new shot appears just outside the player and flies %s",
    (_name, dx, dy) => {
      const states = run(place(field, centre), repeat(fire(dx, dy), 30));
      for (const tick of [1, 14, 27]) {
        const added = states[tick - 1].shots.filter(
          (s) =>
            !(tick > 1 ? states[tick - 2].shots : []).some(
              (p) => p.x + p.dx === s.x && p.y + p.dy === s.y,
            ),
        );
        expect(added, `tick ${tick}`).toHaveLength(1);
        expect(added[0]).toMatchObject({ ...spawnFor(centre, dx, dy), dx, dy });
      }
    },
  );

  it.each([0, 1, 12, 13, 40])(
    "fires on the first tick a fire key is held, after %d ticks with none",
    (idle) => {
      const log = [...repeat(NO_INPUT, idle), ...repeat(fire(1, 1), 30)];
      expect(fireTicks(place(field, centre), log)).toEqual(
        every(idle + 1, FIRE_TICKS, idle + 30),
      );
    },
  );

  // x: fire right, .: nothing held.
  const KEYS = { x: fire(1, 0), ".": NO_INPUT };
  const SCRIPTS: [what: string, ticks: string, shots: number[]][] = [
    ["tapping every other tick", "x.".repeat(16), [1, 15, 29]],
    ["pressed again 13 ticks after a shot", `x${".".repeat(12)}x`, [1, 14]],
    ["pressed again 12 ticks after a shot", `x${".".repeat(11)}xx`, [1, 14]],
    ["pressed again long after a shot", `x${".".repeat(20)}x`, [1, 22]],
    ["one tick in every 13", `x${".".repeat(12)}`.repeat(4), [1, 14, 27, 40]],
    ["one tick in every 12", `x${".".repeat(11)}`.repeat(4), [1, 25]],
    ["released and pressed during the wait", `x....${"x".repeat(15)}`, [1, 14]],
  ];

  it.each(SCRIPTS)("%s: %s fires on ticks %j", (_what, ticks, shots) => {
    const log = script(ticks, KEYS);
    // The test's own check that its model agrees with the spec's examples.
    expect(modelShots(log)).toEqual(shots);
    expect(fireTicks(place(field, centre), log)).toEqual(shots);
  });

  it("tapping a fire key cannot fire faster than holding it", () => {
    for (const pattern of [
      "x.",
      "x..",
      "xx.",
      "x.x..",
      "x...........",
      "xxx...",
    ]) {
      const log = script(pattern.repeat(100).slice(0, 200), KEYS);
      const tapped = fireTicks(place(field, centre), log);
      expect(tapped, pattern).toEqual(modelShots(log));
      for (let i = 1; i < tapped.length; i++) {
        expect(tapped[i] - tapped[i - 1], pattern).toBeGreaterThanOrEqual(
          FIRE_TICKS,
        );
      }
    }
  });

  it("turning to another fire direction does not cut the wait short", () => {
    for (const [, dx, dy] of DIRECTIONS) {
      const log = [fire(1, 0), ...repeat(fire(dx, dy), 29)];
      const states = run(place(field, centre), log);
      expect(fireTicks(place(field, centre), log)).toEqual([1, 14, 27]);
      // The shot on tick 14 starts just outside the player and flies the new way.
      const spawn = spawnFor(centre, dx, dy);
      expect(
        states[13].shots.filter((s) => s.x === spawn.x && s.y === spawn.y),
      ).toEqual([expect.objectContaining({ dx, dy })]);
    }
  });

  it.each(MOVES)(
    "moving %s does not change when the shots fire",
    (_name, mx, my) => {
      const log = repeat(input(mx, my, 0, 1, false), 100);
      expect(fireTicks(place(field, centre), log)).toEqual(
        every(1, FIRE_TICKS, 100),
      );
    },
  );
});

describe("2.5 Bullets: a shot with no room to start is not fired and uses no time", () => {
  // A single wall cell where a shot fired up from the player at the centre would start; a shot
  // fired right has room, and never comes near that cell.
  const up = spawnFor(centre, 0, -1);
  const maze = openExcept(field.width, field.height, [up]);
  const blocked = (keys: InputState): boolean => keys.fireY === -1;
  // u: fire up, into the wall; r: fire right; .: nothing held.
  const KEYS = { u: fire(0, -1), r: fire(1, 0), ".": NO_INPUT };
  const SCRIPTS: [what: string, ticks: string, shots: number[]][] = [
    ["a try into the wall at the start", "uuuuur", [6]],
    [
      "a try into the wall right after the wait",
      `r${".".repeat(12)}ur`,
      [1, 15],
    ],
    [
      "a try into the wall all through the wait",
      `r${"u".repeat(29)}r`,
      [1, 31],
    ],
    ["tries into the wall between shots", `r${"u".repeat(13)}rr`, [1, 15]],
  ];

  it.each(SCRIPTS)("%s: %s fires on ticks %j", (_what, ticks, shots) => {
    const log = script(ticks, KEYS);
    expect(modelShots(log, blocked)).toEqual(shots);
    const states = run(place(maze, centre), log);
    expect(fireTicks(place(maze, centre), log)).toEqual(shots);
    for (const state of states) {
      for (const shot of state.shots) expect(shot).toMatchObject({ dx: 1 });
    }
  });

  it("holding a fire key into the wall fires nothing", () => {
    const states = run(place(maze, centre), repeat(fire(0, -1), 100));
    for (const state of states) expect(state.shots).toEqual([]);
  });
});

describe("2.2 Player / 2.5 Bullets: no shot is fired while Space is held", () => {
  it.each(DIRECTIONS)(
    "holding %s with Space fires nothing, standing or moving any way",
    (_name, fx, fy) => {
      for (const [moveName, mx, my] of MOVES) {
        const states = run(
          place(field, centre),
          repeat(input(mx, my, fx, fy, true), 100),
        );
        for (const [i, state] of states.entries()) {
          expect(state.shots, `moving ${moveName}, tick ${i + 1}`).toEqual([]);
        }
      }
    },
  );

  it("still moves the player fast while a fire key is held with Space", () => {
    const log = repeat(input(1, 0, 0, -1, true), 60);
    expect(moveTicks(place(field, centre), log)).toEqual(
      every(1, FAST_STEP_TICKS, 60),
    );
  });

  // x: fire right; X: fire right with Space; .: nothing held.
  const KEYS = {
    x: fire(1, 0),
    X: fire(1, 0, true),
    m: input(1, 0, 1, 0, true),
    ".": NO_INPUT,
  };
  const SCRIPTS: [what: string, ticks: string, shots: number[]][] = [
    ["Space released with no shot fired before", `${"X".repeat(20)}xxx`, [21]],
    ["Space released while moving", `${"m".repeat(20)}xxx`, [21]],
    ["Space held on the tick the wait ends", `x${".".repeat(12)}Xx`, [1, 15]],
    [
      "Space released during the wait",
      `x${"X".repeat(8)}${"x".repeat(10)}`,
      [1, 14],
    ],
    ["Space released after the wait", `x${"X".repeat(28)}x`, [1, 30]],
    ["Space held every other tick", "xX".repeat(20), [1, 15, 29]],
  ];

  it.each(SCRIPTS)("%s: %s fires on ticks %j", (_what, ticks, shots) => {
    const log = script(ticks, KEYS);
    expect(modelShots(log)).toEqual(shots);
    expect(fireTicks(place(field, centre), log)).toEqual(shots);
  });

  it("shots in flight fly on, one cell per tick, while Space is held", () => {
    const log = [fire(1, 1), ...repeat(input(-1, 0, 1, 1, true), 40)];
    const states = run(place(field, centre), log);
    const spawn = spawnFor(centre, 1, 1);
    states.forEach((state, i) => {
      expect(state.shots, `tick ${i + 1}`).toHaveLength(1);
      expect(state.shots[0]).toMatchObject({
        x: spawn.x + i,
        y: spawn.y + i,
      });
    });
  });
});
