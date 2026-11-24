import { describe, expect, it } from "vitest";
// A namespace import, so that a missing export fails these tests one by one, not the file.
import * as skill from "../../src/core/skill";

// Spec 2.6, 6.2 and 9.1 WP 15: the letter of the skill level switches four rule features on or
// off and sets the snipes' accuracy and the ghosts' burst chance, from one small lookup table
// in core/ (2.6).
//
// - `features(skill)` in src/core/skill.ts gives, for a skill level such as "M5", which of the
//   four features its letter enables: `{ ghosts, bouncing, deadlyWalls, hivesResist }`, each a
//   boolean, and nothing else (6.2: exactly the features in the 2.6 table, no more).
// - `accuracy(skill)` (WP 10) gives the letter's snipe accuracy.
// - `burstChance(skill)` gives the letter's ghost burst chance per draw (2.4): 1/128, 1/64 or
//   1/32 for the letters with ghosts, and 0 for the letters without.
// - None of them depends on the digit.

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// Spec 2.6: the letters each feature is enabled for.
function letters(ranges: string): Set<string> {
  const result = new Set<string>();
  for (const range of ranges.split(",")) {
    const [from, to] = range.trim().split("-");
    for (let c = from.charCodeAt(0); c <= (to ?? from).charCodeAt(0); c++) {
      result.add(String.fromCharCode(c));
    }
  }
  return result;
}

const GHOSTS = letters("D-F, I-L, O, P, S-Z");
const BOUNCING = letters("G-L, Q-Z");
const DEADLY_WALLS = letters("M-Z");
const HIVES_RESIST = letters("W-Z");

// Spec 2.6: snipe accuracy, letters A to Z.
const ACCURACY = [
  2, 3, 4, 3, 4, 4, 3, 4, 3, 4, 4, 5, 3, 4, 3, 4, 3, 4, 3, 4, 4, 5, 4, 4, 5, 5,
];

// Spec 2.6: the ghost burst chance per draw; letters without ghosts have 0.
const BURST: Record<string, number> = {
  ...Object.fromEntries([..."DEIJOPSTW"].map((l) => [l, 1 / 128])),
  ...Object.fromEntries([..."FKLUVXY"].map((l) => [l, 1 / 64])),
  Z: 1 / 32,
};

function expected(letter: string) {
  return {
    ghosts: GHOSTS.has(letter),
    bouncing: BOUNCING.has(letter),
    deadlyWalls: DEADLY_WALLS.has(letter),
    hivesResist: HIVES_RESIST.has(letter),
  };
}

describe("2.6 Skill level: the letter enables exactly its features", () => {
  it.each(LETTERS)(
    "letter %s, every digit: its features, accuracy and burst chance",
    (letter) => {
      const i = LETTERS.indexOf(letter);
      for (const digit of DIGITS) {
        const s = `${letter}${digit}`;
        expect(skill.features(s), s).toEqual(expected(letter));
        expect(skill.accuracy(s), s).toBe(ACCURACY[i]);
        expect(skill.burstChance(s), s).toBe(BURST[letter] ?? 0);
      }
    },
  );

  it("A to C have no features and Z has all of them", () => {
    for (const s of ["A1", "B5", "C9"]) {
      expect(skill.features(s)).toEqual({
        ghosts: false,
        bouncing: false,
        deadlyWalls: false,
        hivesResist: false,
      });
    }
    expect(skill.features("Z9")).toEqual({
      ghosts: true,
      bouncing: true,
      deadlyWalls: true,
      hivesResist: true,
    });
  });

  it("enables each feature for exactly the letters in the 2.6 table", () => {
    const on = (key: keyof ReturnType<typeof expected>): string =>
      LETTERS.filter((l) => skill.features(`${l}1`)[key]).join("");
    expect(on("ghosts")).toBe("DEFIJKLOPSTUVWXYZ");
    expect(on("bouncing")).toBe("GHIJKLQRSTUVWXYZ");
    expect(on("deadlyWalls")).toBe("MNOPQRSTUVWXYZ");
    expect(on("hivesResist")).toBe("WXYZ");
  });

  it("gives plain data that does not change between calls", () => {
    const a = skill.features("K4");
    expect(structuredClone(a)).toEqual(a);
    expect(skill.features("K4")).toEqual(a);
  });
});

describe("2.6 Skill level: the letter's ghost burst chance", () => {
  it.each(LETTERS.map((l) => [l, BURST[l] ?? 0] as const))(
    "letter %s has burst chance %s at every digit",
    (letter, chance) => {
      for (const digit of DIGITS) {
        expect(
          skill.burstChance(`${letter}${digit}`),
          `${letter}${digit}`,
        ).toBe(chance);
      }
    },
  );

  it("is 0 exactly for the letters without ghosts", () => {
    for (const letter of LETTERS) {
      const chance = skill.burstChance(`${letter}5`);
      expect(chance === 0, letter).toBe(!GHOSTS.has(letter));
    }
  });

  it("is 1/128, 1/64 or 1/32 for every letter with ghosts", () => {
    for (const letter of GHOSTS) {
      expect([1 / 128, 1 / 64, 1 / 32], letter).toContain(
        skill.burstChance(`${letter}1`),
      );
    }
  });
});
