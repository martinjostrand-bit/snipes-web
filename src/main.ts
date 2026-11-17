import { advance } from "./core/loop";
import { createGame } from "./core/state";
import { inputFromKeys } from "./input/keyboard";
import {
  CELL_PX,
  drawGame,
  drawLabel,
  VIEW_COLS,
  VIEW_ROWS,
} from "./render/view";

// Spec 4.2: wires the layers together and runs the loop.
// After a long pause (a hidden tab), catch up at most this much game time.
const MAX_FRAME_MS = 100;

const TITLE = `Snipes Web v${__APP_VERSION__}`;

// Spec 4.3: the seed in `?seed=N`, when N is a whole number from 0 to 2^32 - 1 written in
// decimal digits; otherwise undefined.
function seedFrom(search: string): number | undefined {
  const value = new URLSearchParams(search).get("seed");
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const seed = Number(value);
  return seed <= 2 ** 32 - 1 ? seed : undefined;
}

const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const ctx = canvas?.getContext("2d");

if (canvas && ctx) {
  // The canvas text is invisible to screen readers and tests, so it is repeated as a label.
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", TITLE);
  canvas.width = VIEW_COLS * CELL_PX;
  // Spec 3: the view of the maze plus one HUD row.
  canvas.height = (VIEW_ROWS + 1) * CELL_PX;

  // Spec 3: scale in whole-number steps to fit the window, so pixels stay sharp.
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

  // Spec 2.8: the keys held, by KeyboardEvent.code.
  const held = new Set<string>();
  window.addEventListener("keydown", (e) => held.add(e.code));
  window.addEventListener("keyup", (e) => held.delete(e.code));
  // Keys released while the window is not focused send no keyup.
  window.addEventListener("blur", () => held.clear());

  // Spec 2.1 and 4.3: a new maze from a new seed for every game, unless the URL gives one.
  let state = createGame(
    seedFrom(location.search) ?? Math.floor(Math.random() * 2 ** 32),
  );
  let carriedMs = 0;
  let last: number | undefined;
  const frame = (now: number): void => {
    const elapsed = last === undefined ? 0 : Math.min(now - last, MAX_FRAME_MS);
    last = now;
    ({ state, carriedMs } = advance(
      state,
      inputFromKeys(held),
      carriedMs,
      elapsed,
    ));
    drawGame(ctx, state);
    drawLabel(ctx, TITLE);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
