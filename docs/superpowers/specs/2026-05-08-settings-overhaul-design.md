# Settings Overhaul Design

**Date:** 2026-05-08
**Status:** Approved

## Problem

The settings UI has three sections (Times, Window, Sound) that absorb fields outside their domain:

- "Times" carries app-state (`reset_on_restart`) and UI-interaction (`editable_when_paused`) toggles alongside actual durations.
- "Window" mixes positioning, fade behavior, and the fullscreen feature.
- "Sound" carries DND and music-pause settings that aren't audio.

User reports getting lost: hard to predict where any given setting lives. Two specific pain points called out:

1. Where the fullscreen toggles live (currently buried in Window).
2. What "Reset progress on restart" actually means (easy to confuse with the danger-zone "Reset all settings").

## Goals

1. Re-group settings into sections that match the user's mental model.
2. Add sub-headers inside section pages so related fields cluster visually.
3. Relabel ambiguous fields and add tooltips where the label alone doesn't explain.
4. Keep all existing behavior. No new fields, no removed fields, no Rust changes.

## Non-goals

- No new settings.
- No new field types (no time-picker control, etc.).
- No design system / styling changes.
- No `reset_on_restart` semantic inversion (label clarification + tooltip is enough).

## Section taxonomy

5 root sections, in this nav order:

```
Settings
 |- Timer            timer durations + cycle + timer-related behavior
 |- Overlay          where the window sits and how it fades
 |- Focus mode       what happens during focus / break (fullscreen, distractions)
 |- Sound            audio
 \- System           kit-built-in (Theme, About, Reset all) + autostart + reset-progress
```

### Timer page

**Durations**
- Pomodoro length
- Short break length
- Long break length

**Cycle**
- Sessions before long break

**Behavior**
- Auto-start work phase
- Auto-start break phase
- Edit timer while paused

### Overlay page

**Position**
- Corner
- Always on top
- Return to corner after (seconds)

**Visibility**
- Fade when not hovered
- Transparency *(visible when fade != never)*
- Collapse on mouse leave

### Focus mode page

**Fullscreen on break**
- Fullscreen during break
- Keep PC awake during fullscreen *(visible only when above is on)*

**Distraction blocking**
- Do not disturb during focus
- Pause music on break

### Sound page

(no sub-headers - small enough to stay flat)

- Play sound when phase ends
- Volume
- Custom sound

### System page

Kit-built-in section already shows: Theme, Launch at startup (inline), About, Reset all settings.

Add to inline:
- Reset session progress on launch

## Label + tooltip changes

| Key | Old label | New label | Tooltip |
|---|---|---|---|
| `work_minutes` | Pomodoro | **Pomodoro length** | Length of a focus session, in minutes. |
| `short_break_minutes` | Short break | **Short break length** | Length of a short break, in minutes. |
| `long_break_minutes` | Long break | **Long break length** | Length of a long break, in minutes. |
| `sessions_before_long_break` | (same) | (same) | How many focus sessions before triggering the long break instead of a short one. |
| `auto_start_work` | (same) | (same) | When a break ends, immediately start the next focus session. |
| `auto_start_break` | (same) | (same) | When a focus session ends, immediately start the break. |
| `editable_when_paused` | (same) | (same) | When paused, click the time digits to manually adjust them. Off = read-only. |
| `corner` | (same) | (same) | (none) |
| `always_on_top` | (same) | (same) | Keep the overlay above other windows. |
| `return_to_corner_seconds` | Return to corner after | **Return to corner after (seconds)** | After dragging the overlay, snap back this many seconds later. 0 = never. (existing tooltip refined) |
| `fade_when` | (same) | (same) | When the overlay should fade if your mouse isn't over it. |
| `idle_opacity` | (same) | (same) | How transparent the overlay gets when faded. 0 = invisible, 1 = fully visible. |
| `auto_collapse` | (same) | (same) | Shrink the overlay to a compact strip when your mouse leaves. Hover to expand. |
| `fullscreen_on_focus_end` | Fullscreen when focus ends | **Fullscreen during break** | When a focus session ends, expand the overlay fullscreen for the duration of the break. |
| `keep_awake_during_fullscreen` | (same) | (same) | Block screensaver, sleep, and display-off while the break is fullscreen. |
| `dnd_on_focus` | Suppress notifications during focus | **Do not disturb during focus** | Silence Windows notifications during focus sessions. Restored on break. |
| `pause_music_on_break` | (same) | (same) | When a focus session ends, send a media-pause to your active player. |
| `sound_enabled` | Play sound on timer end | **Play sound when phase ends** | (none) |
| `volume` | (same) | (same) | (none) |
| `sound_path` | (same) | (same) | Pick a .wav or .mp3 to play instead of the default chime. |
| `autostart` | (same) | (same) | Run the overlay automatically when Windows starts. |
| `reset_on_restart` | Reset progress on restart | **Reset session progress on launch** | When on, every app launch starts at session 1. When off, your previous unfinished session resumes. |

## Visibility predicate addition

Add `visibleWhen: (s) => s.fullscreen_on_focus_end === true` to `keep_awake_during_fullscreen`. Mirrors the existing pattern on `idle_opacity`.

## Kit schema extension (sub-headers)

Currently `Section` only has `fields: Field[]`. Extend to optionally support grouped fields:

```ts
export interface SectionGroup {
  title?: string;       // optional sub-header. when omitted, no header is rendered.
  fields: Field[];
}

export interface Section {
  title: string;
  fields?: Field[];     // existing - flat layout (backward compatible)
  groups?: SectionGroup[]; // new - grouped layout
}
```

Either `fields` or `groups` is set, not both. Validation in `defineSchema` is not added (kit is internal; mistakes will surface in tests).

### Renderer change

In `vendor/tauri_kit/frontend/settings/pages/section.ts`:

- If `section.groups` is set: render one `<div class="kit-section">` per group, with `<div class="kit-section-title">${group.title}</div>` when title present.
- Else: existing flat rendering.

The existing `kit-section-title` class is already used by the System section in `root.ts`, so the visual style is reused.

### Test updates

- `vendor/tauri_kit/frontend/settings/schema.test.ts` - add a case constructing a schema with `groups`.
- `vendor/tauri_kit/frontend/settings/renderer.test.ts` (or a new section.test.ts if missing) - assert grouped rendering produces multiple sub-sections with sub-headers.

## App schema (`src/views/settings/schema.ts`)

Full rewrite using `groups` instead of `fields` for Timer / Overlay / Focus mode. Sound stays flat (3 fields). System page is kit-driven; the only inline addition is `reset_on_restart`.

```ts
export const settingsSchema = defineSchema({
  sections: [
    {
      title: "Timer",
      groups: [
        { title: "Durations", fields: [/* work, short, long */] },
        { title: "Cycle", fields: [/* sessions_before_long_break */] },
        { title: "Behavior", fields: [/* auto_start_work, auto_start_break, editable_when_paused */] },
      ],
    },
    {
      title: "Overlay",
      groups: [
        { title: "Position", fields: [/* corner, always_on_top, return_to_corner_seconds */] },
        { title: "Visibility", fields: [/* fade_when, idle_opacity, auto_collapse */] },
      ],
    },
    {
      title: "Focus mode",
      groups: [
        { title: "Fullscreen on break", fields: [/* fullscreen_on_focus_end, keep_awake_during_fullscreen (visibleWhen) */] },
        { title: "Distraction blocking", fields: [/* dnd_on_focus, pause_music_on_break */] },
      ],
    },
    {
      title: "Sound",
      fields: [/* sound_enabled, volume, sound_path */],
    },
  ],
});

export const systemInline = [
  { key: "autostart", kind: "toggle" as const, label: "Launch at startup", tooltip: "..." },
  { key: "reset_on_restart", kind: "toggle" as const, label: "Reset session progress on launch", tooltip: "..." },
];
```

## Files touched

- `vendor/tauri_kit/frontend/settings/schema.ts` (kit submodule)
- `vendor/tauri_kit/frontend/settings/pages/section.ts` (kit submodule)
- `vendor/tauri_kit/frontend/settings/schema.test.ts` (kit submodule)
- One section/renderer test file (kit submodule)
- `src/views/settings/schema.ts` (app)

## Files NOT touched

- `src-tauri/src/settings.rs` - no key changes, no default changes.
- Anything in `src-tauri/src/ipc/` or `src-tauri/src/lib.rs`.
- `src/main.ts`, `src/shared/*` - no behavior change.

## Risk

Low. Behavior unchanged. Pure UI restructure + label rewrites + new schema branch. Submodule push order matters: kit submodule commit must push before parent.
