// Spec 2.7: the points for each hive, snipe and ghost a player's shot destroys.
export const HIVE_POINTS = 100;
export const SNIPE_POINTS = 10;
export const GHOST_POINTS = 10;

// Spec 2.7: the level bonus is 100·L + 5·max(0, 300 − ⌊T/60⌋), where L is the lives left and T
// the ticks the level took; ⌊T/60⌋ is the whole seconds, so a started second does not count.
// Spec 4.3: 60 ticks are a second.
const LIFE_BONUS = 100;
const SECOND_BONUS = 5;
const BONUS_SECONDS = 5 * 60;
const TICKS_PER_SECOND = 60;

// Spec 2.7: the bonus for clearing a level with `lives` left after `ticks` ticks.
export function levelBonus(lives: number, ticks: number): number {
  const seconds = Math.floor(ticks / TICKS_PER_SECOND);
  return (
    LIFE_BONUS * lives + SECOND_BONUS * Math.max(0, BONUS_SECONDS - seconds)
  );
}
