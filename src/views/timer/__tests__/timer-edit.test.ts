import { describe, it, expect } from "vitest";
import { pushDigit } from "../timer-edit";

// pushDigit places a typed digit into the 4-slot MMSS buffer. LTR fills
// left-to-right (minutes first); RTL shifts in from the right like a calculator.
// The buffer always starts fresh at ["0","0","0","0"] with count 0 on first keypress.

const START = ["0", "0", "0", "0"];
const show = (buf: string[]) => `${buf[0]}${buf[1]}:${buf[2]}${buf[3]}`;

/** Type a whole string of digits from a fresh buffer. */
function type(digits: string, ltr: boolean) {
  let buffer = [...START];
  let count = 0;
  for (const d of digits) {
    ({ buffer, count } = pushDigit(buffer, count, d, ltr));
  }
  return { buffer, count, display: show(buffer) };
}

describe("pushDigit - LTR (default)", () => {
  it("fills minutes first, matching the spec examples", () => {
    expect(type("1", true).display).toBe("10:00");
    expect(type("12", true).display).toBe("12:00");
    expect(type("123", true).display).toBe("12:30");
    expect(type("1234", true).display).toBe("12:34");
  });

  it("rolls the window left once all four slots are filled", () => {
    // 1234 -> full; a 5th digit drops the oldest so a mistype can be typed over.
    expect(type("12345", true).display).toBe("23:45");
    expect(type("123456", true).display).toBe("34:56");
  });
});

describe("pushDigit - RTL (legacy)", () => {
  it("shifts digits in from the right", () => {
    expect(type("1", false).display).toBe("00:01");
    expect(type("12", false).display).toBe("00:12");
    expect(type("123", false).display).toBe("01:23");
    expect(type("1234", false).display).toBe("12:34");
    expect(type("12345", false).display).toBe("23:45");
  });
});
