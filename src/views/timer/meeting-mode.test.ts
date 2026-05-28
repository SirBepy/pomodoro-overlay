import { describe, it, expect, beforeEach } from "vitest";
import { MeetingPolicy } from "./meeting-mode";

describe("MeetingPolicy", () => {
  let entered: number;
  let exited: number;
  let p: MeetingPolicy;

  beforeEach(() => {
    entered = 0;
    exited = 0;
    p = new MeetingPolicy({
      onEnter: () => entered++,
      onExit: () => exited++,
      isEnabled: () => true,
    });
  });

  it("enters on a rising raw edge", () => {
    p.onRaw(true);
    expect(entered).toBe(1);
    expect(p.active).toBe(true);
  });

  it("stays active when raw falls (stay-until-manual)", () => {
    p.onRaw(true);
    p.onRaw(false);
    expect(p.active).toBe(true);
    expect(exited).toBe(0);
  });

  it("hotkey while active deactivates and suppresses re-entry until raw clears", () => {
    p.onRaw(true); // active
    p.toggleHotkey(); // force off + arm suppression (raw still true)
    expect(p.active).toBe(false);
    expect(exited).toBe(1);

    p.onRaw(true); // same call still detected -> suppressed, must NOT re-enter
    expect(p.active).toBe(false);
    expect(entered).toBe(1);

    p.onRaw(false); // raw clears -> suppression lifts
    p.onRaw(true); // new meeting -> re-enter
    expect(p.active).toBe(true);
    expect(entered).toBe(2);
  });

  it("hotkey while inactive forces on (covers undetectable calls)", () => {
    p.toggleHotkey();
    expect(p.active).toBe(true);
    expect(entered).toBe(1);
  });

  it("ignores raw edges when detection disabled, but hotkey still works", () => {
    p = new MeetingPolicy({
      onEnter: () => entered++,
      onExit: () => exited++,
      isEnabled: () => false,
    });
    p.onRaw(true);
    expect(p.active).toBe(false);
    expect(entered).toBe(0);
    p.toggleHotkey();
    expect(p.active).toBe(true);
    expect(entered).toBe(1);
  });
});
