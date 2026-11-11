import { describe, it, expect } from "vitest";
import { fmtDuration, fmt12, fmtHoursMinutes, fmtMinutes, splitHm, fmtHourShort } from "../fmt";

describe("fmtDuration", () => {
  it("shows minutes only when under 1h", () => {
    expect(fmtDuration(25 * 60_000)).toBe("25m");
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(59 * 60_000)).toBe("59m");
  });

  it("shows hours and minutes at 60m+", () => {
    expect(fmtDuration(60 * 60_000)).toBe("1h 0m");
    expect(fmtDuration(65 * 60_000)).toBe("1h 5m");
    expect(fmtDuration(90 * 60_000)).toBe("1h 30m");
  });
});

describe("fmt12", () => {
  it("formats midnight as 12 AM", () => {
    const d = new Date("2024-01-01T00:05:00");
    expect(fmt12(d.getTime())).toBe("12:05 AM");
  });

  it("formats noon as 12 PM", () => {
    const d = new Date("2024-01-01T12:00:00");
    expect(fmt12(d.getTime())).toBe("12:00 PM");
  });

  it("formats afternoon hour correctly", () => {
    const d = new Date("2024-01-01T14:30:00");
    expect(fmt12(d.getTime())).toBe("2:30 PM");
  });

  it("pads minutes", () => {
    const d = new Date("2024-01-01T09:05:00");
    expect(fmt12(d.getTime())).toBe("9:05 AM");
  });
});

describe("fmtHoursMinutes", () => {
  it("shows minutes only when under 1h", () => {
    expect(fmtHoursMinutes(5 * 60_000)).toBe("5m");
  });

  it("shows hours and minutes at 1h+", () => {
    expect(fmtHoursMinutes(65 * 60_000)).toBe("1h 5m");
  });
});

describe("splitHm", () => {
  it("floors to whole minutes and carries them into hours", () => {
    expect(splitHm(65 * 60_000 + 59_000)).toEqual({ h: 1, m: 5 });
    expect(splitHm(45 * 60_000)).toEqual({ h: 0, m: 45 });
    expect(splitHm(0)).toEqual({ h: 0, m: 0 });
  });
});

describe("fmtHourShort", () => {
  it("uses a/p with 12 for midnight and noon", () => {
    expect(fmtHourShort(new Date("2024-01-01T00:00:00").getTime())).toBe("12a");
    expect(fmtHourShort(new Date("2024-01-01T09:00:00").getTime())).toBe("9a");
    expect(fmtHourShort(new Date("2024-01-01T12:00:00").getTime())).toBe("12p");
    expect(fmtHourShort(new Date("2024-01-01T15:00:00").getTime())).toBe("3p");
  });
});

describe("fmtMinutes", () => {
  it("rounds and appends min", () => {
    expect(fmtMinutes(5 * 60_000)).toBe("5 min");
    expect(fmtMinutes(90_000)).toBe("2 min");
  });
});
