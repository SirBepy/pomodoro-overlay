import { describe, it, expect, vi } from "vitest";

// clear-stats-field pulls in Tauri bindings that do not exist under vitest.
vi.stubGlobal("window", { __TAURI__: { core: { invoke: vi.fn() } } });

const { settingsSchema } = await import("../schema");

type S = Record<string, unknown>;
const fields = settingsSchema.sections.flatMap((sec) =>
  (sec.groups ?? []).flatMap((g) => g.fields),
);
const visible = (key: string, s: S) => {
  const f = fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f.visibleWhen ? f.visibleWhen(s) : true;
};

describe("section order and categories", () => {
  it("lists the seven sections under three root headings", () => {
    expect(settingsSchema.sections.map((s) => [s.title, s.category])).toEqual([
      ["Timer", "Timer & overlay"],
      ["Overlay", "Timer & overlay"],
      ["Sound", "Timer & overlay"],
      ["Focus & breaks", "Automation"],
      ["Meetings", "Automation"],
      ["Keybinds", "Other"],
      ["Stats", "Other"],
    ]);
  });

  it("uses the renamed keys and drops the retired ones", () => {
    const keys = fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["hide_from_capture", "fullscreen_on_break", "pause_music"]));
    for (const old of ["meeting_hide_from_capture", "fullscreen_on_focus_end", "pause_music_on_break", "auto_collapse"]) {
      expect(keys).not.toContain(old);
    }
  });
});

describe("visibleWhen predicates", () => {
  it("shows box-only fields unless the form is bar", () => {
    for (const key of ["corner", "return_to_corner_seconds", "fullscreen_on_break"]) {
      expect(visible(key, { overlay_form: "box" })).toBe(true);
      expect(visible(key, { overlay_form: "bar" })).toBe(false);
    }
  });

  it("shows bar-only fields only in the bar form", () => {
    for (const key of ["bar_monitor", "bar_edge", "bar_size"]) {
      expect(visible(key, { overlay_form: "bar" })).toBe(true);
      expect(visible(key, { overlay_form: "box" })).toBe(false);
    }
  });

  it("gates volume and custom sound on sound_enabled", () => {
    for (const key of ["volume", "sound_path"]) {
      expect(visible(key, { sound_enabled: true })).toBe(true);
      expect(visible(key, { sound_enabled: false })).toBe(false);
    }
  });

  it("gates meeting apps and browsers on detection", () => {
    for (const key of ["meeting_apps", "meeting_browsers"]) {
      expect(visible(key, { meeting_detection_enabled: true })).toBe(true);
      expect(visible(key, { meeting_detection_enabled: false })).toBe(false);
    }
  });

  it("keep-awake needs a fullscreen break outside the bar", () => {
    expect(visible("keep_awake_during_fullscreen", { overlay_form: "box", fullscreen_on_break: true })).toBe(true);
    expect(visible("keep_awake_during_fullscreen", { overlay_form: "box", fullscreen_on_break: false })).toBe(false);
    expect(visible("keep_awake_during_fullscreen", { overlay_form: "bar", fullscreen_on_break: true })).toBe(false);
  });

  it("post-meeting fullscreen needs a break action outside the bar", () => {
    expect(visible("meeting_break_fullscreen", { meeting_end_action: "break", overlay_form: "box" })).toBe(true);
    expect(visible("meeting_break_fullscreen", { meeting_end_action: "focus", overlay_form: "box" })).toBe(false);
    expect(visible("meeting_break_fullscreen", { meeting_end_action: "break", overlay_form: "bar" })).toBe(false);
  });

  it("leaves the after-meeting action ungated because the hotkey runs it too", () => {
    expect(visible("meeting_end_action", { meeting_detection_enabled: false })).toBe(true);
  });
});
