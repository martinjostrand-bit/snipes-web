import { cellAt, type Grid, type Point } from "../../src/core/grid";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";
import {
  hiveBox,
  onCanvas,
  overlaps,
  playerBox,
  shotBox,
  snipeBox,
  TICKS_PER_SECOND,
  viewOrigin,
  type Box,
} from "./game";

// Spec 2.4, 3 and 9.1 WP 15: games with ghosts, worked out in Node with the game's own core
// (see game.ts). The page plays `createGame(seed, skill)` at the skill level typed on the title
// screen, and a key held from the game's first tick gives the same game as in Node.
//
// `state.ghosts` are the ghosts in the order they appeared, each a 2 x 2 footprint whose
// top-left cell is (`x`, `y`) (2.10).

type Axis = InputState["moveX"];

export const GHOST = 2;

export function ghostBox(p: Point): Box {
  return { x: p.x, y: p.y, width: GHOST, height: GHOST };
}

const FIRE_KEYS: readonly [key: string, fireX: Axis, fireY: Axis][] = [
  ["KeyA", -1, 0],
  ["KeyD", 1, 0],
  ["KeyW", 0, -1],
  ["KeyS", 0, 1],
];

// Games are searched only for their first 20 seconds, so that the page reaches the tick soon
// also in slow browsers.
const SEARCH_TICKS = 20 * TICKS_PER_SECOND;

// The states of the game of `seed` at `skill` with one input held from the first tick, tick 0
// being the new game, until the game is won or over or `ticks` have run.
function playOut(
  seed: number,
  skill: string,
  input: InputState,
  ticks: number,
): GameState[] {
  const states = [createGame(seed, skill)];
  for (let tick = 1; tick <= ticks; tick++) {
    const state = step(states[tick - 1], input);
    states.push(state);
    if (state.cleared || state.gameOver) break;
  }
  return states;
}

// The smallest box, not wrapped, that holds all the boxes, measured the short way round from
// the first.
function union(maze: Grid, boxes: readonly Box[]): Box {
  const [a] = boxes;
  let left = a.x;
  let top = a.y;
  let right = a.x + a.width;
  let bottom = a.y + a.height;
  for (const b of boxes) {
    const half = (size: number) => size / 2;
    const dx =
      ((((b.x - a.x + half(maze.width)) % maze.width) + maze.width) %
        maze.width) -
      half(maze.width);
    const dy =
      ((((b.y - a.y + half(maze.height)) % maze.height) + maze.height) %
        maze.height) -
      half(maze.height);
    left = Math.min(left, a.x + dx);
    top = Math.min(top, a.y + dy);
    right = Math.max(right, a.x + dx + b.width);
    bottom = Math.max(bottom, a.y + dy + b.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function grow(box: Box, by: number): Box {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + 2 * by,
    height: box.height + 2 * by,
  };
}

function clear(maze: Grid, box: Box): boolean {
  for (let dy = 0; dy < box.height; dy++) {
    for (let dx = 0; dx < box.width; dx++) {
      if (cellAt(maze, { x: box.x + dx, y: box.y + dy }) === "wall") {
        return false;
      }
    }
  }
  return true;
}

// Whether nothing but the entity `except` covers a cell of `box` in `state`: no hive, snipe,
// ghost, shot, snipe's shot or player.
function aloneIn(
  state: GameState,
  box: Box,
  except: { kind: "snipe" | "ghost"; index: number },
): boolean {
  const { maze } = state;
  const near = (b: Box) => overlaps(maze, box, b);
  return (
    !state.hives.some((h) => near(hiveBox(h))) &&
    !state.snipes.some(
      (s, i) =>
        !(except.kind === "snipe" && i === except.index) && near(snipeBox(s)),
    ) &&
    // A game without ghosts (A1, where the snipe tests look) has none to check.
    !(state.ghosts ?? []).some(
      (g, i) =>
        !(except.kind === "ghost" && i === except.index) && near(ghostBox(g)),
    ) &&
    !state.shots.some((s) => near(shotBox(s))) &&
    !state.snipeShots.some((s) => near(shotBox(s))) &&
    !near(playerBox(state.player))
  );
}

// --- The HUD with ghosts -------------------------------------------------------------------

export interface GhostHud {
  readonly seed: number;
  readonly skill: string;
  /** The fire key held from the game's first tick. */
  readonly key: string;
  /** A tick around which, for 10 ticks either way, what the HUD shows stays the same. */
  readonly tick: number;
  readonly state: GameState;
}

let ghostHud: GhostHud | undefined;

// Spec 2.6 and 3: at D1 (ghosts on), holding one fire key from the first tick, the first tick
// with a ghost on the map around which, for 10 ticks either way, the score, the lives, the
// hives, the snipes and the ghosts stay the same, and the player stays in play.
export function ghostsOnHud(): GhostHud {
  if (ghostHud !== undefined) return ghostHud;
  const skill = "D1";
  const same = (a: GameState, b: GameState): boolean =>
    a.score === b.score &&
    a.lives === b.lives &&
    a.respawn === 0 &&
    a.hives.length === b.hives.length &&
    a.snipes.length === b.snipes.length &&
    a.ghosts.length === b.ghosts.length;
  for (let seed = 1; seed <= 3000; seed++) {
    for (const [key, fireX, fireY] of FIRE_KEYS) {
      const states = playOut(
        seed,
        skill,
        { ...NO_INPUT, fireX, fireY },
        SEARCH_TICKS,
      );
      for (let tick = 10; tick + 10 < states.length; tick++) {
        if (states[tick].ghosts.length === 0) continue;
        let steady = true;
        for (let t = tick - 10; t <= tick + 10 && steady; t++) {
          steady = same(states[t], states[tick]);
        }
        if (steady) {
          ghostHud = { seed, skill, key, tick, state: states[tick] };
          return ghostHud;
        }
      }
    }
  }
  throw new Error("No game at D1 with ghosts on the map for a while");
}

// --- A ghost or a snipe in the view --------------------------------------------------------

export interface InSight {
  readonly seed: number;
  readonly skill: string;
  /** The fire key held from the game's first tick, if any. */
  readonly key: string | undefined;
  /** The tick to look at, counted from the start of the game. */
  readonly tick: number;
  /** Where on the canvas the entity is drawn around that tick, and nothing else. */
  readonly area: Box;
  readonly state: GameState;
}

// The ticks around `tick` whose positions the area must hold: the drawn position slides from
// the cell of the last step (3), which is at most 13 ticks old for a snipe and 5 for a ghost,
// and the page may be a tick or two off the one asked for.
const BEFORE = 14;
const AFTER = 3;

let ghostSight: InSight | undefined;

// Spec 2.4 and 3: at D1, holding one fire key from the first tick, without moving, a ghost in
// the start view that is alone, away from walls and everything else, from 14 ticks before a
// tick to 3 after it, while the player stays in play (so the view does not move).
export function ghostInSight(): InSight {
  if (ghostSight !== undefined) return ghostSight;
  const skill = "D1";
  for (let seed = 1; seed <= 3000; seed++) {
    for (const [key, fireX, fireY] of FIRE_KEYS) {
      const states = playOut(
        seed,
        skill,
        { ...NO_INPUT, fireX, fireY },
        SEARCH_TICKS,
      );
      const found = alone(states, "ghost", () => true);
      if (found !== undefined) {
        ghostSight = { seed, skill, key, ...found };
        return ghostSight;
      }
    }
  }
  throw new Error("No game at D1 with a ghost alone in the view");
}

// Spec 2.4: the directions whose face half is the right half: down-left, left, up-left.
export function facesRight(s: { readonly dx: number }): boolean {
  return s.dx < 0;
}

const snipeSights = new Map<boolean, InSight>();

// Spec 2.4 and 3: at A1, with no key held, a snipe in the start view going one way, with its
// face on its right half (`right`) or on its left half, that is alone, away from walls and
// everything else, from 14 ticks before a tick to 3 after it, going the same way all that
// time, while the player stays in play.
export function snipeFacing(right: boolean): InSight {
  const known = snipeSights.get(right);
  if (known !== undefined) return known;
  const skill = "A1";
  for (let seed = 1; seed <= 3000; seed++) {
    const states = playOut(seed, skill, NO_INPUT, 30 * TICKS_PER_SECOND);
    const found = alone(states, "snipe", (s) => facesRight(s) === right);
    if (found !== undefined) {
      const sight = { seed, skill, key: undefined, ...found };
      snipeSights.set(right, sight);
      return sight;
    }
  }
  throw new Error(`No game with a snipe facing ${right ? "right" : "left"}`);
}

interface Entity {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

// The first tick of `states` at which an entity of `kind` that `ok` accepts is alone in the
// view as described above, the area it is drawn in, and the state then.
function alone(
  states: readonly GameState[],
  kind: "snipe" | "ghost",
  ok: (e: Entity) => boolean,
): { tick: number; area: Box; state: GameState } | undefined {
  const first = states[0];
  const { maze } = first;
  const origin = viewOrigin(maze, first.player);
  const list = (s: GameState): readonly Entity[] =>
    kind === "snipe" ? s.snipes : s.ghosts;
  const box = kind === "snipe" ? snipeBox : ghostBox;
  for (let tick = BEFORE; tick + AFTER < states.length; tick++) {
    const at = states[tick];
    if (at.lives !== first.lives) return undefined;
    for (let index = 0; index < list(at).length; index++) {
      const e = list(at)[index];
      if (!ok(e)) continue;
      const window = states.slice(tick - BEFORE, tick + AFTER + 1);
      // The same entity all along: the one at this place in the list moves at most one cell a
      // tick and goes the same way, and nothing else of its kind is near it.
      const path: Entity[] = [];
      let same = true;
      for (const s of window) {
        const here = list(s)[index] as Entity | undefined;
        if (
          here === undefined ||
          here.dx !== e.dx ||
          here.dy !== e.dy ||
          s.lives !== first.lives ||
          s.respawn !== 0
        ) {
          same = false;
          break;
        }
        path.push(here);
      }
      if (!same) continue;
      for (let i = 1; i < path.length && same; i++) {
        same =
          Math.abs(path[i].x - path[i - 1].x) <= 1 &&
          Math.abs(path[i].y - path[i - 1].y) <= 1;
      }
      if (!same) continue;
      const area = union(maze, path.map(box));
      const margin = grow(area, 1);
      const drawn = onCanvas(maze, origin, margin);
      if (drawn === undefined || !clear(maze, margin)) continue;
      if (!window.every((s) => aloneIn(s, margin, { kind, index }))) continue;
      const canvasArea = onCanvas(maze, origin, area);
      if (canvasArea === undefined) continue;
      return { tick, area: canvasArea, state: at };
    }
  }
  return undefined;
}
