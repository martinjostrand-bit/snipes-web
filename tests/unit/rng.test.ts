import { describe, expect, it } from "vitest";
import { createRng, nextFloat, type Rng } from "../../src/core/rng";

// Spec 4.3 and 9.1 WP 04: all randomness comes from a seeded PRNG stored in the state.
// The PRNG is plain data, so drawing a number returns the next PRNG instead of changing it.

function draw(rng: Rng, count: number): number[] {
  const values: number[] = [];
  let current = rng;
  for (let i = 0; i < count; i++) {
    const [value, next] = nextFloat(current);
    values.push(value);
    current = next;
  }
  return values;
}

describe("4.3 Seeded PRNG", () => {
  it("gives the same numbers for the same seed", () => {
    expect(draw(createRng(42), 1000)).toEqual(draw(createRng(42), 1000));
  });

  it("gives equal PRNG states for the same seed", () => {
    expect(createRng(7)).toEqual(createRng(7));
  });

  it("gives different numbers for different seeds", () => {
    expect(draw(createRng(1), 10)).not.toEqual(draw(createRng(2), 10));
    expect(draw(createRng(0), 10)).not.toEqual(draw(createRng(1), 10));
  });

  it.each([0, 1, 42, 123456789, 2 ** 31, 2 ** 32 - 1])(
    "returns numbers in [0, 1) for seed %d",
    (seed) => {
      for (const value of draw(createRng(seed), 1000)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    },
  );

  it("does not repeat itself within a short run", () => {
    const values = draw(createRng(42), 1000);
    expect(new Set(values).size).toBeGreaterThan(990);
  });

  it("spreads numbers evenly over [0, 1)", () => {
    const buckets = new Array<number>(10).fill(0);
    for (const value of draw(createRng(2026), 10000)) {
      buckets[Math.floor(value * 10)] += 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it("does not change the PRNG it is given", () => {
    const rng = createRng(99);
    const before = structuredClone(rng);
    const [first] = nextFloat(rng);
    const [again] = nextFloat(rng);

    expect(rng).toEqual(before);
    expect(again).toBe(first);
  });

  it("returns a next PRNG that continues the sequence", () => {
    const [first, next] = nextFloat(createRng(5));
    const [second] = nextFloat(next);

    expect(second).not.toBe(first);
    expect(draw(createRng(5), 2)).toEqual([first, second]);
  });

  it("is plain data: a copied PRNG continues the same sequence", () => {
    const [, rng] = nextFloat(createRng(31));
    const copy = structuredClone(rng);

    expect(draw(copy, 100)).toEqual(draw(rng, 100));
  });
});
