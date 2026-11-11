import { describe, it, expect } from "vitest";
import { tileModels } from "../tiles";
import { heroModel } from "../hero";
import { latestSessions } from "../sessions";
import { barHeightPx } from "../week-chart";
import type { DayTotals } from "../rollup";
import type { SessionRow } from "../day-view";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const totals = (over: Partial<DayTotals> = {}): DayTotals => ({
  work_ms: 0, short_ms: 0, long_ms: 0, other_ms: 0, snooze_ms: 0, idle_ms: 0, work_sessions_completed: 0, ...over,
});

describe("tileModels", () => {
  it("renders nothing when every value is zero", () => {
    expect(tileModels(totals({ work_ms: 2 * HOUR }), 240)).toEqual([]);
  });

  it("hides zero tiles and keeps the order Breaks, Stopwatch, Idle, Snoozed", () => {
    const t = tileModels(totals({
      short_ms: 15 * MIN, long_ms: 30 * MIN, other_ms: 20 * MIN, idle_ms: 10 * MIN, snooze_ms: 5 * MIN,
    }), 240);
    expect(t.map((x) => x.key)).toEqual(["breaks", "other", "idle", "snooze"]);
    expect(tileModels(totals({ idle_ms: MIN, short_ms: MIN }), 240).map((x) => x.key)).toEqual(["breaks", "idle"]);
  });

  it("hides a tile whose value would display as 0m (seconds of idle between phase switches)", () => {
    expect(tileModels(totals({ idle_ms: 40_000, snooze_ms: 59_999 }), 240)).toEqual([]);
    expect(tileModels(totals({ idle_ms: 60_000 }), 240).map((x) => x.key)).toEqual(["idle"]);
  });

  it("sums short and long into the Breaks value", () => {
    const [breaks] = tileModels(totals({ short_ms: 15 * MIN, long_ms: 30 * MIN }), 240);
    expect(breaks.valueMs).toBe(45 * MIN);
  });

  it("spans the last tile across both columns when the count is odd", () => {
    const odd = tileModels(totals({ short_ms: MIN, other_ms: MIN, idle_ms: MIN }), 240);
    expect(odd.map((x) => x.wide)).toEqual([false, false, true]);
    const even = tileModels(totals({ short_ms: MIN, other_ms: MIN }), 240);
    expect(even.every((x) => !x.wide)).toBe(true);
    expect(tileModels(totals({ snooze_ms: MIN }), 240)[0].wide).toBe(true);
  });

  it("computes the rail share against all tracked time including work", () => {
    const t = tileModels(totals({ work_ms: 60 * MIN, short_ms: 20 * MIN, other_ms: 20 * MIN }), 240);
    expect(t[0].share).toBeCloseTo(0.2, 5);
    expect(t[1].share).toBeCloseTo(0.2, 5);
    expect(t[1].sub).toBe("20% of tracked time");
  });

  it("writes the break sub-line, adding the long part only when present", () => {
    expect(tileModels(totals({ short_ms: 15 * MIN, long_ms: 30 * MIN }), 240)[0].sub).toBe("15m short · 30m long");
    expect(tileModels(totals({ short_ms: 15 * MIN }), 240)[0].sub).toBe("15m short");
  });

  it("words the idle cap in hours when it is a whole number of hours", () => {
    const sub = (cap: number) => tileModels(totals({ idle_ms: MIN }), cap)[0].sub;
    expect(sub(240)).toBe("gaps under 4 hours");
    expect(sub(60)).toBe("gaps under 1 hour");
    expect(sub(90)).toBe("gaps under 90 minutes");
  });
});

describe("heroModel", () => {
  it("is off with no work time, whatever else happened", () => {
    const m = heroModel(totals({ short_ms: 10 * MIN }), true, "Tue 10 Nov", 1);
    expect(m.off).toBe(true);
    expect(m.title).toBe("No focus time");
  });

  it("titles today and past days differently", () => {
    expect(heroModel(totals({ work_ms: HOUR }), true, "Tue 10 Nov", null).title).toBe("Focused today");
    expect(heroModel(totals({ work_ms: HOUR }), false, "Sat 7 Nov", null).title).toBe("Focused on Sat 7 Nov");
  });

  it("carries sessions, first start and snooze through", () => {
    const m = heroModel(totals({ work_ms: HOUR, work_sessions_completed: 6, snooze_ms: 5 * MIN }), true, "x", 1234);
    expect(m).toMatchObject({ off: false, sessions: 6, sinceMs: 1234, snoozeMs: 5 * MIN });
  });
});

describe("latestSessions", () => {
  const row = (i: number): SessionRow => ({
    startMs: i, endMs: i + 1, phase: "work", durationMs: 1, color: "#000", running: false,
  });
  it("takes the four newest rows, newest first", () => {
    const rows = [1, 2, 3, 4, 5, 6].map(row);
    expect(latestSessions(rows).map((r) => r.startMs)).toEqual([6, 5, 4, 3]);
  });
  it("returns fewer when the day has fewer", () => {
    expect(latestSessions([row(1), row(2)]).map((r) => r.startMs)).toEqual([2, 1]);
  });
});

describe("barHeightPx", () => {
  it("is zero for a day without focus so the stub is drawn", () => {
    expect(barHeightPx(0, 6 * HOUR)).toBe(0);
  });
  it("never falls below 4px for a nonzero day", () => {
    expect(barHeightPx(MIN, 6 * HOUR)).toBe(4);
  });
  it("scales linearly to the 104px plot", () => {
    expect(barHeightPx(3 * HOUR, 6 * HOUR)).toBe(52);
    expect(barHeightPx(6 * HOUR, 6 * HOUR)).toBe(104);
  });
});
