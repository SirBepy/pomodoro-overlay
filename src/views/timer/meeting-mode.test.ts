import { describe, it, expect, beforeEach } from "vitest";
import { MeetingPolicy } from "./meeting-mode";

const GRACE = 2000;

describe("MeetingPolicy", () => {
  let entered: number;
  let exited: number;
  let enabled: boolean;
  let nowMs: number;
  let p: MeetingPolicy;

  beforeEach(() => {
    entered = 0;
    exited = 0;
    enabled = true;
    nowMs = 1_000_000;
    p = new MeetingPolicy({
      onEnter: () => entered++,
      onExit: () => exited++,
      isEnabled: () => enabled,
      graceMs: () => GRACE,
      now: () => nowMs,
    });
  });

  it("enters on a rising raw edge", () => {
    p.onRaw(true);
    expect(entered).toBe(1);
    expect(p.active).toBe(true);
  });

  it("does not exit immediately when raw falls (grace pending)", () => {
    p.onRaw(true);
    p.onRaw(false);
    p.tick();
    expect(p.active).toBe(true);
    expect(exited).toBe(0);
  });

  it("auto-reverts once the grace deadline passes", () => {
    p.onRaw(true);
    p.onRaw(false);
    nowMs += GRACE;
    p.tick();
    expect(p.active).toBe(false);
    expect(exited).toBe(1);
  });

  it("does not revert before the deadline", () => {
    p.onRaw(true);
    p.onRaw(false);
    nowMs += GRACE - 1;
    p.tick();
    expect(p.active).toBe(true);
    expect(exited).toBe(0);
  });

  it("a new rising edge during grace cancels the auto-revert", () => {
    p.onRaw(true);
    p.onRaw(false);
    nowMs += GRACE - 1;
    p.onRaw(true); // signal back before grace expires
    nowMs += GRACE;
    p.tick();
    expect(p.active).toBe(true);
    expect(exited).toBe(0);
    expect(entered).toBe(1); // stayed active, did not re-enter
  });

  it("re-triggers on the next meeting after auto-revert", () => {
    p.onRaw(true); // meeting 1
    p.onRaw(false);
    nowMs += GRACE;
    p.tick(); // auto-revert
    expect(p.active).toBe(false);
    p.onRaw(true); // meeting 2
    expect(p.active).toBe(true);
    expect(entered).toBe(2);
  });

  it("leaveMeetingPhase deactivates without onExit and suppresses re-entry until signal clears", () => {
    p.onRaw(true); // active, raw still true (in call)
    p.leaveMeetingPhase();
    expect(p.active).toBe(false);
    expect(exited).toBe(0); // no end action: user already chose a phase

    p.onRaw(false); // call ends -> suppression lifts
    p.onRaw(true); // new call
    expect(p.active).toBe(true);
    expect(entered).toBe(2);
  });

  it("forceToggle forces on when idle and off (with end action) when active", () => {
    p.forceToggle();
    expect(p.active).toBe(true);
    expect(entered).toBe(1);
    p.forceToggle();
    expect(p.active).toBe(false);
    expect(exited).toBe(1);
  });

  it("ignores raw edges when disabled, but forceToggle still works", () => {
    enabled = false;
    p.onRaw(true);
    expect(p.active).toBe(false);
    expect(entered).toBe(0);
    p.forceToggle();
    expect(p.active).toBe(true);
    expect(entered).toBe(1);
  });
});
