// Spec 2.7: the points for each hive and snipe a player's shot destroys.
export const HIVE_POINTS = 100;
export const SNIPE_POINTS = 10;

// Spec 2.7: the level bonus, until WP 18 sets the final formula: 100 for each life left, plus 5
// for each whole second under 5 minutes the level took. Spec 4.3: 60 ticks are a second.
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
