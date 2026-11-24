import { expect, type Page } from "@playwright/test";
import {
  createGame,
  NO_INPUT,
  step,
  type InputState,
} from "../../src/core/state";
import { canvasLabel } from "./canvas";
import type { Ending } from "./screens";

// Spec 3 and 9.1 WP 14: what the page plays, heard at the Web Audio destination.
//
// The page makes its beeps with the Web Audio API (3) on an `AudioContext`, and whatever it
// plays reaches that context's `destination`. `listen(page)` wraps the page's `AudioContext`
// before any of the page's own scripts run, so that every context the page creates has, as
// its `destination`, a node in front of the real one that also feeds a small AudioWorklet.
// The worklet counts the render quanta (128 sample frames, about 3 ms) in which the signal
// reaching the destination is louder than -60 dB (an absolute sample value above 0.001):
// that is "heard". How the page makes a beep, and how it mutes (a gain of 0, a suspended
// context, or no beep at all), does not matter: a muted page sends nothing audible to the
// destination.
//
// The worklet is ready a moment after a context is created, so a beep played on the very
// first moment of a new context may be missed. The tests therefore hold a fire key long
// enough to fire several shots (one every 13 ticks, 2.5).
//
// Audio runs on the wall clock, not on Playwright's fake clock: after the page's time has
// been moved on, a test waits on the wall clock for what was played to be heard.

const TAP = "__snipesWebTap";

interface Tap {
  /** Contexts created by the page. */
  contexts: number;
  /** Contexts whose worklet is listening. */
  ready: number;
  /** Render quanta heard, over all contexts. */
  heard: number;
  /** Keeps the worklet nodes alive. */
  nodes: unknown[];
}

// Runs in the page before its scripts (page.addInitScript), so it cannot use anything from
// this module.
function installTap(name: string): void {
  const tap: Tap = { contexts: 0, ready: 0, heard: 0, nodes: [] };
  Object.defineProperty(window, name, { value: tap });
  if (
    typeof window.AudioContext !== "function" ||
    typeof window.AudioWorkletNode !== "function"
  ) {
    return;
  }
  const processor = `registerProcessor("snipes-web-tap", class extends AudioWorkletProcessor {
    process(inputs) {
      for (const channel of inputs[0] ?? []) {
        for (const sample of channel) {
          if (Math.abs(sample) > 0.001) {
            this.port.postMessage(1);
            return true;
          }
        }
      }
      return true;
    }
  });`;
  const url = URL.createObjectURL(
    new Blob([processor], { type: "text/javascript" }),
  );
  const Base = window.AudioContext;
  class Tapped extends Base {
    constructor(options?: AudioContextOptions) {
      super(options);
      tap.contexts++;
      const real = this.destination;
      const front = this.createGain();
      front.connect(real);
      Object.defineProperty(this, "destination", { value: front });
      this.audioWorklet.addModule(url).then(
        () => {
          const node = new AudioWorkletNode(this, "snipes-web-tap");
          node.port.onmessage = () => {
            tap.heard++;
          };
          front.connect(node);
          tap.nodes.push(node);
          tap.ready++;
        },
        () => undefined,
      );
    }
  }
  Object.defineProperty(window, "AudioContext", {
    value: Tapped,
    writable: true,
    configurable: true,
  });
}

// Listens to what `page` plays from its next navigation on.
export async function listen(page: Page): Promise<void> {
  await page.addInitScript(installTap, TAP);
}

// The render quanta heard so far in the page's current document.
export function heard(page: Page): Promise<number> {
  return page.evaluate(
    (name) =>
      (window as unknown as Record<string, Tap | undefined>)[name]?.heard ?? 0,
    TAP,
  );
}

// Waits on the wall clock for what has been played to die away (beeps are short, 3), and
// returns the render quanta heard by then.
export async function quiet(page: Page): Promise<number> {
  let before = await heard(page);
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(400);
    const after = await heard(page);
    if (after === before) return after;
    before = after;
  }
  throw new Error("The page kept playing sound with nothing happening");
}

// Waits on the wall clock until more than `before` render quanta have been heard.
export async function expectHeardMore(
  page: Page,
  before: number,
  message: string,
): Promise<void> {
  await expect
    .poll(() => heard(page), { message, timeout: 5000 })
    .toBeGreaterThan(before);
}

// Moves the page's fake clock on by `ms`, a tenth of a second at a time with a short wait on
// the wall clock in between, so that what the game plays as it goes is rendered as it would
// be in a real game, not all at once.
export async function play(page: Page, ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const chunk = Math.min(100, left);
    await page.clock.runFor(chunk);
    await page.waitForTimeout(15);
    left -= chunk;
  }
}

const renders = new Map<string, boolean>();

// Whether this browser, here, plays Web Audio that the tap can hear: on a second page of the
// same browser context, after a key press, an `AudioContext` plays a tone for up to 3 seconds
// of wall time. Some browsers have no Web Audio in some builds (Playwright's WebKit on
// Windows has no `AudioContext`); there the tests that listen are skipped. Call it before
// the test installs the fake clock.
export async function audioRenders(page: Page): Promise<boolean> {
  const browser = page.context().browser()?.browserType().name() ?? "";
  const known = renders.get(browser);
  if (known !== undefined) return known;
  const probe = await page.context().newPage();
  try {
    await listen(probe);
    await probe.goto("/");
    await expect.poll(() => canvasLabel(probe)).toContain("Snipes Web");
    // A key press, so that the page may start audio. Shift does nothing on the title (3).
    await probe.keyboard.press("Shift");
    const ok = await probe.evaluate(async (name) => {
      const tap = (window as unknown as Record<string, Tap | undefined>)[name];
      if (tap === undefined || typeof window.AudioWorkletNode !== "function") {
        return false;
      }
      const context = new AudioContext();
      void context.resume();
      const tone = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.1;
      tone.connect(gain);
      gain.connect(context.destination);
      tone.start();
      for (let i = 0; i < 60 && tap.heard === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      tone.stop();
      void context.close();
      return tap.heard > 0;
    }, TAP);
    renders.set(browser, ok);
    return ok;
  } finally {
    await probe.close();
  }
}

// --- What the game does, worked out in Node with the game's own core (see game.ts) --------

const FIRE: Record<string, Pick<InputState, "fireX" | "fireY">> = {
  KeyA: { fireX: -1, fireY: 0 },
  KeyD: { fireX: 1, fireY: 0 },
  KeyW: { fireX: 0, fireY: -1 },
  KeyS: { fireX: 0, fireY: 1 },
};

// Spec 2.5: the ticks, counted from the start of the game, on which the player fires a shot
// in the run (screens.ts `gameOverRun`), with its fire key held from the first tick.
export function fireTicks(run: Ending): number[] {
  const input = { ...NO_INPUT, ...FIRE[run.key] };
  let state = createGame(run.seed, run.skill);
  const fired: number[] = [];
  for (let tick = 1; tick <= run.over; tick++) {
    const next = step(state, input);
    // Shots after the first `movedShots` were fired on this tick (WP 11b).
    if (next.shots.length > next.motion.movedShots) fired.push(tick);
    state = next;
  }
  return fired;
}

// Spec 2.2: the ticks on which the player dies in the run.
export function deathTicks(run: Ending): number[] {
  const input = { ...NO_INPUT, ...FIRE[run.key] };
  let state = createGame(run.seed, run.skill);
  const deaths: number[] = [];
  for (let tick = 1; tick <= run.over; tick++) {
    const next = step(state, input);
    if (next.lives < state.lives) deaths.push(tick);
    state = next;
  }
  return deaths;
}
