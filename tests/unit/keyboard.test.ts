import { describe, expect, it } from "vitest";
import { inputFromKeys } from "../../src/input/keyboard";
import { NO_INPUT } from "../../src/core/state";

// Spec 2.2, 2.8, 4.2 and 9.1 WP 06: the input layer maps the keys held down to an InputState.
// Keys are named by `KeyboardEvent.code` (the physical key), so the fixed keys of 2.8 sit in
// the same place on every keyboard layout. Screen y grows downwards, so "up" is moveY = -1.
function held(...codes: string[]): ReadonlySet<string> {
  return new Set(codes);
}

describe("2.8 Controls: arrow keys move in 8 directions", () => {
  it("gives no input when no key is held", () => {
    expect(inputFromKeys(held())).toEqual(NO_INPUT);
  });

  it.each([
    ["ArrowUp", 0, -1],
    ["ArrowDown", 0, 1],
    ["ArrowLeft", -1, 0],
    ["ArrowRight", 1, 0],
  ])("moves with %s alone", (key, moveX, moveY) => {
    expect(inputFromKeys(held(key))).toMatchObject({
      moveX,
      moveY,
      fast: false,
    });
  });

  it.each([
    ["ArrowUp", "ArrowLeft", -1, -1],
    ["ArrowUp", "ArrowRight", 1, -1],
    ["ArrowDown", "ArrowLeft", -1, 1],
    ["ArrowDown", "ArrowRight", 1, 1],
  ])(
    "moves diagonally with %s and %s held together",
    (vertical, horizontal, moveX, moveY) => {
      const expected = { moveX, moveY, fast: false };
      expect(inputFromKeys(held(vertical, horizontal))).toMatchObject(expected);
      expect(inputFromKeys(held(horizontal, vertical))).toMatchObject(expected);
    },
  );

  it("does not change the set of keys it is given", () => {
    const keys = new Set(["ArrowUp", "Space"]);
    inputFromKeys(keys);
    expect([...keys]).toEqual(["ArrowUp", "Space"]);
  });
});

describe("2.8 Controls: opposite movement keys cancel", () => {
  it("does not move with Left and Right held together", () => {
    expect(inputFromKeys(held("ArrowLeft", "ArrowRight"))).toEqual(NO_INPUT);
    expect(inputFromKeys(held("ArrowRight", "ArrowLeft"))).toEqual(NO_INPUT);
  });

  it("does not move with Up and Down held together", () => {
    expect(inputFromKeys(held("ArrowUp", "ArrowDown"))).toEqual(NO_INPUT);
    expect(inputFromKeys(held("ArrowDown", "ArrowUp"))).toEqual(NO_INPUT);
  });

  it.each([
    ["ArrowUp", -1],
    ["ArrowDown", 1],
  ])(
    "keeps only the vertical direction with Left, Right and %s held",
    (vertical, moveY) => {
      const expected = { moveX: 0, moveY, fast: false };
      expect(
        inputFromKeys(held("ArrowLeft", "ArrowRight", vertical)),
      ).toMatchObject(expected);
      expect(
        inputFromKeys(held(vertical, "ArrowRight", "ArrowLeft")),
      ).toMatchObject(expected);
    },
  );

  it.each([
    ["ArrowLeft", -1],
    ["ArrowRight", 1],
  ])(
    "keeps only the horizontal direction with Up, Down and %s held",
    (horizontal, moveX) => {
      const expected = { moveX, moveY: 0, fast: false };
      expect(
        inputFromKeys(held("ArrowUp", "ArrowDown", horizontal)),
      ).toMatchObject(expected);
      expect(
        inputFromKeys(held(horizontal, "ArrowDown", "ArrowUp")),
      ).toMatchObject(expected);
    },
  );

  it("does nothing with all four arrow keys held", () => {
    expect(
      inputFromKeys(held("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight")),
    ).toEqual(NO_INPUT);
  });

  it("keeps Space when an axis is cancelled", () => {
    expect(
      inputFromKeys(held("ArrowLeft", "ArrowRight", "ArrowDown", "Space")),
    ).toMatchObject({ moveX: 0, moveY: 1, fast: true });
    expect(
      inputFromKeys(
        held("ArrowRight", "ArrowLeft", "Space", "ArrowDown", "ArrowUp"),
      ),
    ).toMatchObject({ moveX: 0, moveY: 0, fast: true });
  });
});

describe("2.8 Controls: Space moves faster", () => {
  it("sets fast when Space is held with an arrow key", () => {
    expect(inputFromKeys(held("ArrowRight", "Space"))).toMatchObject({
      moveX: 1,
      moveY: 0,
      fast: true,
    });
  });

  it("sets fast with a diagonal", () => {
    expect(
      inputFromKeys(held("ArrowDown", "ArrowLeft", "Space")),
    ).toMatchObject({ moveX: -1, moveY: 1, fast: true });
  });

  it("does not move when Space is held alone", () => {
    expect(inputFromKeys(held("Space"))).toMatchObject({
      moveX: 0,
      moveY: 0,
      fast: true,
    });
  });
});

describe("2.2 Player: movement and shooting are independent", () => {
  // W A S D fire (2.5, 2.8); they must never move the player or make it faster.
  it.each(["KeyW", "KeyA", "KeyS", "KeyD"])("%s does not move", (key) => {
    expect(inputFromKeys(held(key))).toMatchObject({
      moveX: 0,
      moveY: 0,
      fast: false,
    });
  });

  it("fire keys do not change the direction of movement", () => {
    expect(
      inputFromKeys(held("ArrowUp", "KeyS", "KeyD", "KeyA")),
    ).toMatchObject({ moveX: 0, moveY: -1, fast: false });
  });

  it.each(["KeyP", "Escape", "KeyR", "KeyM", "Enter", "KeyX", "Digit1"])(
    "ignores %s for movement",
    (key) => {
      expect(inputFromKeys(held(key))).toMatchObject({
        moveX: 0,
        moveY: 0,
        fast: false,
      });
    },
  );
});
