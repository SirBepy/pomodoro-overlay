# Comments for Bepy

## 2026-05-04

- **pause_music_on_break confirmed working in dev mode (v0.3.3).** Root cause of original failure unconfirmed - likely the setting was not saved post-release. COM initialization on `spawn_blocking` threads is a latent risk (unverified); if music pause regresses, that is suspect #1.

## 2026-05-02

- **Session ended mid-flight.** Pomodoro is at 0.2.1 (kit v1 settings). Plan F Tasks 9+10 (bump to 0.3.0, push, verify auto-update) were never run because user closed before final verification.
- **Unverified tweaks landed.** White border fix, schema reorganization (Times/Window/Sound), `auto_advance` → `auto_start_work`+`auto_start_break` split, tooltip on "Return to corner after", conditional visibility on Transparency, About-page easter-egg rerender fix — all committed locally but not exercised in `npm run tauri dev`. Run dev mode and click through every page before bumping to 0.3.0.
- **Backwards-compat migration untested.** `src-tauri/src/settings.rs::load` reads legacy `auto_advance` from old JSON files and maps it to both new flags. Test by manually editing your `%APPDATA%\com.sirbepy.pomodoro-overlay\settings.json` to add `"auto_advance": false` (and remove the new keys), then launch — both new flags should be `false`.
- **Logs button placeholder.** `kit_copy_logs` returns "no logs available" since pomodoro doesn't write logs yet. AI todo logged for `tauri-plugin-log` integration.
- **claude_usage migration deferred.** Phase 2, separate spec when ready. AI todo logged.
