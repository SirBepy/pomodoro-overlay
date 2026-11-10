import { describe, it, expect } from "vitest";
import {
  shouldShowSign,
  advancePauseTracker,
  advanceDrop,
  SIGN_DROP_DEBOUNCE_MS,
  signLayout,
  signLabel,
  formatTotalHM,
  SIGN_PAUSE_GRACE_MS,
} from "../focus-sign";

const ON = { focus_sign_enabled: true };

describe("advancePauseTracker", () => {
  const idle = { wasRunning: false, pausedSince: null, phase: null };

  it("starts the grace when a Focus or Stopwatch run pauses", () => {
    for (const phase of ["work", "other"]) {
      const running = advancePauseTracker(idle, true, phase, 1000);
      expect(advancePauseTracker(running, false, phase, 5000).pausedSince, phase).toBe(5000);
    }
  });

  it("grants no grace to the idle timer a tab switch or skip lands on", () => {
    // pause() renders in the old phase, then the phase flips and renders again.
    for (const [from, to] of [["work", "other"], ["other", "work"]]) {
      const running = advancePauseTracker(idle, true, from, 1000);
      const pausedInOld = advancePauseTracker(running, false, from, 5000);
      expect(pausedInOld.pausedSince).toBe(5000);
      expect(advancePauseTracker(pausedInOld, false, to, 5001).pausedSince, `${from}->${to}`).toBeNull();
    }
  });

  it("grants no grace when a break ends into an idle Focus", () => {
    const onBreak = advancePauseTracker(idle, true, "short", 1000);
    const ended = advancePauseTracker(onBreak, false, "short", 5000);
    expect(advancePauseTracker(ended, false, "work", 5001).pausedSince).toBeNull();
  });

  it("grants no grace when a Focus run ends into an idle break, then the user skips back", () => {
    const focus = advancePauseTracker(idle, true, "work", 1000);
    const ended = advancePauseTracker(focus, false, "short", 5000);
    expect(advancePauseTracker(ended, false, "work", 6000).pausedSince).toBeNull();
  });

  it("drops an earlier pause's grace once the phase leaves Focus and Stopwatch", () => {
    const paused = { wasRunning: false, pausedSince: 5000, phase: "work" };
    const onBreak = advancePauseTracker(paused, false, "short", 6000);
    expect(advancePauseTracker(onBreak, false, "work", 7000).pausedSince).toBeNull();
  });

  it("keeps the first pause time while the timer stays paused", () => {
    const paused = { wasRunning: false, pausedSince: 5000, phase: "work" };
    expect(advancePauseTracker(paused, false, "work", 9000)).toBe(paused);
  });
});

describe("advanceDrop", () => {
  it("waits out the debounce before taking the sign down", () => {
    const first = advanceDrop(null, true, 1000);
    expect(first).toEqual({ dropAt: 1000, remove: false });
    expect(advanceDrop(first.dropAt, true, 1000 + SIGN_DROP_DEBOUNCE_MS - 1).remove).toBe(false);
    expect(advanceDrop(first.dropAt, true, 1000 + SIGN_DROP_DEBOUNCE_MS).remove).toBe(true);
  });

  it("forgets the pending drop when the sign is wanted again (meeting enter: pause, flip, start)", () => {
    const pending = advanceDrop(null, true, 1000);
    expect(advanceDrop(pending.dropAt, false, 1100)).toEqual({ dropAt: null, remove: false });
    // The next drop starts its own clock rather than inheriting the old one.
    expect(advanceDrop(null, true, 5000).remove).toBe(false);
  });
});

describe("signLayout", () => {
  it("rows for top/bottom bars, columns for side bars, card for the box", () => {
    expect(signLayout("bar", "top")).toBe("bar-h");
    expect(signLayout("bar", "bottom")).toBe("bar-h");
    expect(signLayout("bar", "left")).toBe("bar-v");
    expect(signLayout("bar", "right")).toBe("bar-v");
    expect(signLayout("box", "left")).toBe("box");
  });

  it("defaults to the top bar", () => {
    expect(signLayout(undefined, undefined)).toBe("bar-h");
  });
});

describe("sign label", () => {
  it("formats the total as H:MM with no seconds", () => {
    expect(formatTotalHM(0)).toBe("0:00");
    expect(formatTotalHM(59_999)).toBe("0:00");
    expect(formatTotalHM(60_000)).toBe("0:01");
    expect(formatTotalHM((2 * 60 + 5) * 60_000 + 59_000)).toBe("2:05");
  });

  it("says focusing in Focus and the day's total in Stopwatch", () => {
    expect(signLabel("work", 99 * 60_000)).toBe("focusing");
    expect(signLabel("other", 95 * 60_000)).toBe("total 1:35");
  });
});

describe("shouldShowSign", () => {
  it("shows for a running Focus", () => {
    expect(shouldShowSign("work", true, false, ON)).toBe(true);
  });

  it("shows for a running Stopwatch", () => {
    expect(shouldShowSign("other", true, false, ON)).toBe(true);
  });

  it("never shows for short break, long break or snooze, even while running", () => {
    for (const phase of ["short", "long", "snooze"]) {
      expect(shouldShowSign(phase, true, false, ON), phase).toBe(false);
    }
  });

  it("stays up through the pause grace and drops once it passes", () => {
    expect(shouldShowSign("work", false, false, ON, SIGN_PAUSE_GRACE_MS - 1)).toBe(true);
    expect(shouldShowSign("work", false, false, ON, SIGN_PAUSE_GRACE_MS)).toBe(false);
  });

  it("does not show for a timer that never ran", () => {
    expect(shouldShowSign("work", false, false, ON, Infinity)).toBe(false);
  });

  it("is hidden while the fullscreen break is up, running or not", () => {
    expect(shouldShowSign("work", true, true, ON)).toBe(false);
    expect(shouldShowSign("other", false, true, ON, 0)).toBe(false);
  });

  it("is hidden when the setting is off or missing", () => {
    expect(shouldShowSign("work", true, false, { focus_sign_enabled: false })).toBe(false);
    expect(shouldShowSign("work", true, false, {})).toBe(false);
    expect(shouldShowSign("work", true, false, null)).toBe(false);
  });
});
