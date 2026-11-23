import { expect, type Page } from "@playwright/test";
import {
  createGame,
  NO_INPUT,
  step,
  type GameState,
  type InputState,
} from "../../src/core/state";
import { canvasLabel } from "./canvas";
import { hiveInSight, TICKS_PER_SECOND } from "./game";

// Spec 3 and 9.1 WP 13: the screens, read through the canvas's accessible name. The canvas
// text is invisible to screen readers and tests, so the page repeats the text of the screen
// it shows in the canvas's `aria-label`, as it has done for the title and version since M0:
//
// - title: the name and version ("Snipes Web v0.5.0"), the skill level shown (such as "A1")
//   and the best score for it ("Best: 0", "Best 0" or "Best score: 0");
// - playing: the HUD: the score ("Score: 120"), the lives ("Lives: 3"), the skill level, the
//   hives left ("Hives: 2") and the enemies left ("Snipes: 4" or "Enemies: 4");
// - paused: "Paused" (with the HUD, or not);
// - won and game over: "You won" or "Game over", the score, the best score for the skill level
//   and, only when the score is a new best, "New best!".
//
// A label like "Score 120" may have a colon after the word; letters may be in any case. The
// skill level is a capital letter A to Z followed by a digit 1 to 9, standing alone.

export type Screen = "title" | "playing" | "paused" | "won" | "over";

const PAUSED = /\bpaused\b/i;
const WON = /\byou won\b/i;
const OVER = /\bgame over\b/i;
const NEW_BEST = /\bnew best!/i;
const SCORE = /(?<!best\s)\bscore\b:?\s*(\d+)/i;
const BEST = /\bbest\b(?:\s+score)?:?\s*(\d+)/i;
const LIVES = /\blives\b:?\s*(\d+)/i;
const HIVES = /\bhives\b:?\s*(\d+)/i;
const ENEMIES = /\b(?:snipes|enemies)\b:?\s*(\d+)/i;
const SKILL = /\b([A-Z][1-9])\b/;

// Which screen a label shows, or undefined if none.
export function screenOf(label: string): Screen | undefined {
  if (PAUSED.test(label)) return "paused";
  if (WON.test(label)) return "won";
  if (OVER.test(label)) return "over";
  if (LIVES.test(label)) return "playing";
  if (label.includes("Snipes Web")) return "title";
  return undefined;
}

function numberIn(label: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(label);
  return match === null ? undefined : Number(match[1]);
}

export interface Shown {
  readonly label: string;
  readonly screen: Screen | undefined;
  readonly skill: string | undefined;
  readonly score: number | undefined;
  readonly best: number | undefined;
  readonly newBest: boolean;
  readonly lives: number | undefined;
  readonly hives: number | undefined;
  readonly enemies: number | undefined;
}

export function read(label: string): Shown {
  return {
    label,
    screen: screenOf(label),
    skill: SKILL.exec(label)?.[1],
    score: numberIn(label, SCORE),
    best: numberIn(label, BEST),
    newBest: NEW_BEST.test(label),
    lives: numberIn(label, LIVES),
    hives: numberIn(label, HIVES),
    enemies: numberIn(label, ENEMIES),
  };
}

export async function shown(page: Page): Promise<Shown> {
  return read(await canvasLabel(page));
}

// Waits (on the wall clock) until the page shows `screen`, and returns what it shows.
export async function waitFor(page: Page, screen: Screen): Promise<Shown> {
  await expect
    .poll(async () => (await shown(page)).screen, { timeout: 10_000 })
    .toBe(screen);
  return shown(page);
}

// Opens the page at `path` and waits for the title screen. Returns the errors the page
// reports, as they come.
export async function openTitle(page: Page, path: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(path);
  await waitFor(page, "title");
  return errors;
}

// --- Games worked out in Node with the game's own core (see game.ts) ------------------------

type Axis = InputState["moveX"];

export const OVER_TICKS = 120; // 2.2: game over at the end of the 120th tick after the death

const FIRE_KEYS: readonly [key: string, fireX: Axis, fireY: Axis][] = [
  ["KeyA", -1, 0],
  ["KeyD", 1, 0],
  ["KeyW", 0, -1],
  ["KeyS", 0, 1],
];

export interface Ending {
  readonly seed: number;
  readonly skill: string;
  /** The fire key held from the game's first tick to its end. */
  readonly key: string;
  /** The tick on which the game is over, counted from the start of the game. */
  readonly over: number;
  /** The score at the end of the game. */
  readonly score: number;
}

const endings = new Map<string, Ending>();

// Spec 2.2 and 2.6: the first seed in which, at `skill` with one fire key held from the first
// tick, the player scores and loses every life, and the game is over within 30 seconds. The
// game is over at the end of the 120th tick after the death that leaves 0 lives, unless the
// level is cleared first; up to that tick the game runs as before WP 13.
export function gameOverRun(skill: string): Ending {
  const known = endings.get(skill);
  if (known !== undefined) return known;
  for (let seed = 1; seed <= 500; seed++) {
    const game = createGame(seed, skill);
    for (const [key, fireX, fireY] of FIRE_KEYS) {
      const input = { ...NO_INPUT, fireX, fireY };
      let state = game;
      let last = -1;
      for (let tick = 1; tick <= 30 * TICKS_PER_SECOND; tick++) {
        state = step(state, input);
        if (state.cleared) break;
        if (last < 0 && state.lives === 0) last = tick;
        if (last >= 0 && tick === last + OVER_TICKS) {
          if (state.score > 0) {
            const ending = { seed, skill, key, over: tick, score: state.score };
            endings.set(skill, ending);
            return ending;
          }
          break;
        }
      }
    }
  }
  throw new Error(`No seed in which a game at ${skill} is soon over`);
}

export interface HudSight {
  readonly seed: number;
  /** The fire key held from the game's first tick. */
  readonly key: string;
  /** A tick after a hive has been destroyed, around which the HUD stays the same. */
  readonly tick: number;
  readonly state: GameState;
}

let hudSight: HudSight | undefined;

// Spec 2.7 and 3: holding the fire key that hits the hive in sight (game.ts) from the first
// tick, the hive is destroyed; the first tick after that around which, for 20 ticks either
// way, the score, the lives, the hives and the snipes stay the same.
export function hiveShotDown(): HudSight {
  if (hudSight !== undefined) return hudSight;
  const sight = hiveInSight();
  const keys: Record<string, string> = {
    "-1,0": "KeyA",
    "1,0": "KeyD",
    "0,-1": "KeyW",
    "0,1": "KeyS",
  };
  const input = { ...NO_INPUT, fireX: sight.fireX, fireY: sight.fireY };
  const game = createGame(sight.seed);
  const states: GameState[] = [game];
  for (let tick = 1; tick <= 60 * TICKS_PER_SECOND; tick++) {
    states.push(step(states[tick - 1], input));
  }
  const same = (a: GameState, b: GameState): boolean =>
    a.score === b.score &&
    a.lives === b.lives &&
    a.hives.length === b.hives.length &&
    a.snipes.length === b.snipes.length;
  const destroyed = states.findIndex((s) => s.hives.length < game.hives.length);
  if (destroyed < 0) throw new Error("The hive in sight was not destroyed");
  for (let tick = destroyed + 20; tick + 20 < states.length; tick++) {
    if (states[tick].lives < game.lives) break;
    let steady = true;
    for (let t = tick - 20; t <= tick + 20 && steady; t++) {
      steady = same(states[t], states[tick]);
    }
    if (steady) {
      hudSight = {
        seed: sight.seed,
        key: keys[`${sight.fireX},${sight.fireY}`],
        tick,
        state: states[tick],
      };
      return hudSight;
    }
  }
  throw new Error("The HUD never stayed the same after the hive was destroyed");
}
