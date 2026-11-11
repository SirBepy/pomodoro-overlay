import { describe, it, expect } from "vitest";
import { weekWindow, weekFocus, weekScale, weekGridlines, weekSummary } from "../week";
import { addDays, startOfDay } from "../rollup";
import type { StatsEvent } from "../../../shared/stats";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const ev = (start_ms: number, end_ms: number | null, phase: StatsEvent["phase"] = "work"): StatsEvent => ({
  session_id: `s-${start_ms}`, phase, start_ms, end_ms, configured_seconds: 1500, ended_by: "natural",
});

const today = startOfDay(1_700_000_000_000);

describe("weekWindow", () => {
  it("ends today by default and spans 7 days", () => {
    const w = weekWindow(today, today, null);
    expect(w.endDay).toBe(today);
    expect(w.startDay).toBe(addDays(today, -6));
  });

  it("keeps a paged-back window while the selected day is inside it", () => {
    const end = addDays(today, -7);
    const w = weekWindow(addDays(today, -9), today, end);
    expect(w.endDay).toBe(end);
  });

  it("slides one day forward when the selection steps past the window end", () => {
    const end = addDays(today, -7);
    const w = weekWindow(addDays(end, 1), today, end);
    expect(w.endDay).toBe(addDays(end, 1));
  });

  it("slides one day back when the selection steps before the window start", () => {
    const w = weekWindow(addDays(today, -7), today, null); // window starts at today-6
    expect(w.startDay).toBe(addDays(today, -7));
    expect(w.endDay).toBe(addDays(today, -1));
  });

  it("never ends after today", () => {
    expect(weekWindow(today, today, addDays(today, 3)).endDay).toBe(today);
  });

  it("brings a far-away picked day to the left edge", () => {
    const picked = addDays(today, -40);
    const w = weekWindow(picked, today, null);
    expect(w.startDay).toBe(picked);
  });
});

describe("weekFocus", () => {
  const start = addDays(today, -6);

  it("returns 7 days with work time only", () => {
    const days = weekFocus([
      ev(start + 9 * HOUR, start + 10 * HOUR, "work"),
      ev(start + 10 * HOUR, start + 11 * HOUR, "short"),
    ], start, today + 24 * HOUR);
    expect(days).toHaveLength(7);
    expect(days[0].dayStart).toBe(start);
    expect(days[0].workMs).toBe(HOUR);
    expect(days[1].workMs).toBe(0);
  });

  it("splits an event that crosses midnight between both days", () => {
    const days = weekFocus([ev(start + 23 * HOUR, start + 25 * HOUR, "work")], start, today + 24 * HOUR);
    expect(days[0].workMs).toBe(HOUR);
    expect(days[1].workMs).toBe(HOUR);
  });

  it("counts an open event up to now, on today", () => {
    const now = today + 9 * HOUR + 30 * MIN;
    const days = weekFocus([ev(today + 9 * HOUR, null, "work")], start, now);
    expect(days[6].workMs).toBe(30 * MIN);
  });

  it("keeps sub-minute work in the day total", () => {
    const days = weekFocus([ev(start + 9 * HOUR, start + 9 * HOUR + 30_000, "work")], start, today + 24 * HOUR);
    expect(days[0].workMs).toBe(30_000);
  });

  it("is all zeros for an empty window", () => {
    expect(weekFocus([], start, today).every((d) => d.workMs === 0)).toBe(true);
  });
});

describe("weekScale", () => {
  it("is at least 6h", () => {
    expect(weekScale(0)).toBe(6 * HOUR);
    expect(weekScale(5 * HOUR)).toBe(6 * HOUR);
    expect(weekScale(6 * HOUR)).toBe(6 * HOUR);
  });
  it("rounds the busiest day up to a whole 2h step beyond 6h", () => {
    expect(weekScale(6 * HOUR + 1)).toBe(8 * HOUR);
    expect(weekScale(9 * HOUR)).toBe(10 * HOUR);
  });
});

describe("weekGridlines", () => {
  it("draws 2h, 4h, 6h at the minimum scale", () => {
    expect(weekGridlines(6 * HOUR)).toEqual([2 * HOUR, 4 * HOUR, 6 * HOUR]);
  });
  it("thins to every 4h on a tall scale so labels stay readable", () => {
    expect(weekGridlines(12 * HOUR)).toEqual([4 * HOUR, 8 * HOUR, 12 * HOUR]);
  });
});

describe("weekSummary", () => {
  it("averages over all 7 days including empty ones", () => {
    const days = [1, 2, 0, 0, 0, 0, 4].map((h, i) => ({ dayStart: i, workMs: h * HOUR }));
    const s = weekSummary(days);
    expect(s.totalMs).toBe(7 * HOUR);
    expect(s.avgMs).toBe(HOUR);
  });
});
