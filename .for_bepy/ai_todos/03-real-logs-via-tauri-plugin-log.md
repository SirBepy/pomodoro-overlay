# Wire real logs into kit_copy_logs

## Goal
Replace the kit's placeholder `kit_copy_logs` (returns "no logs available") with actual log file content. Apps that consume the kit get real "Copy debug logs" functionality with no per-app wiring.

## Context
Kit v2 ships `kit_copy_logs` Tauri command in `tauri/settings/src/commands.rs`. Default implementation reads `<app-data>/app.log` if present, else returns the placeholder string.

Pomodoro 0.3.0 (or whichever version is current when this todo runs) does not write any log file. The "Copy debug logs" button (revealed by 5x version tap easter-egg) therefore copies "no logs available" to clipboard. Functional but useless.

claude_usage_in_taskbar already uses a real logging setup via `tauri-plugin-log`, configured in its main.rs. That's the proven pattern.

Spec for kit v2 mentions this as future work: "kit can ship a tauri-plugin-log re-export so apps trivially get logging."

## Approach
Two paths, in order of preference:

**Option A — kit ships a logging plugin re-export (recommended):**
1. In kit's `tauri/settings/Cargo.toml`, add `tauri-plugin-log = "2"` as a dependency (or a feature-gated dependency).
2. Expose a kit helper: `tauri_kit_settings::with_logging() -> TauriPlugin<Wry>` that returns `tauri_plugin_log::Builder::new()` configured with sensible defaults (target = stdout + `<app-data>/app.log`, max size 5MB, rolling).
3. Apps call `.plugin(tauri_kit_settings::with_logging())` in their builder chain (like they do for `with_kit_commands`).
4. `kit_copy_logs` already reads `<app-data>/app.log` — once apps log there via `tauri-plugin-log`, the button works automatically.

**Option B — apps wire their own logging:**
- Document in the kit README that apps should pass `<app-data>/app.log` as the log target via their own `tauri-plugin-log` config.
- Kit doesn't add the plugin dep itself.
- More flexibility but more per-app work.

Recommend Option A.

**Pomodoro adoption (after kit ships A):**
1. Pull kit submodule
2. Add `.plugin(tauri_kit_settings::with_logging())` to pomodoro main.rs
3. Sprinkle `log::info!` / `log::warn!` calls at meaningful boundaries (timer phase change, settings save, updater check)
4. Bump pomodoro to next minor (e.g. 0.4.0)

**Verification:**
- Run pomodoro, do a few actions
- Open settings → About → unlock easter-egg → Copy debug logs → paste into a text file
- Verify the log contains real entries with timestamps + levels

## Acceptance
- [ ] Kit exposes `with_logging()` plugin helper with sensible defaults
- [ ] Pomodoro registers it and emits at least 5 distinct log events across a normal session
- [ ] Copy debug logs button copies real log content (not "no logs available")
- [ ] Log file rotates correctly under load (>5MB triggers rotation)
- [ ] No regression in pomodoro startup time (logging shouldn't add visible delay)

## Verification commands
```
# In kit:
cargo check --workspace

# In pomodoro:
cd src-tauri && cargo check
cd .. && npm run tauri dev
# Then manually exercise the app for ~30 seconds, open settings, copy logs, paste
```
