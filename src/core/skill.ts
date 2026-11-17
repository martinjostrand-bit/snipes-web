// Spec 2.6: a skill level is a letter A to Z and a digit 1 to 9, such as "A1" or "M5".
// The digit sets how many hives there are and the most enemies on the map at once.
const HIVES = [3, 3, 4, 4, 5, 5, 6, 8, 10];
const MAX_ENEMIES = [10, 20, 30, 40, 60, 80, 100, 120, 150];

export function checkSkill(skill: string): void {
  if (!/^[A-Z][1-9]$/.test(skill)) {
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
