// Spec 4.3: all randomness comes from a seeded PRNG (mulberry32) stored in the game state.
// The PRNG is plain data: drawing a number returns the next PRNG instead of changing it.
export interface Rng {
  readonly state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

export function nextFloat(rng: Rng): [value: number, next: Rng] {
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(state ^ (state >>> 15), state | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 2 ** 32, { state }];
}
