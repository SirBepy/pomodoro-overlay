import { describe, it, expect } from "vitest";
import {
  totalTodayMs,
  formatTotalHM,
  renderElapsedSummary,
} from "../elapsed-summary";
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

describe("formatTotalHM", () => {
  it("shows hours and zero-padded minutes, no seconds", () => {
    expect(formatTotalHM(3 * HOUR + 47 * MIN)).toBe("3:47");
    expect(formatTotalHM(5 * MIN)).toBe("0:05");
    expect(formatTotalHM(0)).toBe("0:00");
    expect(formatTotalHM(12 * HOUR + 30 * MIN)).toBe("12:30");
  });

  it("floors partial minutes so the text only changes on a minute boundary", () => {
    expect(formatTotalHM(47 * MIN + 59_999)).toBe("0:47");
    expect(formatTotalHM(48 * MIN)).toBe("0:48");
  });
});

describe("renderElapsedSummary", () => {
  function node() {
    const writes: string[] = [];
    let text: string | null = "";
    return {
      writes,
      get textContent() {
        return text;
      },
      set textContent(v: string | null) {
        text = v;
        writes.push(v ?? "");
      },
    };
  }

  it("fills the run, the line total and the big total", () => {
    const els = { run: node(), total: node(), bigTotal: node() };
    renderElapsedSummary(els, 754, 3 * HOUR + 47 * MIN);
    expect(els.run.textContent).toBe("this run 12:34");
    expect(els.total.textContent).toBe("total 3:47");
    expect(els.bigTotal.textContent).toBe("3:47");
  });

  it("formats the run as MM:SS, gains an hour past 59:59, and pads a sub-hour total", () => {
    const els = { run: node(), total: node(), bigTotal: node() };
    renderElapsedSummary(els, 75, 3_725_000);
    expect(els.run.textContent).toBe("this run 01:15");
    expect(els.total.textContent).toBe("total 1:02");
    renderElapsedSummary(els, 3_661, 90_000);
    expect(els.run.textContent).toBe("this run 1:01:01");
    expect(els.total.textContent).toBe("total 0:01");
  });

  it("never says today", () => {
    const els = { run: node(), total: node(), bigTotal: node() };
    renderElapsedSummary(els, 1, 1);
    expect(els.total.textContent).not.toContain("today");
    expect(els.run.textContent).not.toContain("today");
  });

  it("rewrites the total only when the minute changes, the run every call", () => {
    const els = { run: node(), total: node(), bigTotal: node() };
    renderElapsedSummary(els, 10, 47 * MIN);
    renderElapsedSummary(els, 11, 47 * MIN + 20_000);
    renderElapsedSummary(els, 12, 47 * MIN + 59_000);
    expect(els.total.writes).toEqual(["total 0:47"]);
    expect(els.bigTotal.writes).toEqual(["0:47"]);
    expect(els.run.writes).toHaveLength(3);
    renderElapsedSummary(els, 13, 48 * MIN);
    expect(els.total.writes).toEqual(["total 0:47", "total 0:48"]);
    expect(els.bigTotal.writes).toEqual(["0:47", "0:48"]);
  });
});
