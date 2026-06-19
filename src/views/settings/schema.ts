import { defineSchema } from "../../../vendor/tauri_kit/frontend/settings/schema";
import { clearStatsField } from "./clear-stats-field";
import { phonePairingField } from "./phone-pairing-field";

export const settingsSchema = defineSchema({
  sections: [
    {
      title: "Timer",
      groups: [
        {
          title: "Durations",
          fields: [
            {
              key: "work_minutes",
              kind: "integer",
              label: "Pomodoro length",
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
          ],
        },
        {
          title: "Behavior",
          fields: [
            {
              key: "auto_start_work",
              kind: "toggle",
              label: "Auto-start work phase",
              tooltip:
                "When a break ends, immediately start the next focus session.",
            },
            {
              key: "auto_start_break",
              kind: "toggle",
              label: "Auto-start break phase",
              tooltip:
                "When a focus session ends, immediately start the break.",
            },
            {
              key: "editable_when_paused",
              kind: "toggle",
              label: "Edit timer while paused",
              tooltip:
                "When paused, click the time digits to manually adjust them. Off = read-only.",
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
      ],
    },
    {
      title: "Overlay",
      groups: [
        {
          title: "Position",
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
            {
              key: "always_on_top",
              kind: "toggle",
              label: "Always on top",
              tooltip: "Keep the overlay above other windows.",
            },
            {
              key: "return_to_corner_seconds",
              kind: "integer",
              label: "Return to corner after (seconds)",
              min: 0,
              max: 3600,
              tooltip:
                "After dragging the overlay, snap back to its corner this many seconds later. 0 = never snap back.",
            },
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
            {
              key: "auto_collapse",
              kind: "toggle",
              label: "Collapse on mouse leave",
              tooltip:
                "Shrink the overlay to a compact strip when your mouse leaves. Hover to expand.",
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
      title: "Focus mode",
      groups: [
        {
          title: "Fullscreen on break",
          fields: [
            {
              key: "fullscreen_on_focus_end",
              kind: "toggle",
              label: "Fullscreen during break",
              tooltip:
                "When a focus session ends, expand the overlay fullscreen for the duration of the break.",
            },
            {
              key: "keep_awake_during_fullscreen",
              kind: "toggle",
              label: "Keep PC awake during fullscreen",
              visibleWhen: (s) => s.fullscreen_on_focus_end === true,
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
              key: "pause_music_on_break",
              kind: "select",
              label: "Pause music on",
              tooltip:
                "never: disabled. not running focused: pause whenever focus isn't actively running (manual pause or break). on break: pause only when a break phase starts.",
              options: [
                { value: "never", label: "never" },
                { value: "not_running_focused", label: "not running focused" },
                { value: "on_break", label: "on break" },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "Meeting mode",
      groups: [
        {
          title: "Detection",
          fields: [
            {
              key: "meeting_detection_enabled",
              kind: "toggle",
              label: "Auto-detect meetings",
              tooltip:
                "When you're in a call (a browser holding the camera/mic, or a known meeting app holding the mic), block fullscreen breaks, mute sounds, and switch to the Other timer.",
            },
            {
              key: "meeting_hide_from_capture",
              kind: "toggle",
              label: "Hide overlay from screen share",
              tooltip:
                "Keep the overlay visible to you but invisible to screen capture and screen-share.",
            },
            {
              key: "meeting_apps",
              kind: "text",
              label: "Meeting apps",
              tooltip:
                "Comma-separated process names for native call apps (Teams, Zoom, Slack, Webex). A call is detected when one of these holds the mic, which also works while you're muted. Apps that hold the mic whenever they run (e.g. Discord) can't be told apart from idle, so they're not auto-detected here - use the meeting hotkey for those. Takes effect when you save.",
            },
            {
              key: "meeting_browsers",
              kind: "text",
              label: "Meeting browsers",
              tooltip:
                "Comma-separated browser process names. Only these count when checking the camera/mic, so browser calls (Google Meet, Zoom-web) are detected while apps that hold the mic in the background (Discord, games) are ignored. Takes effect when you save.",
            },
            {
              key: "meeting_end_action",
              kind: "select",
              label: "When a meeting ends",
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
              visibleWhen: (s) => s.meeting_end_action === "break",
              tooltip:
                "When a meeting ends and a short break starts, expand the overlay to fullscreen for the break.",
            },
          ],
        },
        {
          title: "Manual toggle",
          fields: [
            { key: "keybind_meeting_toggle", kind: "keybind", label: "Toggle meeting mode" },
          ],
        },
      ],
    },
    {
      title: "Sound",
      groups: [
        {
          title: "Playback",
          fields: [
            {
              key: "sound_enabled",
              kind: "toggle",
              label: "Play sound when phase ends",
            },
            { key: "volume", kind: "range", label: "Volume", min: 0, max: 1, step: 0.05 },
            {
              key: "sound_path",
              kind: "file",
              label: "Custom sound",
              pickerCommand: "pick_sound_file",
              defaultLabel: "Default tone",
              tooltip: "Pick a .wav or .mp3 to play instead of the default chime.",
            },
          ],
        },
      ],
    },
    {
      title: "Phone",
      groups: [
        {
          title: "Companion",
          fields: [
            phonePairingField({ key: "phone_pairing", label: "Pairing code" }),
            {
              key: "phone_notify_enabled",
              kind: "toggle",
              label: "Notify my phone",
              tooltip:
                "Send a push to your paired phone when a phase ends naturally (skips stay silent).",
            },
            {
              key: "notify_on_work_end",
              kind: "toggle",
              label: "Notify on focus end",
              visibleWhen: (s) => s.phone_notify_enabled === true,
            },
            {
              key: "notify_on_short_end",
              kind: "toggle",
              label: "Notify on short break end",
              visibleWhen: (s) => s.phone_notify_enabled === true,
            },
            {
              key: "notify_on_long_end",
              kind: "toggle",
              label: "Notify on long break end",
              visibleWhen: (s) => s.phone_notify_enabled === true,
            },
          ],
        },
      ],
    },
    {
      title: "Keybinds",
      groups: [
        {
          title: "Timer controls",
          fields: [
            { key: "keybind_pause", kind: "keybind", label: "Pause / Resume" },
            { key: "keybind_skip", kind: "keybind", label: "Skip phase" },
            { key: "keybind_show_hide", kind: "keybind", label: "Show / Hide overlay" },
          ],
        },
      ],
    },
    {
      title: "Stats",
      groups: [
        {
          title: "Retention",
          fields: [
            {
              key: "stats_retention_days",
              kind: "integer",
              label: "Keep stats for (days)",
              min: 7,
              max: 365,
              tooltip: "Events older than this are deleted on startup. Default: 30 days.",
            },
          ],
        },
        {
          title: "Gaps",
          fields: [
            {
              key: "idle_gap_cap_minutes",
              kind: "integer" as const,
              label: "Idle gap cap (minutes)",
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
