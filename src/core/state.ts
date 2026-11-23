import { overlaps, wrap, type Box, type Grid, type Point } from "./grid";
import {
  HIVE_HITS,
  hitHives,
  hiveBox,
  placeHives,
  spawnSnipes,
  type Hive,
} from "./hives";
import { BLOCK_H, BLOCK_W, generateMazeFrom, WALL_X, WALL_Y } from "./maze";
import { movePlayer, playerBox, type Player } from "./player";
import { createRng, type Rng } from "./rng";
import { fireShot, moveShots, shotBox, type Shot } from "./shots";
import { HIVE_POINTS, levelBonus, SNIPE_POINTS } from "./score";
import {
  accuracy,
  checkSkill,
  hiveCount,
  maxEnemies,
  startLives,
} from "./skill";
import { snipeBox, stepSnipes, type Snipe } from "./snipes";

// Spec 2.10: the player starts and respawns as near the middle of a block as it can, leaning
// up-left: its footprint 5 open cells from the block's left wall and 3 from its top wall.
const START_X = WALL_X + 1 + 5;
const START_Y = WALL_Y + 1 + 3;

// Spec 2.6: the skill level of a game started without one.
const DEFAULT_SKILL = "A1";

// Spec 2.5: ticks from one shot to the next while a fire key is held.
const FIRE_TICKS = 13;

// Spec 2.2: the delay, in ticks, from the player's death until it comes back, or, after the
// last death, until the game is over.
const RESPAWN_TICKS = 120;

// Spec 2.2 and 2.8: the keys held this tick. y grows downwards, so up is moveY = -1 and
// fireY = -1.
export interface InputState {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  /** Space held: move faster. */
  readonly fast: boolean;
  readonly fireX: -1 | 0 | 1;
  readonly fireY: -1 | 0 | 1;
}

export const NO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  fast: false,
  fireX: 0,
  fireY: 0,
};

// Spec 3: a step being drawn sliding from the cell `from` to where it went, `age` ticks after
// the step, of the `ticks` until the next step is due.
export interface Slide {
  readonly from: Point;
  readonly ticks: number;
  readonly age: number;
}

// Spec 3: what the screen needs to draw motion sliding between cells. The rules never read it.
export interface Motion {
  /** The player's last step while it slides; undefined once it has arrived. */
  readonly player: Slide | undefined;
  /** The same for each of the snipes, in their order. */
  readonly snipes: readonly (Slide | undefined)[];
  /** How many of the shots, from the first, moved on this tick; the rest were fired on it. */
  readonly movedShots: number;
  readonly movedSnipeShots: number;
}

// Spec 4.3: the game state is plain data, created from a seed and changed only by step().
export interface GameState {
  /** Spec 2.6: the skill level, such as "A1". */
  readonly skill: string;
  readonly rng: Rng;
  readonly maze: Grid;
  readonly player: Player;
  /** The player's shots in flight. */
  readonly shots: readonly Shot[];
  /** Ticks left before the player may fire again. */
  readonly reload: number;
  /** Spec 3: the last firing direction, where the eyes look; (0, 0), ahead, at the start. */
  readonly aim: Point;
  /** Spec 2.3: the hives still alive. */
  readonly hives: readonly Hive[];
  /** Spec 2.4: the snipes on the map, in the order they appeared. */
  readonly snipes: readonly Snipe[];
  /** Spec 2.4: the snipes' shots in flight. */
  readonly snipeShots: readonly Shot[];
  /** Spec 2.2: the lives left, never below 0. */
  readonly lives: number;
  /** Spec 2.2: 0 while the player is in play; otherwise the ticks until it comes back. */
  readonly respawn: number;
  /** Spec 2.7: the score, which never goes down. */
  readonly score: number;
  /** Spec 2.7: no hive and no enemy is left, which wins the game. */
  readonly cleared: boolean;
  /** Spec 2.2: the game is lost: the last life was lost 120 ticks ago. */
  readonly gameOver: boolean;
  /** Spec 2.7: the ticks stepped since the new game, the time the level has taken. */
  readonly ticks: number;
  readonly motion: Motion;
}

// Spec 2.3 and 2.6: a new game at a skill level such as "A1"; anything other than a letter
// A to Z followed by a digit 1 to 9 is a RangeError.
export function createGame(seed: number, skill = DEFAULT_SKILL): GameState {
  checkSkill(skill);
  const [maze, afterMaze] = generateMazeFrom(createRng(seed));
  const player = { x: START_X, y: START_Y, wait: 0 };
  const [hives, rng] = placeHives(
    maze,
    afterMaze,
    hiveCount(skill),
    playerBox(player),
  );
  return {
    skill,
    rng,
    maze,
    player,
    shots: [],
    reload: 0,
    aim: { x: 0, y: 0 },
    hives,
    snipes: [],
    snipeShots: [],
    lives: startLives(skill),
    respawn: 0,
    score: 0,
    cleared: false,
    gameOver: false,
    ticks: 0,
    motion: {
      player: undefined,
      snipes: [],
      movedShots: 0,
      movedSnipeShots: 0,
    },
  };
}

// Spec 2.2 to 2.5 and 4.3, in this order: the shots in flight move on, and each one that is
// on a hive or snipe (fired onto it) or enters one hits it and disappears; a snipe's shot that
// reaches the player in play kills it at once. The hives that are due spawn their snipes, the
// player in play moves, and the snipes step and fire, in the order they appeared; a snipe that
// touches the player in play after it moves or after the snipes step kills it. While a fire
// key is held a new shot appears next to the player in play, independent of the way it moves,
// except while Space is held. A new shot stays where it appears until the next tick. The eyes
// turn to the direction of a shot fired. The steps and shot moves are kept for drawing them (3).
// Spec 2.7: the player's shots score their kills, and on the tick the last hive and snipe go,
// the level is cleared and the bonus added. Spec 2.2: the game is over at the end of the
// 120th tick after the last death, unless the level is cleared on or before it. A game that
// is won or over is returned unchanged.
export function step(state: GameState, input: InputState): GameState {
  if (state.cleared || state.gameOver) return state;
  const { maze } = state;
  // The targets of the shots: the hives, then the snipes, then (for the snipes' shots) the
  // player. A hit holds its target's index in this list.
  const targets = [...state.hives.map(hiveBox), ...state.snipes.map(snipeBox)];
  const flying = moveShots(maze, state.shots, targets);
  const enemy = moveShots(maze, state.snipeShots, [
    ...targets,
    ...(state.respawn === 0 ? [playerBox(state.player)] : []),
  ]);
  const hits = [...flying.hits, ...enemy.hits];
  const first = state.hives.length;
  const alive = (_: unknown, i: number) => !hits.includes(first + i);
  const survivors = state.snipes.filter(alive);
  const slides = state.motion.snipes.filter(alive);
  const spawned = spawnSnipes(
    maze,
    state.rng,
    hitHives(state.hives, hits),
    survivors,
    maxEnemies(state.skill),
  );
  const shotDown = enemy.hits.includes(targets.length);
  const inPlay = state.respawn === 0 && !shotDown;
  const moved = inPlay ? movePlayer(maze, state.player, input) : state.player;
  const touches = (all: readonly Snipe[]) =>
    inPlay && all.some((s) => overlaps(maze, snipeBox(s), playerBox(moved)));
  const touchedFirst = touches(spawned.snipes);
  const { rng, snipes, shots } = stepSnipes(
    maze,
    spawned.rng,
    spawned.hives.map(hiveBox),
    spawned.snipes,
    moved,
    accuracy(state.skill),
  );
  const snipeShots = [...enemy.shots, ...shots];
  // Spec 2.7: a hive or snipe destroyed on a tick on which a player's shot hit it scores once.
  const byPlayer = (i: number) => flying.hits.includes(i);
  const points =
    HIVE_POINTS *
      state.hives.filter(
        (h, i) =>
          byPlayer(i) &&
          h.hits + hits.filter((j) => j === i).length >= HIVE_HITS,
      ).length +
    SNIPE_POINTS * state.snipes.filter((_, i) => byPlayer(first + i)).length;
  const ticks = state.ticks + 1;
  const cleared = spawned.hives.length === 0 && snipes.length === 0;
  const life =
    shotDown || touchedFirst || touches(snipes)
      ? {
          player: moved,
          lives: Math.max(0, state.lives - 1),
          respawn: RESPAWN_TICKS,
        }
      : comeBack(state, moved, spawned.hives, [
          ...snipes.map(snipeBox),
          ...snipeShots.map(shotBox),
        ]);
  const shot =
    life.respawn > 0 || state.reload > 0 || input.fast
      ? undefined
      : fireShot(maze, playerBox(life.player), input.fireX, input.fireY);
  const motion = {
    // A player that dies goes on sliding, so that the view scrolls smoothly; on the tick it
    // comes back it appears in place.
    player:
      state.respawn > 0 && life.respawn === 0
        ? undefined
        : slide(state.player, life.player, state.motion.player),
    snipes: snipes.map((s, i) => slide(spawned.snipes[i], s, slides[i])),
    movedShots: flying.shots.length,
    movedSnipeShots: enemy.shots.length,
  };
  const bonus = cleared ? levelBonus(life.lives, ticks) : 0;
  const next = {
    ...state,
    ...life,
    score: state.score + points + bonus,
    cleared,
    gameOver: !cleared && life.lives === 0 && state.respawn === 1,
    ticks,
    rng,
    hives: spawned.hives,
    snipes,
    snipeShots,
    motion,
  };
  if (shot === undefined) {
    return {
      ...next,
      shots: flying.shots,
      reload: Math.max(0, state.reload - 1),
    };
  }
  return {
    ...next,
    shots: [...flying.shots, shot],
    reload: FIRE_TICKS - 1,
    aim: { x: shot.dx, y: shot.dy },
  };
}

// Spec 3: the slide of a player or snipe that was at `before` and is at `after` at the end of
// this tick, where `last` was its slide. A step starts a new slide that lasts until its next
// step is due, its wait plus this tick; otherwise the last slide goes on until then.
function slide(
  before: Point,
  after: Point & { readonly wait: number },
  last: Slide | undefined,
): Slide | undefined {
  if (before.x !== after.x || before.y !== after.y) {
    return {
      from: { x: before.x, y: before.y },
      ticks: after.wait + 1,
      age: 0,
    };
  }
  if (last === undefined || last.age + 1 >= last.ticks) return undefined;
  return { ...last, age: last.age + 1 };
}

// Spec 2.2 and 2.10: the player that was not killed this tick. In play it stays so. Out of
// play it waits; when the wait is over it comes back at a safe spot, or waits one more tick
// when there is none. With no lives left it never comes back.
function comeBack(
  state: GameState,
  player: Player,
  hives: readonly Hive[],
  dangers: readonly Box[],
): Pick<GameState, "player" | "lives" | "respawn"> {
  const { lives, respawn } = state;
  if (respawn !== 1) {
    return { player, lives, respawn: Math.max(0, respawn - 1) };
  }
  if (lives === 0) return { player, lives, respawn };
  const at = safeSpot(state.maze, player, hives, dangers);
  if (at === undefined) return { player, lives, respawn };
  return { player: { ...at, wait: 0 }, lives, respawn: 0 };
}

// Spec 2.2 and 2.10: the start position of the safe block farthest from the block of `from`
// (by |columns| + |rows| between them, with wrap-around; ties by row, then column), or
// undefined when no block is safe. A block is safe when none of `hives` has a cell in it and
// none of `dangers` has a cell in it or in the 8 blocks around it.
function safeSpot(
  maze: Grid,
  from: Point,
  hives: readonly Hive[],
  dangers: readonly Box[],
): Point | undefined {
  const cols = maze.width / BLOCK_W;
  const rows = maze.height / BLOCK_H;
  const offset = wrap(maze, { x: from.x - WALL_X, y: from.y - WALL_Y });
  const col = Math.floor(offset.x / BLOCK_W);
  const row = Math.floor(offset.y / BLOCK_H);
  const away = (a: number, b: number, size: number) =>
    Math.min(Math.abs(a - b), size - Math.abs(a - b));
  const blocks: { col: number; row: number; distance: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      blocks.push({
        col: c,
        row: r,
        distance: away(c, col, cols) + away(r, row, rows),
      });
    }
  }
  // The sort is stable, so blocks the same distance away stay in row, then column order.
  blocks.sort((a, b) => b.distance - a.distance);
  const safe = blocks.find(({ col: c, row: r }) => {
    const block = {
      x: WALL_X + c * BLOCK_W,
      y: WALL_Y + r * BLOCK_H,
      width: BLOCK_W,
      height: BLOCK_H,
    };
    const around = {
      x: block.x - BLOCK_W,
      y: block.y - BLOCK_H,
      width: 3 * BLOCK_W,
      height: 3 * BLOCK_H,
    };
    return (
      !hives.some((h) => overlaps(maze, hiveBox(h), block)) &&
      !dangers.some((d) => overlaps(maze, d, around))
    );
  });
  return (
    safe && { x: START_X + safe.col * BLOCK_W, y: START_Y + safe.row * BLOCK_H }
  );
}
