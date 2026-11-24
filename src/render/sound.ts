import type { GameState } from "../core/state";

// Spec 3: a short beep made with the Web Audio API: its pitch in Hz, falling to half of it,
// and its length in seconds.
export interface Beep {
  readonly hz: number;
  readonly seconds: number;
}

const SHOT: Beep = { hz: 880, seconds: 0.04 };
const HIT: Beep = { hz: 440, seconds: 0.08 };
const HIVE_DESTROYED: Beep = { hz: 220, seconds: 0.3 };
const DEATH: Beep = { hz: 160, seconds: 0.6 };

const VOLUME = 0.1;

// Spec 3: the beep for what happened in the ticks from `before` to `after`, or undefined if
// nothing did. When several things happened, only the beep of the one listed first is played:
// a death (also by a ghost bursting), a hive destroyed, a hit (on a hive, or a snipe or ghost
// killed), a shot the player fired.
export function beepFor(before: GameState, after: GameState): Beep | undefined {
  if (after.lives < before.lives) return DEATH;
  if (after.hives.length < before.hives.length) return HIVE_DESTROYED;
  if (
    hiveHits(after) > hiveHits(before) ||
    after.enemiesKilled > before.enemiesKilled
  ) {
    return HIT;
  }
  // Spec 2.5: a shot starts the reload again. The page runs at most 6 ticks from one frame to
  // the next (main.ts), fewer than half the 13 from one shot to the next, so after a shot the
  // reload is higher than before; otherwise it only counts down.
  if (after.reload > before.reload) return SHOT;
  return undefined;
}

function hiveHits(state: GameState): number {
  return state.hives.reduce((sum, h) => sum + h.hits, 0);
}

// Spec 3: plays `beep` at once on `audio`, fading out so that it does not click.
export function play(audio: AudioContext, { hz, seconds }: Beep): void {
  const start = audio.currentTime;
  const end = start + seconds;
  const tone = audio.createOscillator();
  tone.type = "square";
  tone.frequency.setValueAtTime(hz, start);
  tone.frequency.exponentialRampToValueAtTime(hz / 2, end);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(VOLUME, start);
  gain.gain.exponentialRampToValueAtTime(VOLUME / 100, end);
  tone.connect(gain).connect(audio.destination);
  tone.start(start);
  tone.stop(end);
}
