import { defineSchema } from "../../../vendor/tauri_kit/frontend/settings/schema";

export const settingsSchema = defineSchema({
  sections: [
    {
      title: "Times",
      fields: [
        { key: "work_minutes", kind: "integer", label: "Pomodoro", min: 1, max: 180 },
        { key: "short_break_minutes", kind: "integer", label: "Short break", min: 1, max: 60 },
        { key: "long_break_minutes", kind: "integer", label: "Long break", min: 1, max: 120 },
        { key: "sessions_before_long_break", kind: "integer", label: "Sessions before long break", min: 1, max: 10 },
        { key: "auto_start_work", kind: "toggle", label: "Auto-start work phase" },
        { key: "auto_start_break", kind: "toggle", label: "Auto-start break phase" },
        { key: "reset_on_restart", kind: "toggle", label: "Reset progress on restart" },
        { key: "editable_when_paused", kind: "toggle", label: "Edit timer while paused" },
      ],
    },
    {
      title: "Window",
      fields: [
        {
          key: "corner",
          kind: "select",
          label: "Corner",
          options: [
            { value: "tl", label: "Top Left" },
            { value: "tr", label: "Top Right" },
            { value: "bl", label: "Bottom Left" },
            { value: "br", label: "Bottom Right" },
          ],
        },
        { key: "always_on_top", kind: "toggle", label: "Always on top" },
        {
          key: "return_to_corner_seconds",
          kind: "integer",
          label: "Return to corner after",
          min: 0,
          max: 3600,
          tooltip:
            "Seconds before the overlay snaps back to its corner after you drag it. Set to 0 to never return.",
        },
        {
          key: "fade_when",
          kind: "select",
          label: "Fade when not hovered",
          options: [
            { value: "never", label: "Never" },
            { value: "running", label: "Only when timer is running" },
            { value: "always", label: "Always" },
          ],
        },
        {
          key: "idle_opacity",
          kind: "range",
          label: "Transparency",
          min: 0,
          max: 1,
          step: 0.05,
          visibleWhen: (s) => s.fade_when !== "never",
        },
        { key: "auto_collapse", kind: "toggle", label: "Collapse on mouse leave" },
        { key: "fullscreen_on_focus_end", kind: "toggle", label: "Fullscreen when focus ends" },
      ],
    },
    {
      title: "Sound",
      fields: [
        { key: "sound_enabled", kind: "toggle", label: "Play sound on timer end" },
        { key: "volume", kind: "range", label: "Volume", min: 0, max: 1, step: 0.05 },
        {
          key: "sound_path",
          kind: "file",
          label: "Custom sound",
          pickerCommand: "pick_sound_file",
          defaultLabel: "Default tone",
        },
        { key: "pause_music_on_break", kind: "toggle", label: "Pause music on break" },
        { key: "dnd_on_focus", kind: "toggle", label: "Suppress notifications during focus" },
      ],
    },
  ],
});

/** App-specific rows that render inline under the kit's System category. */
export const systemInline = [
  { key: "autostart", kind: "toggle" as const, label: "Launch at startup" },
];
