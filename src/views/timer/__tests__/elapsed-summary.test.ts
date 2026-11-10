import { describe, it, expect } from "vitest";
import { totalTodayMs, formatElapsedSummary } from "../elapsed-summary";
import type { StatsEvent } from "../../../shared/stats";

const MIN = 60_000;
const HOUR = 60 * MIN;

function ev(
  phase: StatsEvent["phase"],
  start: number,
  end: number | null,
): StatsEvent {
  return {
    session_id: "s",
    phase,
    start_ms: start,
    end_ms: end,
    configured_seconds: null,
    ended_by: null,
  };
}

describe("totalTodayMs", () => {
  const dayStart = new Date(2026, 10, 10, 0, 0, 0, 0).getTime();
  const now = dayStart + 12 * HOUR;

  it("sums focus and stopwatch time and ignores breaks and snooze", () => {
    const events = [
      ev("work", dayStart + 9 * HOUR, dayStart + 9 * HOUR + 25 * MIN),
      ev("other", dayStart + 10 * HOUR, dayStart + 10 * HOUR + 10 * MIN),
      ev("short", dayStart + 11 * HOUR, dayStart + 11 * HOUR + 5 * MIN),
      ev("long", dayStart + 11 * HOUR + 10 * MIN, dayStart + 11 * HOUR + 25 * MIN),
      ev("snooze", dayStart + 11 * HOUR + 30 * MIN, dayStart + 11 * HOUR + 32 * MIN),
    ];
    expect(totalTodayMs(events, now)).toBe(35 * MIN);
  });

  it("counts the still-open interval up to now", () => {
    const events = [
      ev("work", dayStart + 9 * HOUR, dayStart + 9 * HOUR + 25 * MIN),
      ev("other", now - 7 * MIN, null),
    ];
    expect(totalTodayMs(events, now)).toBe(32 * MIN);
  });

  it("clips an event that began before midnight to today's part", () => {
    const events = [ev("other", dayStart - 20 * MIN, dayStart + 10 * MIN)];
    expect(totalTodayMs(events, now)).toBe(10 * MIN);
  });
});

describe("formatElapsedSummary", () => {
  it("formats run as MM:SS and total as H:MM:SS", () => {
    expect(formatElapsedSummary(75, 3_725_000)).toBe(
      "this run 01:15 · total today 1:02:05",
    );
  });

  it("shows hours on the run once it passes an hour and pads a sub-hour total", () => {
    expect(formatElapsedSummary(3_661, 90_000)).toBe(
      "this run 1:01:01 · total today 0:01:30",
    );
  });
});
