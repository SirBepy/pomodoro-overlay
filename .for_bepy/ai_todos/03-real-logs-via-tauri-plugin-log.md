# Wire real logs into kit_copy_logs

## Goal

Replace the kit's placeholder `kit_copy_logs` (returns "no logs available") with actual log file content. Apps that consume the kit get real "Copy debug logs" functionality with no per-app wiring.

## Context

Kit part DONE (2026-05-04): `with_logging()` added to `tauri_kit_settings::lib.rs`. Adds stdout + `<app-data>/app.log` target, 5MB max, KeepAll rotation. Committed to sirbepy_tauri_kit main.

What remains: pomodoro adoption. Pomodoro needs to:
1. Pull updated kit submodule (`git submodule update --remote vendor/tauri_kit`)
2. Add `.plugin(tauri_kit_settings::with_logging())` to `src-tauri/src/main.rs` builder chain
3. Sprinkle `log::info!` / `log::warn!` at meaningful boundaries (timer phase change, settings save, updater check)
4. Bump pomodoro to 0.4.0 (or next minor)

Current pomodoro version shipped: 0.3.0 (as of this session).

## Approach

Pull submodule first:
```
git submodule update --remote vendor/tauri_kit
```

Then in main.rs, find the builder chain that calls `.plugin(tauri_kit_settings::with_kit_commands(...))` and add `.plugin(tauri_kit_settings::with_logging())` before or after it.

Log call sites: look for natural boundaries in main.rs and settings.rs. Minimum 5 distinct events per session.

Bump version + commit + push to trigger CI.

## Acceptance

- [ ] Kit submodule updated in pomodoro
- [ ] Pomodoro registers `with_logging()` and emits at least 5 distinct log events
- [ ] Copy debug logs button copies real log content (not "no logs available")
- [ ] Log file at `%APPDATA%\com.sirbepy.pomodoro-overlay\app.log` is created after running dev
- [ ] CI passes, 0.4.0 release published

## Verification commands

```
cd src-tauri && cargo check
cd .. && npm run tauri dev
# Run app ~30 seconds, open settings, About, tap version 5x, Copy debug logs, paste
```
