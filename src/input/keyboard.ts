import type { InputState } from "../core/state";

// Spec 2.8: arrow keys move (diagonal = two keys held), Space moves faster. `held` holds the
// `KeyboardEvent.code` of every key down. Opposite keys held together cancel out.
export function inputFromKeys(held: ReadonlySet<string>): InputState {
  return {
    moveX: axis(held.has("ArrowLeft"), held.has("ArrowRight")),
    moveY: axis(held.has("ArrowUp"), held.has("ArrowDown")),
    fast: held.has("Space"),
  };
}

function axis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0;
  return negative ? -1 : 1;
}
