import { describe, expect, it } from "vitest";
import { cellAt, createGrid, type Grid, type Point } from "../../src/core/grid";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";
// Spec 2.7 (WP 13): the model check goes on after a level would be cleared; see play-on.ts.
import { playOn } from "../play-on";

// Spec 2.4, 2.6, 2.7, 2.10, 4.3, 6.2 and 9.1 WP 15: ghosts in rough grids and in whole games,
// run headless. `state.ghosts` are the ghosts in the order they appeared, each a 2 x 2
// footprint (`x`, `y` its top-left cell) with its direction (`dx`, `dy`), turning sense `turn`
// (1 clockwise on the screen, -1 anticlockwise) and `straight` (straight mode, 2.4).
//
// - Every step of every ghost is checked against the test's own model of 2.4: where it goes,
//   the direction it ends with, straight mode, the PRNG draws it uses (one `nextFloat` each,
//   in the order 2.4 gives, nothing else), whether it bursts, and when it steps next (3 ticks
//   after it appears, then every 5). The model's ghosts start as copies of one that has just
//   appeared, or of the same ghost two ticks later.
// - In whole games at letters with ghosts, every tick (6.2): no cell covered by a ghost is a
//   wall or a hive cell; no ghost moves onto the player in play; the snipes and ghosts stay
//   within the digit's maximum; the score never goes down; the level is marked cleared
//   exactly when no hive, snipe or ghost is left; and the same seed and input log give the
//   same game.

type Axis = InputState["moveX"];
type Dir = readonly [dx: Axis, dy: Axis];
type Snipe = GameState["snipes"][number];
type Ghost = GameState["ghosts"][number];
type Turn = Snipe["turn"];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PLAYER = 4;
const GHOST = 2;
const HIVE = 4;
const FIRST_STEP = 3; // 2.4: ticks from the tick a ghost appears to its first step
const GHOST_TICKS = 5; // 2.4: ticks from one step to the next
const MINUTE = 60 * 60;
const MAX_ENEMIES = [10, 20, 30, 40, 60, 80, 100, 120, 150]; // 2.6, digits 1 to 9
const NEVER = Number.MAX_SAFE_INTEGER; // a hive's wait that never runs out
const SLOW = 120_000;

const UP: Dir = [0, -1];
const UP_RIGHT: Dir = [1, -1];
const RIGHT: Dir = [1, 0];
const DOWN_RIGHT: Dir = [1, 1];
const DOWN: Dir = [0, 1];
const DOWN_LEFT: Dir = [-1, 1];
const LEFT: Dir = [-1, 0];
const UP_LEFT: Dir = [-1, -1];
// Spec 2.4: the 8 directions clockwise from up; a random direction is item floor(v * 8).
const CLOCKWISE: readonly Dir[] = [
  UP,
  UP_RIGHT,
  RIGHT,
  DOWN_RIGHT,
  DOWN,
  DOWN_LEFT,
  LEFT,
  UP_LEFT,
];
const AXES: Axis[] = [-1, 0, 1];

function same(a: Dir, b: Dir): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function index(d: Dir): number {
  return CLOCKWISE.findIndex((c) => same(c, d));
}

function rotate(d: Dir, k: number): Dir {
  return CLOCKWISE[(((index(d) + k) % 8) + 8) % 8];
}

function among(d: Dir, list: readonly Dir[]): boolean {
  return list.some((c) => same(c, d));
}

function dirOf(s: { readonly dx: number; readonly dy: number }): Dir {
  return [s.dx as Axis, s.dy as Axis];
}

function diagonal([dx, dy]: Dir): boolean {
  return dx !== 0 && dy !== 0;
}

function mod(n: number, size: number): number {
  return ((n % size) + size) % size;
}

function wrapped(maze: Grid, p: Point): Point {
  return { x: mod(p.x, maze.width), y: mod(p.y, maze.height) };
}

function drawer(seed: number): (n: number) => number {
  let rng: Rng = createRng(seed);
  return (n) => {
    const [value, next] = nextFloat(rng);
    rng = next;
    return Math.floor(value * n);
  };
}

function values(rng: Rng, n: number): number[] {
  const result: number[] = [];
  let r = rng;
  for (let i = 0; i < n; i++) {
    let v: number;
    [v, r] = nextFloat(r);
    result.push(v);
  }
  return result;
}

// How many draws lead from `before` to `after`; -1 if not 0 to 200.
function drawsUsed(before: Rng, after: Rng): number {
  let r = before;
  for (let n = 0; n <= 200; n++) {
    if (r.state === after.state) return n;
    r = nextFloat(r)[1];
  }
  return -1;
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

// Whether two boxes share a cell, with wrap-around.
function overlaps(maze: Grid, a: Box, b: Box): boolean {
  return (
    spans(a.x, a.width, b.x, b.width, maze.width) &&
    spans(a.y, a.height, b.y, b.height, maze.height)
  );
}

function spans(
  a: number,
  aLength: number,
  b: number,
  bLength: number,
  size: number,
): boolean {
  const offset = mod(a - b, size);
  return offset < bLength || offset > size - aLength;
}

function ghostBox(p: Point): Box {
  return { x: p.x, y: p.y, width: GHOST, height: GHOST };
}

function hiveBox(p: Point): Box {
  return { x: p.x, y: p.y, width: HIVE, height: HIVE };
}

function playerBox(p: Point): Box {
  return { x: p.x, y: p.y, width: PLAYER, height: PLAYER };
}

function where(p: Point): Point {
  return { x: p.x, y: p.y };
}

// --- The test's own model of a ghost's step (2.4) ------------------------------------------

// The shortest signed distance from a to b on an axis of `size` cells; exactly half the
// axis counts as positive.
function signed(a: number, b: number, size: number): number {
  const d = mod(b - a, size);
  return d > size / 2 ? d - size : d;
}

// Spec 2.4: the direction to the player and the distances in the original's cells.
function toward(maze: Grid, from: Point, player: Point) {
  const dx = signed(from.x, player.x, maze.width);
  const dy = signed(from.y, player.y, maze.height);
  let p: Dir;
  if (Math.abs(dx) < 2) p = [0, dy < 0 ? -1 : 1];
  else if (Math.abs(dy) < 2) p = [dx < 0 ? -1 : 1, 0];
  else p = [dx < 0 ? -1 : 1, dy < 0 ? -1 : 1];
  return {
    p,
    X: Math.floor(Math.abs(dx) / 2),
    Y: Math.floor(Math.abs(dy) / 2),
  };
}

interface World {
  readonly maze: Grid;
  readonly hives: readonly Point[];
}

// Spec 2.4: a footprint position blocked by a wall or a hive cell.
function blocked(world: World, p: Point): boolean {
  const box = ghostBox(p);
  return (
    !clear(world.maze, box) ||
    world.hives.some((h) => overlaps(world.maze, box, hiveBox(h)))
  );
}

interface Modelled {
  x: number;
  y: number;
  dir: Dir;
  turn: Turn;
  straight: boolean;
  due: number;
}

interface TickResult {
  readonly ghosts: Modelled[];
  readonly draws: number;
  readonly bursts: number;
}

// One tick of the ghosts, in their order. `player` is where the player is when the ghosts
// step (after its move, or where it died); `inPlay` whether it is in play then.
function modelTick(
  world: World,
  ghosts: readonly Modelled[],
  tick: number,
  player: Point,
  startsInPlay: boolean,
  chance: number,
  rng: Rng,
  kinds: Map<string, number>,
): TickResult {
  const { maze } = world;
  const vs = values(rng, 200);
  let draws = 0;
  const draw = (): number => vs[draws++];
  const note = (kind: string): void => {
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  };
  let inPlay = startsInPlay;
  let bursts = 0;
  const result: Modelled[] = [];
  for (const g of ghosts) {
    if (g.due !== tick) {
      result.push({ ...g });
      continue;
    }
    const from = { x: g.x, y: g.y };
    const open = (d: Dir): boolean => {
      const to = { x: from.x + d[0], y: from.y + d[1] };
      if (blocked(world, to)) return false;
      if (inPlay && overlaps(maze, ghostBox(to), playerBox(player))) {
        note("blocked by the player");
        return false;
      }
      if (diagonal(d)) {
        const across = { x: to.x, y: from.y };
        const down = { x: from.x, y: to.y };
        if (blocked(world, across) && blocked(world, down)) {
          note("corner gap");
          return false;
        }
      }
      return true;
    };
    let dir = g.dir;
    let straight = g.straight;
    let moved = false;
    const attempt = (d: Dir): boolean => {
      dir = d;
      moved = open(d);
      return moved;
    };
    let burst = false;
    if (!inPlay) note("player out of play");
    if (!straight) {
      const { p, X, Y } = toward(maze, from, player);
      let candidate: Dir | undefined;
      let done = false;
      if (
        inPlay &&
        X + Y <= 4 &&
        diagonal(p) &&
        overlaps(
          maze,
          ghostBox({ x: from.x + p[0], y: from.y + p[1] }),
          playerBox(player),
        )
      ) {
        if (draw() < chance) {
          burst = true;
          note("1.1 burst");
        } else {
          candidate = p;
          note("1.1 held");
        }
      } else if (Y === 1) {
        candidate = among(p, [DOWN, DOWN_LEFT, LEFT, UP_LEFT]) ? LEFT : RIGHT;
        note("1.2");
      } else if (Y === 0) {
        if (attempt(rotate(p, 1))) {
          done = true;
          note("1.3 clockwise");
        } else {
          candidate = rotate(p, -1);
          note("1.3 anticlockwise");
        }
      } else if (X === 1) {
        candidate = among(p, [UP_LEFT, UP, UP_RIGHT, RIGHT]) ? UP : DOWN;
        note("1.4");
      } else if (X === 0) {
        if (attempt(rotate(p, 2))) {
          done = true;
          note("1.5 clockwise");
        } else {
          candidate = rotate(p, -2);
          note("1.5 anticlockwise");
        }
      } else {
        candidate = p;
        note("1.6");
      }
      if (burst) {
        bursts++;
        inPlay = false;
        continue;
      }
      if (!done && candidate !== undefined) {
        if (attempt(candidate)) {
          done = true;
        } else {
          if (X + Y >= 20) {
            straight = true;
            note("1.7 straight mode on");
          }
          dir = CLOCKWISE[Math.floor(draw() * 8)];
          note("1.7 random");
        }
      }
      if (done) {
        const to = wrapped(maze, { x: from.x + dir[0], y: from.y + dir[1] });
        result.push({ ...g, ...to, dir, straight, due: tick + GHOST_TICKS });
        continue;
      }
    } else {
      note("straight mode");
    }
    // Step 2.
    const first = dir;
    for (let k = 0; k < 8 && !moved; k++) {
      if (!attempt(rotate(first, k * g.turn))) {
        straight = false;
        if (k === 0) note("2 blocked");
      }
    }
    if (!moved) note("2 all blocked");
    const to = moved
      ? wrapped(maze, { x: from.x + dir[0], y: from.y + dir[1] })
      : from;
    result.push({ ...g, ...to, dir, straight, due: tick + GHOST_TICKS });
  }
  return { ghosts: result, draws, bursts };
}

// --- Games ---------------------------------------------------------------------------------

const field = createGrid(320, 320, () => "open");

let snipeTemplate: Snipe | undefined;

// A snipe that has just appeared, spawned by a lone hive in the open.
function newSnipe(): Snipe {
  if (snipeTemplate !== undefined) return snipeTemplate;
  const game = createGame(1, "A9");
  let state: GameState = {
    ...game,
    maze: field,
    player: { ...game.player, x: 4, y: 4 },
    hives: [{ ...game.hives[0], x: 40, y: 30, hits: 0 }],
    snipes: [],
    shots: [],
    snipeShots: [],
  };
  for (let t = 0; t < 10 * MINUTE && state.snipes.length === 0; t++) {
    state = playOn(state, NO_INPUT);
  }
  if (state.snipes.length === 0) throw new Error("No snipe appeared");
  snipeTemplate = state.snipes[0];
  return snipeTemplate;
}

let ghostTemplates: { fresh: Ghost; ready: Ghost } | undefined;

// A ghost that has just appeared (its first step on the 3rd tick from then), from a snipe
// going right hit on its spear half (its right half), and the same ghost two ticks later (it
// steps on the next tick).
function templates(): { fresh: Ghost; ready: Ghost } {
  if (ghostTemplates !== undefined) return ghostTemplates;
  const game = createGame(1, "D1");
  const at = { x: 150, y: 150 };
  let state: GameState = playOn(
    {
      ...game,
      maze: field,
      player: { ...game.player, x: 20, y: 20 },
      hives: [],
      snipes: [{ ...newSnipe(), x: at.x, y: at.y, dx: 1, dy: 0 }],
      ghosts: [],
      shots: [{ x: at.x + 2, y: at.y, dx: 0, dy: 1 }],
      snipeShots: [],
    },
    NO_INPUT,
  );
  if (state.ghosts?.length !== 1) {
    throw new Error("No ghost appeared from a hit on a snipe's spear half");
  }
  const fresh = state.ghosts[0];
  state = playOn(playOn(state, NO_INPUT), NO_INPUT);
  ghostTemplates = { fresh, ready: state.ghosts[0] };
  return ghostTemplates;
}

// A rough, seeded grid: scattered wall cells at one of three densities, and here and there
// two wall cells that make a corner gap for a ghost.
function roughGrid(draw: (n: number) => number, width: number, height: number) {
  const density = [14, 7, 3][draw(3)];
  const walls = new Set<string>();
  const add = (x: number, y: number): void => {
    walls.add(`${mod(x, width)},${mod(y, height)}`);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (draw(density) === 0) add(x, y);
      if (draw(60) === 0) {
        add(x + GHOST, y);
        add(x, y + GHOST);
      }
    }
  }
  return createGrid(width, height, ({ x, y }) =>
    walls.has(`${x},${y}`) ? "wall" : "open",
  );
}

function randomSpot(
  draw: (n: number) => number,
  maze: Grid,
  ok: (p: Point) => boolean,
  near?: Point,
  within = 12,
): Point | undefined {
  for (let tries = 0; tries < 500; tries++) {
    const p =
      near === undefined
        ? { x: draw(maze.width), y: draw(maze.height) }
        : wrapped(maze, {
            x: near.x - within + draw(2 * within + 1),
            y: near.y - within + draw(2 * within + 1),
          });
    if (ok(p)) return p;
  }
  return undefined;
}

const MOVES: InputState[] = AXES.flatMap((moveX) =>
  AXES.flatMap((moveY) =>
    [false, true].map((fast) => ({ ...NO_INPUT, moveX, moveY, fast })),
  ),
);

// ===========================================================================================

describe("2.4 Ghosts: every step follows the rules, in rough grids with hives", () => {
  it(
    "matches the test's model in place, direction, straight mode, PRNG draws, bursts and timing",
    () => {
      const { fresh, ready } = templates();
      const problems: string[] = [];
      const kinds = new Map<string, number>();
      let steps = 0;
      for (let n = 0; n < 40 && problems.length < 5; n++) {
        const draw = drawer(5000 + n);
        const [width, height] = [
          [64, 48],
          [96, 72],
          [48, 40],
        ][draw(3)];
        const maze = roughGrid(draw, width, height);
        const hives: Point[] = [];
        for (let h = draw(5); h > 0; h--) {
          const p = randomSpot(draw, maze, (q) => clear(maze, hiveBox(q)));
          if (p) hives.push(p);
        }
        const world = { maze, hives };
        const start = randomSpot(
          draw,
          maze,
          (q) =>
            clear(maze, playerBox(q)) &&
            hives.every((h) => !overlaps(maze, hiveBox(h), playerBox(q))),
        );
        if (!start) continue;
        // 15 to 24 ghosts near the player, so that the enemies always number at least the
        // digit's maximum (10 at F1) and the hives never spawn.
        let model: Modelled[] = [];
        const count = 15 + draw(10);
        for (let i = 0; i < count; i++) {
          const p = randomSpot(
            draw,
            maze,
            (q) => !blocked(world, q),
            start,
            draw(2) === 0 ? 6 : 20,
          );
          if (!p) continue;
          const isFresh = draw(2) === 0;
          model.push({
            ...p,
            dir: CLOCKWISE[draw(8)],
            turn: draw(2) === 0 ? 1 : -1,
            straight: draw(3) === 0,
            due: isFresh ? FIRST_STEP : 1,
          });
        }
        const game = createGame(1, "F1");
        const chance = 1 / 64;
        let state: GameState = {
          ...game,
          maze,
          player: { ...game.player, ...start },
          hives: hives.map((h) => ({
            ...game.hives[0],
            ...h,
            hits: 0,
            wait: NEVER,
          })),
          snipes: [],
          snipeShots: [],
          shots: [],
          lives: 1000,
          rng: createRng(draw(2 ** 30)),
          // Copies of the templates, which keep the template's own fields, whatever they are.
          ghosts: model.map((g) => ({
            ...(g.due === FIRST_STEP ? fresh : ready),
            x: g.x,
            y: g.y,
            dx: g.dir[0],
            dy: g.dir[1],
            turn: g.turn,
            straight: g.straight,
          })),
        };
        let input = NO_INPUT;
        for (let tick = 1; tick <= 300 && problems.length < 5; tick++) {
          if (tick % 8 === 1) input = MOVES[draw(MOVES.length)];
          const before = state;
          state = playOn(state, input);
          const inPlay = before.respawn === 0;
          const player = inPlay ? where(state.player) : where(before.player);
          const expected = modelTick(
            world,
            model,
            tick,
            player,
            inPlay,
            chance,
            before.rng,
            kinds,
          );
          const what = `case ${n}, tick ${tick}`;
          const got = state.ghosts.map((g) => ({
            x: g.x,
            y: g.y,
            dir: `${g.dx},${g.dy}`,
            turn: g.turn,
            straight: g.straight,
          }));
          const want = expected.ghosts.map((g) => ({
            x: g.x,
            y: g.y,
            dir: g.dir.join(","),
            turn: g.turn,
            straight: g.straight,
          }));
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            problems.push(
              `${what}: ghosts ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
            );
            break;
          }
          const draws = drawsUsed(before.rng, state.rng);
          if (draws !== expected.draws) {
            problems.push(`${what}: ${draws} draws, want ${expected.draws}`);
            break;
          }
          if (state.lives !== before.lives - Math.min(1, expected.bursts)) {
            problems.push(
              `${what}: lives ${before.lives} to ${state.lives} with ${expected.bursts} bursts`,
            );
            break;
          }
          if (state.snipes.length > 0 || state.snipeShots.length > 0) {
            problems.push(`${what}: a snipe or a snipe's shot appeared`);
            break;
          }
          steps += model.filter((g) => g.due === tick).length;
          model = expected.ghosts;
        }
      }
      expect(problems).toEqual([]);
      expect(steps).toBeGreaterThan(5000);
      // Guard: the cases reached every part of the rule.
      for (const kind of [
        "1.1 burst",
        "1.1 held",
        "1.2",
        "1.3 clockwise",
        "1.3 anticlockwise",
        "1.4",
        "1.5 clockwise",
        "1.5 anticlockwise",
        "1.6",
        "1.7 random",
        "1.7 straight mode on",
        "straight mode",
        "2 blocked",
        "2 all blocked",
        "blocked by the player",
        "corner gap",
        "player out of play",
      ]) {
        expect(kinds.get(kind) ?? 0, kind).toBeGreaterThan(0);
      }
    },
    SLOW,
  );
});

// --- Whole games ---------------------------------------------------------------------------

// A scripted input log: moving and firing in directions that change now and then.
function inputLog(seed: number, ticks: number): InputState[] {
  const draw = drawer(seed);
  const log: InputState[] = [];
  let keys = NO_INPUT;
  for (let t = 0; t < ticks; t++) {
    if (t % 30 === 0) {
      const fire = CLOCKWISE[draw(8)];
      keys = {
        moveX: AXES[draw(3)],
        moveY: AXES[draw(3)],
        fast: draw(6) === 0,
        fireX: fire[0],
        fireY: fire[1],
      };
    }
    log.push(keys);
  }
  return log;
}

interface Watch {
  readonly problems: string[];
  ghostsSeen: number;
  ghostsGone: number;
}

// Spec 6.2: the invariants, checked on every tick from `before` to `after`.
function check(
  watch: Watch,
  before: GameState,
  after: GameState,
  max: number,
  tick: number,
): void {
  const { maze } = after;
  const report = (what: string): void => {
    if (watch.problems.length < 10)
      watch.problems.push(`tick ${tick}: ${what}`);
  };
  watch.ghostsSeen = Math.max(watch.ghostsSeen, after.ghosts.length);
  if (after.ghosts.length < before.ghosts.length) watch.ghostsGone++;
  for (const g of after.ghosts) {
    const box = ghostBox(g);
    if (!clear(maze, box)) report(`a ghost covers a wall at ${g.x},${g.y}`);
    if (after.hives.some((h) => overlaps(maze, box, hiveBox(h)))) {
      report(`a ghost covers a hive cell at ${g.x},${g.y}`);
    }
    if (
      !CLOCKWISE.some((d) => same(d, dirOf(g))) ||
      (g.turn !== 1 && g.turn !== -1) ||
      typeof g.straight !== "boolean"
    ) {
      report(`a ghost is not a ghost: ${JSON.stringify(g)}`);
    }
  }
  // No ghost moves onto the player in play: a ghost overlapping the player, which was in play
  // all tick, is where a ghost was before the tick.
  if (before.respawn === 0 && after.respawn === 0) {
    const player = playerBox(after.player);
    for (const g of after.ghosts) {
      if (
        overlaps(maze, ghostBox(g), player) &&
        !before.ghosts.some((b) => b.x === g.x && b.y === g.y)
      ) {
        report(`a ghost moved onto the player at ${g.x},${g.y}`);
      }
    }
  }
  if (after.snipes.length + after.ghosts.length > max) {
    report(
      `${after.snipes.length} snipes and ${after.ghosts.length} ghosts, more than ${max}`,
    );
  }
  if (after.score < before.score) {
    report(`the score went down from ${before.score} to ${after.score}`);
  }
  const empty =
    after.hives.length + after.snipes.length + after.ghosts.length === 0;
  if (after.cleared !== empty) {
    report(
      `cleared is ${after.cleared} with ${JSON.stringify({
        hives: after.hives.length,
        snipes: after.snipes.length,
        ghosts: after.ghosts.length,
      })}`,
    );
  }
}

function play(
  seed: number,
  skill: string,
  ticks: number,
): { watch: Watch; state: GameState } {
  let state: GameState = { ...createGame(seed, skill), lives: 1000 };
  const max = MAX_ENEMIES[Number(skill[1]) - 1];
  const watch: Watch = { problems: [], ghostsSeen: 0, ghostsGone: 0 };
  for (const [i, keys] of inputLog(seed + 1, ticks).entries()) {
    const before = state;
    state = step(state, keys);
    check(watch, before, state, max, i + 1);
    if (state.cleared || state.gameOver) break;
  }
  return { watch, state };
}

describe("6.2 Invariants: ghosts in whole games at letters with ghosts", () => {
  const cases = [
    [11, "D9"],
    [12, "E5"],
    [13, "F2"],
    [14, "K7"],
    [15, "Z9"],
  ] as const;

  it.each(cases)(
    "seed %d at %s, two minutes of moving and firing",
    (seed, skill) => {
      const { watch } = play(seed, skill, 2 * MINUTE);
      expect(watch.problems).toEqual([]);
    },
    SLOW,
  );

  it(
    "ghosts appear and go in these games",
    () => {
      // Guard: the checks above saw ghosts, so they checked something.
      let seen = 0;
      let gone = 0;
      for (const [seed, skill] of cases) {
        const { watch } = play(seed, skill, 2 * MINUTE);
        seen += watch.ghostsSeen;
        gone += watch.ghostsGone;
      }
      expect(seen).toBeGreaterThan(5);
      expect(gone).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "no ghost appears at the letters without ghosts",
    () => {
      for (const [seed, skill] of [
        [21, "A9"],
        [22, "G5"],
        [23, "M9"],
      ] as const) {
        let state = { ...createGame(seed, skill), lives: 1000 };
        let snipesKilled = 0;
        for (const keys of inputLog(seed, MINUTE)) {
          const before = state;
          state = step(state, keys);
          expect(state.ghosts, skill).toEqual([]);
          if (state.snipes.length < before.snipes.length) snipesKilled++;
          if (state.cleared || state.gameOver) break;
        }
        // Guard: snipes were killed, so ghosts could have appeared.
        expect(snipesKilled, skill).toBeGreaterThan(0);
      }
    },
    SLOW,
  );
});

describe("6.2 Determinism with ghosts", () => {
  // At F9, ghosts and no other feature (2.6), so that the guard below does not depend on how
  // bouncing shots (WP 16) or deadly walls (WP 17) change the game.
  it.each([0, 1, 42, 2 ** 32 - 1])(
    "seed %d at F9 and the same input log give the same game, ghosts and all",
    (seed) => {
      const log = inputLog(seed + 9, MINUTE);
      let a = createGame(seed, "F9");
      let b = createGame(seed, "F9");
      let ghosts = 0;
      for (const keys of log) {
        a = step(a, keys);
        b = step(b, keys);
        ghosts = Math.max(ghosts, a.ghosts.length);
      }
      expect(a).toEqual(b);
      expect(ghosts).toBeGreaterThan(0);
    },
    SLOW,
  );
});
