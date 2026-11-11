import { describe, it, expect, vi, beforeEach } from "vitest";

// fullscreen.ts reads window.__TAURI__ at import time, so the stub goes in first.
const invoke = vi.fn(() => Promise.resolve());
vi.stubGlobal("window", { __TAURI__: { core: { invoke } } });
const classes = new Set<string>();
vi.stubGlobal("document", {
  body: {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
  },
  getElementById: () => null,
});

const { enterOverlayFullscreen, initFullscreen, fsState } = await import("../fullscreen");

function init(settings: Record<string, unknown>) {
  initFullscreen({
    getSettings: () => settings,
    getPhase: () => "short",
    onFullscreenEnter: vi.fn(),
    refreshClickThrough: vi.fn(),
  });
}

describe("enterOverlayFullscreen", () => {
  beforeEach(() => {
    invoke.mockClear();
    classes.clear();
    fsState.isOverlayFullscreen = false;
  });

  it("goes fullscreen in the box form", async () => {
    init({ overlay_form: "box" });
    await enterOverlayFullscreen();
    expect(invoke).toHaveBeenCalledWith("set_window_fullscreen", { fullscreen: true });
    expect(fsState.isOverlayFullscreen).toBe(true);
    expect(classes.has("is-fullscreen")).toBe(true);
  });

  it("never goes fullscreen in the bar form, whichever path asks", async () => {
    init({ overlay_form: "bar", fullscreen_on_break: true, meeting_break_fullscreen: true });
    await enterOverlayFullscreen();
    expect(invoke).not.toHaveBeenCalled();
    expect(fsState.isOverlayFullscreen).toBe(false);
    expect(classes.has("is-fullscreen")).toBe(false);
  });
});
