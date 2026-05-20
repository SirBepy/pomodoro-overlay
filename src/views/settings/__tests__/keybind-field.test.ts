import { describe, it, expect } from "vitest";
import { buildAccelerator } from "../keybind-field";

// buildAccelerator only reads key/code + modifier flags, so a plain object
// standing in for KeyboardEvent is enough (no DOM needed).
const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent;

describe("buildAccelerator", () => {
  it("builds Shift+digit (e.key is the shifted glyph, so must read e.code)", () => {
    // Real browser event for Shift+1: key="!", code="Digit1".
    expect(buildAccelerator(ev({ key: "!", code: "Digit1", shiftKey: true }))).toBe("Shift+1");
  });

  it("builds Shift+letter", () => {
    expect(buildAccelerator(ev({ key: "A", code: "KeyA", shiftKey: true }))).toBe("Shift+A");
  });

  it("builds Ctrl+digit without shift", () => {
    expect(buildAccelerator(ev({ key: "1", code: "Digit1", ctrlKey: true }))).toBe("Ctrl+1");
  });

  it("orders modifiers Ctrl+Alt+Shift", () => {
    expect(
      buildAccelerator(ev({ key: "P", code: "KeyP", ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBe("Ctrl+Alt+Shift+P");
  });

  it("maps Space and arrows", () => {
    expect(buildAccelerator(ev({ key: " ", code: "Space", altKey: true }))).toBe("Alt+Space");
    expect(buildAccelerator(ev({ key: "ArrowRight", code: "ArrowRight", altKey: true }))).toBe("Alt+Right");
  });

  it("returns null with no modifier", () => {
    expect(buildAccelerator(ev({ key: "a", code: "KeyA" }))).toBeNull();
  });

  it("returns null for an unsupported key", () => {
    expect(buildAccelerator(ev({ key: "Tab", code: "Tab", ctrlKey: true }))).toBeNull();
  });
});
