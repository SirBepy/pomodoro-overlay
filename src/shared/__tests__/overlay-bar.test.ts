import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  wantsBar,
  barLayout,
  barKey,
  barLabel,
  barState,
  initOverlayBar,
  evaluateBar,
  settleBarAfterFullscreen,
} from "../overlay-bar";

const MIN = 60_000;

describe("wantsBar", () => {
  it("is on for the bar form, off for the box", () => {
    expect(wantsBar({ overlay_form: "bar" }, false)).toBe(true);
    expect(wantsBar({ overlay_form: "box" }, false)).toBe(false);
  });

  it("is off for a missing or unset form", () => {
    expect(wantsBar({}, false)).toBe(false);
    expect(wantsBar(null, false)).toBe(false);
    expect(wantsBar(undefined, false)).toBe(false);
  });

  it("gives the window to the fullscreen break, then wants the bar back", () => {
    expect(wantsBar({ overlay_form: "bar" }, true)).toBe(false);
    expect(wantsBar({ overlay_form: "bar" }, false)).toBe(true);
  });
});

describe("barLayout", () => {
  it("rows for top/bottom, columns for left/right", () => {
    expect(barLayout("top")).toBe("bar-h");
    expect(barLayout("bottom")).toBe("bar-h");
    expect(barLayout("left")).toBe("bar-v");
    expect(barLayout("right")).toBe("bar-v");
  });

  it("defaults to the top bar", () => {
    expect(barLayout(undefined)).toBe("bar-h");
  });
});

describe("barKey", () => {
  const base = { bar_monitor: "secondary", bar_edge: "top", bar_size: "medium" };

  it("changes with each placement setting, so a change re-places the bar", () => {
    const keys = [
      barKey(base),
      barKey({ ...base, bar_monitor: "primary" }),
      barKey({ ...base, bar_edge: "left" }),
      barKey({ ...base, bar_size: "large" }),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it("is stable for unchanged settings", () => {
    expect(barKey(base)).toBe(barKey({ ...base }));
  });
});

describe("barLabel", () => {
  it("says what each phase is", () => {
    expect(barLabel("work", 0)).toBe("focusing");
    expect(barLabel("short", 0)).toBe("on break");
    expect(barLabel("long", 0)).toBe("on break");
    expect(barLabel("snooze", 0)).toBe("snoozed");
  });

  it("shows the day's total as H:MM in the Stopwatch", () => {
    expect(barLabel("other", 95 * MIN)).toBe("total 1:35");
    expect(barLabel("other", 0)).toBe("total 0:00");
  });
});

describe("evaluateBar", () => {
  // The module talks to the DOM and the Tauri bridge; stub just enough of both.
  let classes: Set<string>;
  let dataset: Record<string, string>;
  let label: { textContent: string };
  let calls: boolean[];
  let settings: Record<string, string>;
  let phase: string;
  let fullscreen: boolean;
  const refresh = vi.fn();

  beforeEach(() => {
    classes = new Set();
    dataset = {};
    label = { textContent: "" };
    calls = [];
    settings = { overlay_form: "box", bar_monitor: "secondary", bar_edge: "top", bar_size: "medium" };
    phase = "work";
    fullscreen = false;
    refresh.mockClear();
    barState.active = false;
    barState.key = "";
    vi.stubGlobal("document", {
      body: {
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
        },
        dataset,
      },
      querySelector: (sel: string) => (sel === ".bar-label" ? label : null),
    });
    vi.stubGlobal("window", {
      __TAURI__: {
        core: {
          invoke: (_cmd: string, args: { active: boolean }) => {
            calls.push(args.active);
            return Promise.resolve();
          },
        },
      },
    });
    initOverlayBar({
      getSettings: () => settings,
      getPhase: () => phase,
      isFullscreen: () => fullscreen,
      getTodayTotalMs: () => 0,
      refreshClickThrough: refresh,
    });
  });

  // placeBar/removeBar run on a promise chain.
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("leaves the box alone", async () => {
    evaluateBar();
    await settle();
    expect(calls).toEqual([]);
    expect(classes.has("is-bar")).toBe(false);
  });

  it("styles the bar once Rust has placed it, in every phase", async () => {
    settings.overlay_form = "bar";
    for (const p of ["work", "short", "long", "other", "snooze"]) {
      barState.active = false;
      classes.clear();
      phase = p;
      evaluateBar();
      await settle();
      expect(classes.has("is-bar"), p).toBe(true);
      expect(dataset.barLayout).toBe("bar-h");
      expect(label.textContent).toBe(barLabel(p, 0));
    }
  });

  it("switches box -> bar -> box live", async () => {
    settings.overlay_form = "bar";
    evaluateBar();
    await settle();
    expect(calls).toEqual([true]);
    expect(classes.has("is-bar")).toBe(true);

    settings.overlay_form = "box";
    evaluateBar();
    await settle();
    expect(calls).toEqual([true, false]);
    expect(classes.has("is-bar")).toBe(false);
    expect(dataset.barLayout).toBeUndefined();
  });

  it("does not re-place an unchanged bar, and re-places it when the edge changes", async () => {
    settings.overlay_form = "bar";
    evaluateBar();
    await settle();
    evaluateBar();
    await settle();
    expect(calls).toEqual([true]);

    settings.bar_edge = "left";
    evaluateBar();
    await settle();
    expect(calls).toEqual([true, true]);
    expect(dataset.barLayout).toBe("bar-v");
  });

  it("updates the label as the phase changes while the bar is up", async () => {
    settings.overlay_form = "bar";
    evaluateBar();
    await settle();
    phase = "short";
    evaluateBar();
    expect(label.textContent).toBe("on break");
  });

  it("clears the styling for the fullscreen break and re-places the bar after", async () => {
    settings.overlay_form = "bar";
    evaluateBar();
    await settle();

    fullscreen = true;
    settleBarAfterFullscreen();
    await settle();
    expect(classes.has("is-bar")).toBe(false);
    evaluateBar();
    await settle();
    // Rust left the bar inside the fullscreen command: no extra exit call.
    expect(calls).toEqual([true]);

    fullscreen = false;
    evaluateBar();
    await settle();
    expect(calls).toEqual([true, true]);
    expect(classes.has("is-bar")).toBe(true);
  });
});
