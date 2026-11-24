// Spec 2.6: a skill level is a letter A to Z and a digit 1 to 9, such as "A1" or "M5".
// The digit sets how many hives there are, the most enemies on the map at once and the lives a
// game starts with; the letter sets which features are on, how accurately snipes aim and how
// likely a ghost is to burst.
const HIVES = [3, 3, 4, 4, 5, 5, 6, 8, 10];
const MAX_ENEMIES = [10, 20, 30, 40, 60, 80, 100, 120, 150];
const LIVES = [5, 5, 5, 5, 5, 4, 4, 3, 2];

export interface Features {
  readonly ghosts: boolean;
  readonly bouncing: boolean;
  readonly deadlyWalls: boolean;
  readonly hivesResist: boolean;
}

// Spec 2.6: for each letter, A to Z: the features it enables (G ghosts, B bouncing diagonal
// shots, D deadly walls, H hives resisting snipe shots), the snipes' accuracy and the ghosts'
// burst chance per draw (0 without ghosts).
const LETTERS: readonly [features: string, accuracy: number, burst: number][] =
  [
    ["", 2, 0], // A
    ["", 3, 0], // B
    ["", 4, 0], // C
    ["G", 3, 1 / 128], // D
    ["G", 4, 1 / 128], // E
    ["G", 4, 1 / 64], // F
    ["B", 3, 0], // G
    ["B", 4, 0], // H
    ["GB", 3, 1 / 128], // I
    ["GB", 4, 1 / 128], // J
    ["GB", 4, 1 / 64], // K
    ["GB", 5, 1 / 64], // L
    ["D", 3, 0], // M
    ["D", 4, 0], // N
    ["GD", 3, 1 / 128], // O
    ["GD", 4, 1 / 128], // P
    ["BD", 3, 0], // Q
    ["BD", 4, 0], // R
    ["GBD", 3, 1 / 128], // S
    ["GBD", 4, 1 / 128], // T
    ["GBD", 4, 1 / 64], // U
    ["GBD", 5, 1 / 64], // V
    ["GBDH", 4, 1 / 128], // W
    ["GBDH", 4, 1 / 64], // X
    ["GBDH", 5, 1 / 64], // Y
    ["GBDH", 5, 1 / 32], // Z
  ];

export function isSkill(skill: string): boolean {
  return /^[A-Z][1-9]$/.test(skill);
}

export function checkSkill(skill: string): void {
  if (!isSkill(skill)) {
    throw new RangeError(`Not a skill level from A1 to Z9: ${skill}`);
  }
}

function digit(skill: string): number {
  return Number(skill[1]);
}

export function hiveCount(skill: string): number {
  return HIVES[digit(skill) - 1];
}

export function maxEnemies(skill: string): number {
  return MAX_ENEMIES[digit(skill) - 1];
}

export function startLives(skill: string): number {
  return LIVES[digit(skill) - 1];
}

function letter(skill: string): (typeof LETTERS)[number] {
  return LETTERS[skill.charCodeAt(0) - "A".charCodeAt(0)];
}

export function features(skill: string): Features {
  const [on] = letter(skill);
  return {
    ghosts: on.includes("G"),
    bouncing: on.includes("B"),
    deadlyWalls: on.includes("D"),
    hivesResist: on.includes("H"),
  };
}

export function accuracy(skill: string): number {
  return letter(skill)[1];
}

export function burstChance(skill: string): number {
  return letter(skill)[2];
}
