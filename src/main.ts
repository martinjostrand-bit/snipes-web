import { advance, TICK_MS } from "./core/loop";
import { isSkill } from "./core/skill";
import { createGame, type GameState } from "./core/state";
import { inputFromKeys } from "./input/keyboard";
import { beepFor, play } from "./render/sound";
import {
  CELL_PX,
  drawGame,
  drawHud,
  drawPanel,
  drawTitle,
  VIEW_COLS,
  VIEW_ROWS,
} from "./render/view";

// Spec 4.2: wires the layers together and runs the loop.
// After a long pause (a hidden tab), catch up at most this much game time.
const MAX_FRAME_MS = 100;

const TITLE = `Snipes Web v${__APP_VERSION__}`;

// Spec 2.7 and 3: what is stored locally: the last skill level started, and the best score
// for each skill level.
const SKILL_KEY = "snipes-web.skill";
const bestKey = (skill: string): string => `snipes-web.best.${skill}`;
// Spec 3: mute is stored locally too, as MUTED; anything else stored means sound is on.
const MUTE_KEY = "snipes-web.mute";
const MUTED = "on";

// Spec 3: the game works without storage, and then nothing is stored.
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing is stored.
  }
}

// Spec 3: the skill level shown at first is the last one started, if it is valid; else A1.
function loadSkill(): string {
  const skill = load(SKILL_KEY);
  return skill !== null && isSkill(skill) ? skill : "A1";
}

// Spec 2.7 and 3: the best score stored for `skill`, 0 if there is none.
function loadBest(skill: string): number {
  const best = load(bestKey(skill));
  return best !== null && /^\d+$/.test(best) ? Number(best) : 0;
}

// Spec 4.3: the seed in `?seed=N`, when N is a whole number from 0 to 2^32 - 1 written in
// decimal digits; otherwise undefined.
function seedFrom(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const seed = Number(value);
  return seed <= 2 ** 32 - 1 ? seed : undefined;
}

const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const ctx = canvas?.getContext("2d");

if (canvas && ctx) {
  // The canvas text is invisible to screen readers and tests, so it is repeated as a label.
  canvas.setAttribute("role", "img");
  canvas.width = VIEW_COLS * CELL_PX;
  // Spec 3: the view of the maze plus one HUD row.
  canvas.height = (VIEW_ROWS + 1) * CELL_PX;

  // Spec 3: scale in whole-number steps to fit the window.
  const fit = (): void => {
    const scale = Math.max(
      1,
      Math.floor(
        Math.min(
          window.innerWidth / canvas.width,
          window.innerHeight / canvas.height,
        ),
      ),
    );
    canvas.style.width = `${scale * canvas.width}px`;
    canvas.style.height = `${scale * canvas.height}px`;
  };
  fit();
  window.addEventListener("resize", fit);

  const params = new URLSearchParams(location.search);
  const seed = seedFrom(params.get("seed"));
  // Spec 4.3: for tests, `?won=1` starts every game with no hives and no snipes.
  const wonAtOnce = params.get("won") === "1";

  // Spec 3: title -> playing <-> paused -> won or game over ("ended") -> playing or title.
  let screen: "title" | "playing" | "paused" | "ended" = "title";
  let skill = loadSkill();
  // The best score for `skill`; on the won and game-over screens, including this game.
  let best = loadBest(skill);
  let newBest = false;
  let state: GameState | undefined;
  let carriedMs = 0;
  // Spec 3: sound starts muted only when storage holds the game's own muted value.
  let muted = load(MUTE_KEY) === MUTED;
  // Spec 3: the Web Audio context, made on the first key press that may start sound; none
  // without Web Audio.
  let audio: AudioContext | undefined;

  // Spec 2.1, 3 and 4.3: a new game at the skill level shown, from a new seed unless the URL
  // gives one.
  const start = (): void => {
    save(SKILL_KEY, skill);
    const game = createGame(seed ?? Math.floor(Math.random() * 2 ** 32), skill);
    // A new game has no snipes yet.
    state = wonAtOnce ? { ...game, hives: [] } : game;
    carriedMs = 0;
    screen = "playing";
  };

  // Spec 2.8 and 3: the keys that change the screen, by `KeyboardEvent.key`.
  const press = (key: string): void => {
    if (screen === "title") {
      if (/^[a-z]$/i.test(key)) skill = key.toUpperCase() + skill[1];
      else if (/^[1-9]$/.test(key)) skill = skill[0] + key;
      else if (key === "Enter") start();
      best = loadBest(skill);
    } else if (key.toUpperCase() === "M") {
      // Spec 2.8 and 3: mute on every screen but the title, without changing the screen.
      muted = !muted;
      save(MUTE_KEY, muted ? MUTED : "off");
    } else if (screen === "ended") {
      if (key === "Enter" || key.toUpperCase() === "R") start();
      else if (key === "Escape") {
        best = loadBest(skill);
        screen = "title";
      }
    } else if (key === "Escape" || key.toUpperCase() === "P") {
      screen = screen === "playing" ? "paused" : "playing";
    }
  };

  // Spec 2.7 and 3: at the end of a game, its score is stored if it is a new best.
  const end = (score: number): void => {
    const before = loadBest(skill);
    newBest = score > before;
    if (newBest) save(bestKey(skill), String(score));
    best = Math.max(before, score);
    screen = "ended";
  };

  // Draws the screen, `now` in ms, and repeats its text in the canvas's label for screen
  // readers and tests.
  let label = "";
  const show = (now: number): void => {
    let text: string[];
    if (screen === "title" || state === undefined) {
      text = [
        TITLE,
        `Skill level: ${skill}`,
        `Best: ${best}`,
        "Type a letter and a digit to change the skill level",
        "Arrow keys move, Space faster, W A S D fire, P pause, M mute",
        "Press Enter to start",
      ];
      drawTitle(ctx, text);
    } else {
      // Spec 3: drawn the fraction of a tick after the last step that has passed since it.
      drawGame(ctx, state, carriedMs / TICK_MS, now);
      const hud = [
        `Score: ${state.score}`,
        `Lives: ${state.lives}`,
        `Skill: ${skill}`,
        `Hives: ${state.hives.length}`,
        `Snipes: ${state.snipes.length}`,
      ].join("   ");
      drawHud(ctx, hud);
      text = [hud];
      if (screen === "paused") {
        const panel = ["Paused", "P or Esc to resume"];
        drawPanel(ctx, panel);
        text = [...panel, hud];
      } else if (screen === "ended") {
        const panel = [
          state.cleared ? "You won" : "Game over",
          `Score: ${state.score}`,
          `Best: ${best}`,
          ...(newBest ? ["New best!"] : []),
          "Enter or R to play again, Esc for the title",
        ];
        drawPanel(ctx, panel);
        text = panel;
      }
    }
    if (text.join("; ") !== label) {
      label = text.join("; ");
      canvas.setAttribute("aria-label", label);
    }
  };

  let last: number | undefined;

  // Browsers let a page start sound only on a key press that counts as interacting with it,
  // which Esc does not. Spec 3: if Web Audio is missing or fails, the game runs silently.
  const startAudio = (): void => {
    if (typeof window.AudioContext !== "function") return;
    if ("userActivation" in navigator && !navigator.userActivation.isActive) {
      return;
    }
    try {
      audio ??= new AudioContext();
      if (audio.state === "suspended") audio.resume().catch(() => undefined);
    } catch {
      // No sound.
    }
  };

  // Spec 2.8: the keys held, by KeyboardEvent.code.
  const held = new Set<string>();
  window.addEventListener("keydown", (e) => {
    held.add(e.code);
    startAudio();
    // Spec 3: the keys that change the screen, the skill level, pause or mute act on a key
    // press, not on its auto-repeat. The new screen is shown at once, not only at the next
    // frame.
    if (!e.repeat) {
      press(e.key);
      show(last ?? 0);
    }
  });
  window.addEventListener("keyup", (e) => held.delete(e.code));
  // Keys released while the window is not focused send no keyup.
  window.addEventListener("blur", () => held.clear());

  const frame = (now: number): void => {
    const elapsed = last === undefined ? 0 : Math.min(now - last, MAX_FRAME_MS);
    last = now;
    // Spec 4.3: no tick runs while paused.
    if (screen === "playing" && state !== undefined) {
      const before = state;
      ({ state, carriedMs } = advance(
        state,
        inputFromKeys(held),
        carriedMs,
        elapsed,
      ));
      const beep = beepFor(before, state);
      if (beep !== undefined && audio !== undefined && !muted) {
        play(audio, beep);
      }
      if (state.cleared || state.gameOver) end(state.score);
    }
    show(now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
