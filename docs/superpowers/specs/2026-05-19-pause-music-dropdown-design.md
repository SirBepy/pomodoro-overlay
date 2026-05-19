# Pause Music Dropdown

**Date:** 2026-05-19

## Summary

Replace the "Pause music on break" toggle with a "Pause music on" dropdown offering three modes.

## Options

| Value | Label | Behavior |
|---|---|---|
| `"never"` | never | Music is never touched |
| `"not_running_focused"` | not running focused | Pause when focus is not actively running: on break phases AND when user manually pauses during focus |
| `"on_break"` | on break | Pause only when a break phase starts (current behavior) |

## Files Changed

### src-tauri/src/settings.rs
- `pause_music_on_break: bool` → `pause_music_on_break: String`
- Default: `"never"` via `#[serde(default = "default_pause_music")]`
- Existing persisted `true`/`false` values will fail to deserialize and fall back to default (`"never"`) - acceptable tradeoff

### src/views/settings/schema.ts
- Field kind: `"toggle"` → `"select"`
- Options: `never`, `not running focused`, `on break`
- Tooltip updated to describe all three modes

### src/main.ts
- `startTimer()`: resume logic triggers for both `"on_break"` and `"not_running_focused"`; pause logic (break phase) same
- `pauseTimer()`: NEW - if `pause_music_on_break === "not_running_focused"` and `phase === PHASE_WORK`, pause music
- Snooze handler: no change needed (already checks `musicPausedByApp`)
- Settings-reset handler: no change needed (already clears `musicPausedByApp`)

## Logic Detail

```
startTimer():
  if setting !== "never":
    if WORK phase and musicPausedByApp → resume, clear flag
    if BREAK phase and not paused → pause, set flag (for both "on_break" and "not_running_focused")

pauseTimer():
  if setting === "not_running_focused" and WORK phase and not musicPausedByApp:
    pause music, set musicPausedByApp = true
```
