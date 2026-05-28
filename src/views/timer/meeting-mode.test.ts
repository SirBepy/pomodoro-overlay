import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MeetingPolicy } from "./meeting-mode";

const GRACE = 2000;

describe("MeetingPolicy", () => {
  let entered: number;
  let exited: number;
  let enabled: boolean;
  let p: MeetingPolicy;

  beforeEach(() => {
    vi.useFakeTimers();
    entered = 0;
    exited = 0;
    enabled = true;
    p = new MeetingPolicy({
      onEnter: () => entered++,
      onExit: () => exited++,
      isEnabled: () => enabled,
      graceMs: () => GRACE,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enters on a rising raw edge", () => {
    p.onRaw(true);
    expect(entered).toBe(1);
    expect(p.active).toBe(true);
  });

  it("does not exit immediately when raw falls (grace pending)", () => {
    p.onRaw(true);
    p.onRaw(false);
    expect(p.active).toBe(true);
    expect(exited).toBe(0);
  });

  it("auto-reverts after the grace period when raw stays clear", () => {
    p.onRaw(true);
    p.onRaw(false);
    vi.advanceTimersByTime(GRACE);
    expect(p.active).toBe(false);
    expect(exited).toBe(1);
  });

  it("a new rising edge during grace cancels the auto-revert", () => {
    p.onRaw(true);
    p.onRaw(false);
    vi.advanceTimersByTime(GRACE - 1);
    p.onRaw(true); // signal back before grace expires
    vi.advanceTimersByTime(GRACE);
    expect(p.active).toBe(true);
    expect(exited).toBe(0);
    expect(entered).toBe(1); // did not re-enter, just stayed active
  });

  it("re-triggers on the next meeting after auto-revert", () => {
    p.onRaw(true); // meeting 1
    p.onRaw(false);
    vi.advanceTimersByTime(GRACE); // auto-revert
    expect(p.active).toBe(false);
    p.onRaw(true); // meeting 2
    expect(p.active).toBe(true);
    expect(entered).toBe(2);
  });

  it("leaveMeetingPhase deactivates without onExit and suppresses re-entry until signal clears", () => {
    p.onRaw(true); // active, raw still true (in call)
    p.leaveMeetingPhase();
    expect(p.active).toBe(false);
    expect(exited).toBe(0); // no phase revert: user already chose a phase

    // Kit only emits on transitions; raw is still true, no new event. Simulate
    // the call ending (raw false) then a new call (raw true).
    p.onRaw(false); // call ends -> suppression lifts
    p.onRaw(true); // new call
    expect(p.active).toBe(true);
    expect(entered).toBe(2);
  });

  it("forceToggle forces on when idle and off (with revert) when active", () => {
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
