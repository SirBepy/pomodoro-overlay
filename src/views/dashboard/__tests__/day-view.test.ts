import { describe, it, expect } from "vitest";
import { sessionRows, stripModel } from "../day-view";
import { startOfDay } from "../rollup";
import { PHASE_COLORS } from "../phase-colors";
import type { StatsEvent } from "../../../shared/stats";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const ev = (start_ms: number, end_ms: number | null, phase: StatsEvent["phase"] = "work"): StatsEvent => ({
  session_id: `s-${start_ms}`, phase, start_ms, end_ms, configured_seconds: 1500, ended_by: "natural",
});

describe("sessionRows", () => {
  const day = startOfDay(1_700_000_000_000);
  it("returns oldest-first rows with colors", () => {
    const rows = sessionRows([
      ev(day + 10 * HOUR, day + 10 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR, day + 9 * HOUR + 5 * MIN, "short"),
    ], day, day + 24 * HOUR);
    expect(rows.map((r) => r.startMs)).toEqual([day + 9 * HOUR, day + 10 * HOUR]);
    expect(rows[0].durationMs).toBe(5 * MIN);
    expect(rows[1].color).toBe(PHASE_COLORS.work);
  });
  it("merges consecutive same-phase events into one row (summed duration, first start)", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR, "work"),                       // 0m blink
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),            // 25m
      ev(day + 9 * HOUR + 25 * MIN, day + 9 * HOUR + 42 * MIN, "work"), // 17m
    ], day, day + 24 * HOUR);
    expect(rows).toHaveLength(1);
    expect(rows[0].startMs).toBe(day + 9 * HOUR);
    expect(rows[0].durationMs).toBe(42 * MIN);
    expect(rows[0].phase).toBe("work");
  });
  it("merges same-phase blocks across a dropped sub-minute event between them", () => {
    // 2:23 work 4m, 30s 'other' blip, 2:28 work 25m -> one Work row of 29m
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 4 * MIN, "work"),
      ev(day + 9 * HOUR + 4 * MIN, day + 9 * HOUR + 4 * MIN + 30_000, "other"),
      ev(day + 9 * HOUR + 5 * MIN, day + 9 * HOUR + 30 * MIN, "work"),
    ], day, day + 24 * HOUR);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("work");
    expect(rows[0].durationMs).toBe(29 * MIN);
  });
  it("merges two long breaks split only by a sub-minute event", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 12 * MIN, "long"),
      ev(day + 9 * HOUR + 12 * MIN, day + 9 * HOUR + 12 * MIN + 20_000, "work"),
      ev(day + 9 * HOUR + 13 * MIN, day + 9 * HOUR + 15 * MIN, "long"),
    ], day, day + 24 * HOUR);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("long");
    expect(rows[0].durationMs).toBe(14 * MIN);
  });
  it("starts a new row when a different phase intervenes", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR + 25 * MIN, day + 9 * HOUR + 30 * MIN, "short"),
      ev(day + 9 * HOUR + 30 * MIN, day + 9 * HOUR + 55 * MIN, "work"),
    ], day, day + 24 * HOUR);
    expect(rows.map((r) => r.phase)).toEqual(["work", "short", "work"]);
  });
  it("clips an open event to now", () => {
    const rows = sessionRows([ev(day + 9 * HOUR, null, "work")], day, day + 9 * HOUR + 10 * MIN);
    expect(rows[0].durationMs).toBe(10 * MIN);
  });
  it("sets endMs to start + summed duration of the merged group", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR + 25 * MIN, day + 9 * HOUR + 42 * MIN, "work"),
    ], day, day + 24 * HOUR);
    expect(rows[0].endMs).toBe(rows[0].startMs + 42 * MIN);
  });
  it("drops groups of one minute or less", () => {
    expect(sessionRows([ev(day + 9 * HOUR, day + 9 * HOUR + 30_000, "work")], day, day + 24 * HOUR)).toHaveLength(0);
    expect(sessionRows([ev(day + 9 * HOUR, day + 9 * HOUR, "work")], day, day + 24 * HOUR)).toHaveLength(0);
  });
  it("marks a row running when it holds an open event on the current day", () => {
    const now = day + 9 * HOUR + 10 * MIN;
    const rows = sessionRows([
      ev(day + 8 * HOUR, day + 8 * HOUR + 5 * MIN, "short"),
      ev(day + 9 * HOUR, null, "work"),
    ], day, now);
    expect(rows.map((r) => r.running)).toEqual([false, true]);
  });
  it("does not mark an open event running on a past day (it was cut at midnight)", () => {
    const now = day + 3 * 24 * HOUR;
    const rows = sessionRows([ev(day + 9 * HOUR, null, "work")], day, now);
    expect(rows).toHaveLength(1);
    expect(rows[0].running).toBe(false);
  });
});

describe("stripModel", () => {
  const day = startOfDay(1_700_000_000_000);
  const past = day + 100 * 24 * HOUR;

  it("returns null when every event is one minute or less", () => {
    expect(stripModel([ev(day + 9 * HOUR, day + 9 * HOUR + 30_000)], day, past, 240)).toBeNull();
    expect(stripModel([], day, past, 240)).toBeNull();
  });

  it("zooms from the hour floor of the first event to the hour ceil of the last end", () => {
    const m = stripModel([
      ev(day + 9 * HOUR + 12 * MIN, day + 9 * HOUR + 37 * MIN, "work"),
      ev(day + 14 * HOUR + 5 * MIN, day + 15 * HOUR + 42 * MIN, "work"),
    ], day, past, 240)!;
    expect(m.startMin).toBe(9 * 60);
    expect(m.endMin).toBe(16 * 60);
    expect(m.ticks).toHaveLength(8); // 9a .. 4p inclusive
    expect(m.ticks[0].pct).toBe(0);
    expect(m.ticks[7].pct).toBe(100);
    // 9:12 -> 12 of 420 minutes
    expect(m.marks[0].leftPct).toBeCloseTo((12 / 420) * 100, 5);
    expect(m.marks[0].widthPct).toBeCloseTo((25 / 420) * 100, 5);
  });

  it("keeps an end that already sits on the hour instead of adding another hour", () => {
    const m = stripModel([ev(day + 9 * HOUR, day + 10 * HOUR, "work")], day, past, 240)!;
    expect(m.endMin - m.startMin).toBe(60);
  });

  it("draws work and stopwatch tall, breaks and snooze short", () => {
    const m = stripModel([
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR + 25 * MIN, day + 9 * HOUR + 30 * MIN, "short"),
      ev(day + 9 * HOUR + 30 * MIN, day + 9 * HOUR + 50 * MIN, "other"),
      ev(day + 9 * HOUR + 50 * MIN, day + 9 * HOUR + 55 * MIN, "snooze"),
      ev(day + 9 * HOUR + 55 * MIN, day + 10 * HOUR + 20 * MIN, "long"),
    ], day, past, 240)!;
    expect(m.marks.map((x) => x.tall)).toEqual([true, false, true, false, false]);
  });

  it("drops sub-minute events from the marks and from the zoom window", () => {
    const m = stripModel([
      ev(day + 6 * HOUR, day + 6 * HOUR + 30_000, "work"),
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),
    ], day, past, 240)!;
    expect(m.marks).toHaveLength(1);
    expect(m.startMin).toBe(9 * 60);
  });

  it("adds an idle gap only when it is within the cap", () => {
    const events = [
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR + 45 * MIN, day + 10 * HOUR, "work"),     // 20m gap
      ev(day + 15 * HOUR, day + 15 * HOUR + 25 * MIN, "work"),    // 5h gap
    ];
    const m = stripModel(events, day, past, 240)!;
    expect(m.idleGaps).toHaveLength(1);
    expect(m.idleGaps[0].startMs).toBe(day + 9 * HOUR + 25 * MIN);
    expect(m.idleGaps[0].endMs).toBe(day + 9 * HOUR + 45 * MIN);
    expect(stripModel(events, day, past, 10)!.idleGaps).toHaveLength(0);
  });

  it("shows the now marker on today only, and stretches the window to now", () => {
    const events = [ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work")];
    const now = day + 11 * HOUR + 30 * MIN;
    const today = stripModel(events, day, now, 240)!;
    expect(today.endMin).toBe(12 * 60);
    expect(today.nowPct).toBeCloseTo((150 / 180) * 100, 5);
    expect(stripModel(events, day, past, 240)!.nowPct).toBeNull();
  });

  it("clips an open event to now on today", () => {
    const now = day + 9 * HOUR + 40 * MIN;
    const m = stripModel([ev(day + 9 * HOUR, null, "work")], day, now, 240)!;
    expect(m.marks[0].endMs).toBe(now);
  });
});
