// Spec 2.6: a skill level is a letter A to Z and a digit 1 to 9, such as "A1" or "M5".
// The digit sets how many hives there are, the most enemies on the map at once and the lives a
// game starts with; the letter sets how accurately snipes aim.
const HIVES = [3, 3, 4, 4, 5, 5, 6, 8, 10];
const MAX_ENEMIES = [10, 20, 30, 40, 60, 80, 100, 120, 150];
const LIVES = [5, 5, 5, 5, 5, 4, 4, 3, 2];
// Letters A to Z.
const ACCURACY = [
  2, 3, 4, 3, 4, 4, 3, 4, 3, 4, 4, 5, 3, 4, 3, 4, 3, 4, 3, 4, 4, 5, 4, 4, 5, 5,
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

export function accuracy(skill: string): number {
  return ACCURACY[skill.charCodeAt(0) - "A".charCodeAt(0)];
}
