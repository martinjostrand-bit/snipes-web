import { overlaps, wrap, type Box, type Grid, type Point } from "./grid";
import { playerBox } from "./player";
import { nextFloat, type Rng } from "./rng";
import {
  canStep,
  DIRECTIONS,
  directionIndex,
  facesRight,
  toward,
  type Snipe,
  type Turn,
} from "./snipes";

// Spec 2.10: a ghost covers GHOST_SIZE x GHOST_SIZE cells; its position is its top-left cell.
export const GHOST_SIZE = 2;

// Spec 2.4: a ghost's first step is due 3 ticks after the tick it appears, then one every 5.
const FIRST_STEP_TICKS = 3;
const STEP_TICKS = 5;
// Spec 2.4: the largest X + Y at which a ghost may burst, and the smallest at which a blocked
// candidate turns straight mode on.
const BURST_RANGE = 4;
const STRAIGHT_RANGE = 20;
// Spec 2.4: directions by their place in DIRECTIONS.
const UP = 0;
const RIGHT = 2;
const DOWN = 4;
const LEFT = 6;
const UP_LEFT = 7;

export interface Ghost {
  readonly x: number;
  readonly y: number;
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
  /** 1 turns clockwise on the screen, -1 anticlockwise. */
  readonly turn: Turn;
  /** Spec 2.4: whether it is in straight mode. */
  readonly straight: boolean;
  /** Ticks left before the ghost takes its next step. */
  readonly wait: number;
}

export function ghostBox(ghost: Point): Box {
  return { x: ghost.x, y: ghost.y, width: GHOST_SIZE, height: GHOST_SIZE };
}

// Spec 2.4: the ghost a snipe hit on its spear half leaves on its face half, with the snipe's
// direction and turning sense, not in straight mode. It counts down in the tick it appears, so
// its first step is on the 3rd tick after it.
export function ghostFrom(maze: Grid, snipe: Snipe): Ghost {
  const face = wrap(maze, {
    x: snipe.x + (facesRight(snipe) ? GHOST_SIZE : 0),
    y: snipe.y,
  });
  return {
    ...face,
    dx: snipe.dx,
    dy: snipe.dy,
    turn: snipe.turn,
    straight: false,
    wait: FIRST_STEP_TICKS,
  };
}

// Spec 2.4 and 4.3: every ghost whose wait is over steps, in the order they appeared. `hives`
// block them, and so does the player at `player` while `inPlay`; while it is out of play they
// head for where it died. Returns the ghosts and the index of the one that burst, killing the
// player, or -1. After a burst the player is out of play for the ghosts that step later.
export function stepGhosts(
  maze: Grid,
  start: Rng,
  hives: readonly Box[],
  ghosts: readonly Ghost[],
  player: Point,
  inPlay: boolean,
  burstChance: number,
): { rng: Rng; ghosts: Ghost[]; burst: number } {
  let rng = start;
  let burst = -1;
  const next: Ghost[] = [];
  ghosts.forEach((ghost, i) => {
    if (ghost.wait > 0) {
      next.push({ ...ghost, wait: ghost.wait - 1 });
      return;
    }
    let moved: Ghost | undefined;
    [moved, rng] = moveGhost(
      maze,
      rng,
      hives,
      ghost,
      player,
      inPlay && burst < 0,
      burstChance,
    );
    if (moved === undefined) burst = i;
    else next.push(moved);
  });
  return { rng, ghosts: next, burst };
}

// Spec 2.4: one step by the original's heading rule. Out of straight mode a ghost next to the
// player on a diagonal may burst (undefined); otherwise it tries a candidate from the distances
// X and Y and the direction P to the player, and if that is blocked it draws a random
// direction, turning straight mode on when the player is far. From there, and in straight
// mode, it turns one-eighth at a time in its own sense until a way is open.
function moveGhost(
  maze: Grid,
  start: Rng,
  hives: readonly Box[],
  ghost: Ghost,
  player: Point,
  inPlay: boolean,
  burstChance: number,
): [ghost: Ghost | undefined, next: Rng] {
  let rng = start;
  const to = (i: number): Point => {
    const [dx, dy] = DIRECTIONS[i];
    return wrap(maze, { x: ghost.x + dx, y: ghost.y + dy });
  };
  const onPlayer = (i: number): boolean =>
    overlaps(maze, ghostBox(to(i)), playerBox(player));
  // Spec 2.4: overlapping the player blocks a step only while it is in play, and does not
  // count in the corner-gap test.
  const open = (i: number): boolean =>
    canStep(maze, hives, ghostBox(ghost), i) && !(inPlay && onPlayer(i));
  const turned = (i: number, k: number): number =>
    (((i + k) % DIRECTIONS.length) + DIRECTIONS.length) % DIRECTIONS.length;
  const go = (i: number, straight: boolean): [Ghost, Rng] => {
    const [dx, dy] = DIRECTIONS[i];
    return [
      { ...ghost, ...to(i), dx, dy, straight, wait: STEP_TICKS - 1 },
      rng,
    ];
  };
  let dir = directionIndex(ghost.dx, ghost.dy);
  let straight = ghost.straight;
  if (!straight) {
    const { dir: p, dx, dy } = toward(maze, ghost, player);
    const X = Math.floor(Math.abs(dx) / 2);
    const Y = Math.floor(Math.abs(dy) / 2);
    const diagonal = p % 2 === 1;
    let candidate: number;
    if (inPlay && X + Y <= BURST_RANGE && diagonal && onPlayer(p)) {
      // 1.1: on failure the candidate is P, skipping the side steps, as in the original.
      let v: number;
      [v, rng] = nextFloat(rng);
      if (v < burstChance) return [undefined, rng];
      candidate = p;
    } else if (Y === 1) {
      // 1.2: left when P is down, down-left, left or up-left, else right.
      candidate = p >= DOWN ? LEFT : RIGHT;
    } else if (Y === 0) {
      // 1.3
      if (open(turned(p, 1))) return go(turned(p, 1), false);
      candidate = turned(p, -1);
    } else if (X === 1) {
      // 1.4: up when P is up-left, up, up-right or right, else down.
      candidate = p === UP_LEFT || p <= RIGHT ? UP : DOWN;
    } else if (X === 0) {
      // 1.5
      if (open(turned(p, 2))) return go(turned(p, 2), false);
      candidate = turned(p, -2);
    } else {
      // 1.6
      candidate = p;
    }
    // 1.7
    if (open(candidate)) return go(candidate, false);
    if (X + Y >= STRAIGHT_RANGE) straight = true;
    let v: number;
    [v, rng] = nextFloat(rng);
    dir = Math.floor(v * DIRECTIONS.length);
  }
  // 2: straight mode turns off at the first blocked try.
  for (let k = 0; k < DIRECTIONS.length; k++) {
    const i = turned(dir, k * ghost.turn);
    if (open(i)) return go(i, straight);
    straight = false;
  }
  const [dx, dy] =
    DIRECTIONS[turned(dir, (DIRECTIONS.length - 1) * ghost.turn)];
  return [{ ...ghost, dx, dy, straight, wait: STEP_TICKS - 1 }, rng];
}
