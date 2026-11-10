import { describe, it, expect } from "vitest";
import {
  shouldShowSign,
  signLayout,
  signLabel,
  formatTotalHM,
  SIGN_PAUSE_GRACE_MS,
} from "../focus-sign";

const ON = { focus_sign_enabled: true };

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
