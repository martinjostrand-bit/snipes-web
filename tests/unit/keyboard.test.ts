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

// Spec 2.5, 2.8 and 9.1 WP 08: W A S D fire, diagonally with two keys held, as `fireX` and
// `fireY` in the InputState (up is fireY = -1). Opposite fire keys cancel like the arrow keys.
describe("2.8 Controls: W A S D fire in 8 directions", () => {
  it.each([
    ["KeyW", 0, -1],
    ["KeyS", 0, 1],
    ["KeyA", -1, 0],
    ["KeyD", 1, 0],
  ])("fires with %s alone, without moving", (key, fireX, fireY) => {
    expect(inputFromKeys(held(key))).toEqual({ ...NO_INPUT, fireX, fireY });
  });

  it.each([
    ["KeyW", "KeyA", -1, -1],
    ["KeyW", "KeyD", 1, -1],
    ["KeyS", "KeyA", -1, 1],
    ["KeyS", "KeyD", 1, 1],
  ])(
    "fires diagonally with %s and %s held together",
    (vertical, horizontal, fireX, fireY) => {
      const expected = { ...NO_INPUT, fireX, fireY };
      expect(inputFromKeys(held(vertical, horizontal))).toEqual(expected);
      expect(inputFromKeys(held(horizontal, vertical))).toEqual(expected);
    },
  );

  it("gives no fire direction when no key is held", () => {
    expect(inputFromKeys(held())).toMatchObject({ fireX: 0, fireY: 0 });
    expect(NO_INPUT).toMatchObject({ fireX: 0, fireY: 0 });
  });

  it.each(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"])(
    "%s does not fire",
    (key) => {
      expect(inputFromKeys(held(key))).toMatchObject({ fireX: 0, fireY: 0 });
    },
  );

  it.each(["KeyP", "Escape", "KeyR", "KeyM", "Enter", "KeyX", "KeyQ", "KeyE"])(
    "ignores %s for firing",
    (key) => {
      expect(inputFromKeys(held(key))).toEqual(NO_INPUT);
    },
  );
});

describe("2.8 Controls: opposite fire keys cancel", () => {
  it("does not fire with A and D held together", () => {
    expect(inputFromKeys(held("KeyA", "KeyD"))).toEqual(NO_INPUT);
    expect(inputFromKeys(held("KeyD", "KeyA"))).toEqual(NO_INPUT);
  });

  it("does not fire with W and S held together", () => {
    expect(inputFromKeys(held("KeyW", "KeyS"))).toEqual(NO_INPUT);
    expect(inputFromKeys(held("KeyS", "KeyW"))).toEqual(NO_INPUT);
  });

  it.each([
    ["KeyW", -1],
    ["KeyS", 1],
  ])(
    "keeps only the vertical direction with A, D and %s held",
    (vertical, fireY) => {
      const expected = { ...NO_INPUT, fireX: 0, fireY };
      expect(inputFromKeys(held("KeyA", "KeyD", vertical))).toEqual(expected);
      expect(inputFromKeys(held(vertical, "KeyD", "KeyA"))).toEqual(expected);
    },
  );

  it.each([
    ["KeyA", -1],
    ["KeyD", 1],
  ])(
    "keeps only the horizontal direction with W, S and %s held",
    (horizontal, fireX) => {
      const expected = { ...NO_INPUT, fireX, fireY: 0 };
      expect(inputFromKeys(held("KeyW", "KeyS", horizontal))).toEqual(expected);
      expect(inputFromKeys(held(horizontal, "KeyS", "KeyW"))).toEqual(expected);
    },
  );

  it("does nothing with all four fire keys held", () => {
    expect(inputFromKeys(held("KeyW", "KeyA", "KeyS", "KeyD"))).toEqual(
      NO_INPUT,
    );
  });
});

describe("2.2 Player / 2.8 Controls: moving and firing at the same time", () => {
  it("moves one way and fires another with both groups held", () => {
    expect(inputFromKeys(held("ArrowRight", "KeyW"))).toEqual({
      ...NO_INPUT,
      moveX: 1,
      fireY: -1,
    });
    expect(
      inputFromKeys(held("ArrowUp", "ArrowLeft", "Space", "KeyS", "KeyD")),
    ).toEqual({
      ...NO_INPUT,
      moveX: -1,
      moveY: -1,
      fast: true,
      fireX: 1,
      fireY: 1,
    });
  });

  it("cancels an axis in one group without touching the other group", () => {
    expect(
      inputFromKeys(held("ArrowLeft", "ArrowRight", "KeyA", "KeyW")),
    ).toEqual({ ...NO_INPUT, fireX: -1, fireY: -1 });
    expect(
      inputFromKeys(held("ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS")),
    ).toEqual({ ...NO_INPUT, moveY: 1 });
  });
});
