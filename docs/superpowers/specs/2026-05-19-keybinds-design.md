# Keybinds Design

**Date:** 2026-05-19
**Status:** Draft

## Overview

Add a "Keybinds" section to the settings page that lets the user bind global hotkeys to pause/resume and skip actions. Hotkeys fire system-wide regardless of which window has focus.

## Architecture

### Plugin

Add `tauri-plugin-global-shortcut` (Rust + JS). Handles OS-level hotkey registration and fires a callback when a registered combo is pressed.

### Settings storage

Two new optional string fields in `Settings`:

```rust
pub keybind_pause: Option<String>,  // e.g. "Alt+Space", null = not set
pub keybind_skip: Option<String>,   // e.g. "Alt+Right", null = not set
```

Both default to `None`. Persisted in `settings.json` via the existing save path. Format is Tauri's accelerator string: modifier(s) + key, e.g. `"Ctrl+Shift+P"`, `"Alt+Space"`.

### Rust: registration

A `register_hotkeys(app, old_pause, old_skip, new_pause, new_skip)` helper in a new `src-tauri/src/hotkeys.rs` module:

1. Unregister any previously registered shortcuts for pause/skip.
2. Register each non-None shortcut.
3. On activation, emit a Tauri event (`hotkey-pause` or `hotkey-skip`) to the main window.

Called from two places:
- `lib.rs` setup, after settings are loaded.
- `save_settings` command, after writing new settings to disk.

`save_settings` receives the previous keybinds from the in-memory state before overwriting, so it knows what to unregister.

### JS: hotkey event handling

In `main.ts`, add two `listen` calls alongside the existing tray/settings listeners:

```ts
await listen("hotkey-pause", () => {
  if (running) pauseTimer();
  else startTimer().catch(() => {});
});
await listen("hotkey-skip", () => {
  handlePhaseEnd().catch(() => {});
});
```

No changes to `pauseTimer` / `handlePhaseEnd` themselves.

### Settings UI: custom field

The kit's `custom` field kind takes `render(value, onChange) => TemplateResult`. A `keybindField` helper in `src/views/settings/keybind-field.ts` renders:

```
[ Pause/resume ]   [ Alt+Space ▾ ] [Record] [Clear]
```

States:
- **Idle, value set:** Shows the binding as a badge + "Record" + "Clear".
- **Idle, no value:** Shows "Not set" + "Record".
- **Recording:** Button says "Press a key..." (highlighted), listening for `keydown`. Any combo with at least one modifier key sets the value. Escape cancels without changing the value.

The captured combo is normalized to Tauri accelerator format: modifiers sorted `Ctrl+Alt+Shift+` then the key name (mapped from `e.key` to Tauri key names).

The field calls `onChange(acceleratorString)` on capture and `onChange(null)` on clear.

### Schema

New section added to `settingsSchema` in `schema.ts`:

```ts
{
  title: "Keybinds",
  groups: [
    {
      title: "Timer controls",
      fields: [
        keybindField({ key: "keybind_pause", label: "Pause / Resume" }),
        keybindField({ key: "keybind_skip",  label: "Skip phase" }),
      ],
    },
  ],
}
```

## Key mapping

`e.key` values are mapped to Tauri accelerator key names. Common cases:

| e.key       | Accelerator |
|-------------|-------------|
| ` ` (space) | Space       |
| ArrowLeft   | Left        |
| ArrowRight  | Right       |
| ArrowUp     | Up          |
| ArrowDown   | Down        |
| F1..F12     | F1..F12     |
| a..z / A..Z | A..Z        |
| 0..9        | 0..9        |

Modifier keys pressed alone (Control, Alt, Shift, Meta) are ignored - a valid combo requires at least one non-modifier key.

## Conflict handling

The plugin throws if a shortcut is already registered by another app. `register_hotkeys` wraps each registration in a `Result` and logs a warning on failure rather than crashing. No UI for this in v1 - if a bind fails silently, the user notices it doesn't work and can choose a different combo.

## Defaults

Both `keybind_pause` and `keybind_skip` default to `None` (not set). No pre-filled defaults - avoids conflicting with the user's existing hotkeys on first launch.

## Files changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-global-shortcut = "2"` |
| `package.json` / lockfile | Add `@tauri-apps/plugin-global-shortcut` |
| `src-tauri/src/lib.rs` | Register plugin, call `register_hotkeys` after load |
| `src-tauri/src/hotkeys.rs` | New: `register_hotkeys` helper |
| `src-tauri/src/settings.rs` | Add `keybind_pause`, `keybind_skip` fields |
| `src-tauri/src/ipc/commands.rs` | Update `save_settings` to re-register hotkeys |
| `src/views/settings/keybind-field.ts` | New: custom field renderer |
| `src/views/settings/schema.ts` | Add "Keybinds" section |
| `src/main.ts` | Add `hotkey-pause` and `hotkey-skip` listeners |
| `src-tauri/capabilities/*.json` | Add `global-shortcut:allow-*` permissions |
