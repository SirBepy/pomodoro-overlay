import { defineSchema } from "../../vendor/tauri_kit/frontend/settings/schema";

export const settingsSchema = defineSchema({
  sections: [
    {
      title: "Times (minutes)",
      fields: [
        { key: "work_minutes", kind: "integer", label: "Pomodoro", min: 1, max: 180 },
        { key: "short_break_minutes", kind: "integer", label: "Short break", min: 1, max: 60 },
        { key: "long_break_minutes", kind: "integer", label: "Long break", min: 1, max: 120 },
        { key: "sessions_before_long_break", kind: "integer", label: "Sessions before long break", min: 1, max: 10 },
      ],
    },
    {
      title: "Position & Size",
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
        { key: "return_to_corner_seconds", kind: "integer", label: "Return to corner after (s, 0=never)", min: 0, max: 3600 },
      ],
    },
    {
      title: "Visibility",
      fields: [
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
        { key: "idle_opacity", kind: "range", label: "Transparent off hover", min: 0, max: 1, step: 0.05 },
        { key: "auto_collapse", kind: "toggle", label: "Collapse on mouse leave" },
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
      ],
    },
    {
      title: "Behavior",
      fields: [
        { key: "auto_advance", kind: "toggle", label: "Auto-start next phase" },
      ],
    },
  ],
});

/** App-specific rows that render inline under the kit's System category. */
export const systemInline = [
  { key: "autostart", kind: "toggle" as const, label: "Launch at startup" },
];
