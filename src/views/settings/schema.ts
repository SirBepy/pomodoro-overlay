import { defineSchema } from "../../../vendor/tauri_kit/frontend/settings/schema";
import { clearStatsField } from "./clear-stats-field";

// Root-nav headings (kit `category`). The kit appends System and About to the
// last one, so "Other" ends with them.
const CAT_TIMER = "Timer & overlay";
const CAT_AUTOMATION = "Automation";
const CAT_OTHER = "Other";

export const settingsSchema = defineSchema({
  sections: [
    {
      title: "Timer",
      category: CAT_TIMER,
      groups: [
        {
          title: "Durations",
          fields: [
            {
              key: "work_minutes",
              kind: "integer",
              label: "Focus length",
              min: 1,
              max: 180,
              tooltip: "Length of a focus session, in minutes.",
            },
            {
              key: "short_break_minutes",
              kind: "integer",
              label: "Short break length",
              min: 1,
              max: 60,
              tooltip: "Length of a short break, in minutes.",
            },
            {
              key: "long_break_minutes",
              kind: "integer",
              label: "Long break length",
              min: 1,
              max: 120,
              tooltip: "Length of a long break, in minutes.",
            },
          ],
        },
        {
          title: "Cycle",
          fields: [
            {
              key: "sessions_before_long_break",
              kind: "integer",
              label: "Sessions before long break",
              min: 1,
              max: 10,
              tooltip:
                "How many focus sessions before triggering the long break instead of a short one.",
            },
            {
              key: "reset_on_restart",
              kind: "toggle",
              label: "Reset session progress on launch",
              tooltip:
                "When on, every app launch starts at session 1. When off, your previous unfinished session resumes.",
            },
          ],
        },
        {
          title: "Auto-start",
          fields: [
            {
              key: "auto_start_work",
              kind: "toggle",
              label: "Auto-start focus",
              tooltip:
                "When a break ends, immediately start the next focus session.",
            },
            {
              key: "auto_start_break",
              kind: "toggle",
              label: "Auto-start break",
              tooltip:
                "When a focus session ends, immediately start the break.",
            },
          ],
        },
        {
          title: "Editing",
          fields: [
            {
              key: "editable_when_paused",
              kind: "toggle",
              label: "Edit time while paused",
              tooltip:
                "When paused, click the time digits to manually adjust them. Off = read-only.",
            },
            {
              key: "ltr_time_entry",
              kind: "toggle",
              label: "Type time left-to-right",
              visibleWhen: (s) => s.editable_when_paused === true,
              tooltip:
                "On: typing fills minutes first - \"1\"=10:00, \"12\"=12:00, \"123\"=12:30. Off: digits shift in from the right like a calculator - \"1\"=00:01, \"12\"=00:12.",
            },
          ],
        },
      ],
    },
    {
      title: "Overlay",
      category: CAT_TIMER,
      groups: [
        {
          title: "Form",
          fields: [
            {
              key: "overlay_form",
              kind: "select",
              label: "Form",
              options: [
                { value: "box", label: "Box in a corner" },
                { value: "bar", label: "Bar along a screen edge" },
              ],
              tooltip:
                "The overlay is either the corner box or an always-visible bar along a screen edge. Drag the bar (hold the click-through key while the timer runs) and it snaps to the nearest edge.",
            },
            {
              key: "corner",
              kind: "select",
              label: "Box corner",
              options: [
                { value: "tl", label: "Top Left" },
                { value: "tr", label: "Top Right" },
                { value: "bl", label: "Bottom Left" },
                { value: "br", label: "Bottom Right" },
              ],
              visibleWhen: (s) => s.overlay_form !== "bar",
            },
            {
              key: "return_to_corner_seconds",
              kind: "integer",
              label: "Return to corner after (seconds)",
              min: 0,
              max: 3600,
              visibleWhen: (s) => s.overlay_form !== "bar",
              tooltip:
                "After dragging the overlay, snap back to its corner this many seconds later. 0 = never snap back.",
            },
            {
              key: "bar_monitor",
              kind: "select",
              label: "Bar monitor",
              options: [
                { value: "overlay", label: "Same as the box" },
                { value: "primary", label: "Primary" },
                { value: "secondary", label: "Secondary" },
              ],
              visibleWhen: (s) => s.overlay_form === "bar",
              tooltip:
                "Secondary is the first monitor that is not the primary; with only one monitor it falls back to the box's.",
            },
            {
              key: "bar_edge",
              kind: "select",
              label: "Bar edge",
              options: [
                { value: "top", label: "Top" },
                { value: "bottom", label: "Bottom" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ],
              visibleWhen: (s) => s.overlay_form === "bar",
            },
            {
              key: "bar_size",
              kind: "select",
              label: "Bar size",
              options: [
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ],
              visibleWhen: (s) => s.overlay_form === "bar",
            },
          ],
        },
        {
          title: "Visibility",
          fields: [
            {
              key: "hide_when_widget_hosted",
              kind: "toggle",
              label: "Hide when in Taskbar Widgets",
              tooltip:
                "When Pomodoro is placed in the Taskbar Widgets host, hide the overlay (box or bar). Off keeps the overlay up beside the widget.",
            },
            {
              key: "hide_from_capture",
              kind: "toggle",
              label: "Hide from screen capture",
              tooltip:
                "Keep the overlay visible to you but invisible to screen capture and screen share. Always on, not only during meetings.",
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
              tooltip:
                "When the overlay should fade if your mouse isn't over it.",
            },
            {
              key: "idle_opacity",
              kind: "range",
              label: "Transparency",
              min: 0,
              max: 1,
              step: 0.05,
              visibleWhen: (s) => s.fade_when !== "never",
              tooltip:
                "How transparent the overlay gets when faded. 0 = invisible, 1 = fully visible.",
            },
          ],
        },
        {
          title: "Interaction",
          fields: [
            {
              key: "always_on_top",
              kind: "toggle",
              label: "Always on top",
              tooltip: "Keep the overlay above other windows.",
            },
            {
              key: "click_through_modifier",
              kind: "select",
              label: "Click-through while running",
              options: [
                { value: "none", label: "Off" },
                { value: "alt", label: "Hold Alt to interact" },
                { value: "ctrl", label: "Hold Ctrl to interact" },
                { value: "shift", label: "Hold Shift to interact" },
              ],
              tooltip:
                "While the timer runs, clicks pass through the overlay so you can use windows beneath it. Hold the chosen key to interact with the overlay. Off = always interactive.",
            },
          ],
        },
      ],
    },
    {
      title: "Sound",
      category: CAT_TIMER,
      groups: [
        {
          title: "Playback",
          fields: [
            {
              key: "sound_enabled",
              kind: "toggle",
              label: "Play sound when phase ends",
            },
            {
              key: "volume",
              kind: "range",
              label: "Volume",
              min: 0,
              max: 1,
              step: 0.05,
              visibleWhen: (s) => s.sound_enabled === true,
            },
            {
              key: "sound_path",
              kind: "file",
              label: "Custom sound",
              pickerCommand: "pick_sound_file",
              defaultLabel: "Default tone",
              visibleWhen: (s) => s.sound_enabled === true,
              tooltip: "Pick a .wav or .mp3 to play instead of the default chime.",
            },
          ],
        },
      ],
    },
    {
      title: "Focus & breaks",
      category: CAT_AUTOMATION,
      groups: [
        {
          title: "Fullscreen break",
          fields: [
            {
              key: "fullscreen_on_break",
              kind: "toggle",
              label: "Fullscreen during break",
              visibleWhen: (s) => s.overlay_form !== "bar",
              tooltip:
                "When a focus session ends, expand the overlay fullscreen for the duration of the break.",
            },
            {
              key: "keep_awake_during_fullscreen",
              kind: "toggle",
              label: "Keep PC awake during fullscreen",
              visibleWhen: (s) =>
                s.overlay_form !== "bar" && s.fullscreen_on_break === true,
              tooltip:
                "Block screensaver, sleep, and display-off while the break is fullscreen.",
            },
          ],
        },
        {
          title: "Distraction blocking",
          fields: [
            {
              key: "dnd_on_focus",
              kind: "toggle",
              label: "Do not disturb during focus",
              tooltip:
                "Silence Windows notifications during focus sessions. Restored on break.",
            },
            {
              key: "pause_music",
              kind: "select",
              label: "Pause music",
              tooltip:
                "Off: never pause. Whenever focus isn't running: pause on a manual pause or a break. Only when a break starts: pause just when a break phase begins.",
              options: [
                { value: "never", label: "Off" },
                { value: "not_running_focused", label: "Whenever focus isn't running" },
                { value: "on_break", label: "Only when a break starts" },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "Meetings",
      category: CAT_AUTOMATION,
      groups: [
        {
          title: "Detection",
          fields: [
            {
              key: "meeting_detection_enabled",
              kind: "toggle",
              label: "Auto-detect meetings",
              tooltip:
                "When you're in a call (a browser holding the camera/mic, or a known meeting app holding the mic), block fullscreen breaks, mute sounds, and switch to the Stopwatch.",
            },
            {
              key: "meeting_apps",
              kind: "text",
              label: "Meeting apps",
              visibleWhen: (s) => s.meeting_detection_enabled === true,
              tooltip:
                "Comma-separated process names for native call apps (Teams, Zoom, Slack, Webex). A call is detected when one of these holds the mic, which also works while you're muted. Apps that hold the mic whenever they run (e.g. Discord) can't be told apart from idle, so they're not auto-detected here - use the meeting hotkey for those. Takes effect when you save.",
            },
            {
              key: "meeting_browsers",
              kind: "text",
              label: "Meeting browsers",
              visibleWhen: (s) => s.meeting_detection_enabled === true,
              tooltip:
                "Comma-separated browser process names. Only these count when checking the camera/mic, so browser calls (Google Meet, Zoom-web) are detected while apps that hold the mic in the background (Discord, games) are ignored. Takes effect when you save.",
            },
          ],
        },
        {
          title: "When a meeting ends",
          fields: [
            {
              // Not gated on detection: the meeting hotkey runs this action too.
              key: "meeting_end_action",
              kind: "select",
              label: "After the meeting",
              options: [
                { value: "break", label: "Start a short break" },
                { value: "focus", label: "Go to focus" },
                { value: "nothing", label: "Do nothing" },
              ],
              tooltip:
                "What to do after a call is no longer detected (about 20 seconds after you leave - muting or turning the camera off won't trigger it).",
            },
            {
              key: "meeting_break_fullscreen",
              kind: "toggle",
              label: "Fullscreen the post-meeting break",
              visibleWhen: (s) =>
                s.meeting_end_action === "break" && s.overlay_form !== "bar",
              tooltip:
                "When a meeting ends and a short break starts, expand the overlay to fullscreen for the break.",
            },
          ],
        },
      ],
    },
    {
      title: "Keybinds",
      category: CAT_OTHER,
      groups: [
        {
          title: "Timer controls",
          fields: [
            { key: "keybind_pause", kind: "keybind", label: "Pause / Resume" },
            { key: "keybind_skip", kind: "keybind", label: "Skip phase" },
            { key: "keybind_snooze", kind: "keybind", label: "Snooze" },
            { key: "keybind_show_hide", kind: "keybind", label: "Show / Hide overlay" },
          ],
        },
        {
          title: "Meetings",
          fields: [
            { key: "keybind_meeting_toggle", kind: "keybind", label: "Toggle meeting mode" },
          ],
        },
      ],
    },
    {
      title: "Stats",
      category: CAT_OTHER,
      groups: [
        {
          title: "Data",
          fields: [
            {
              key: "stats_retention_days",
              kind: "integer",
              label: "Keep stats for (days)",
              min: 7,
              max: 365,
              tooltip: "Events older than this are deleted on startup. Default: 30 days.",
            },
            {
              key: "idle_gap_cap_minutes",
              kind: "integer" as const,
              label: "Ignore idle gaps longer than (minutes)",
              min: 30,
              max: 1440,
              tooltip:
                "Gaps between recorded activity longer than this are dropped from idle stats. Default 240 (4h) excludes sleep.",
            },
          ],
        },
        {
          title: "Danger zone",
          fields: [
            clearStatsField({ key: "stats_clear", label: "Clear stats" }),
          ],
        },
      ],
    },
  ],
});

/** App-specific rows that render inline under the kit's System category. */
export const systemInline = [
  {
    key: "autostart",
    kind: "toggle" as const,
    label: "Launch at startup",
    tooltip: "Run the overlay automatically when Windows starts.",
  },
];
