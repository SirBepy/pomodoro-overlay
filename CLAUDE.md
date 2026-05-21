@~/.claude/snippets/auto-commit.md

## Project

Pomodoro timer desktop overlay for Windows. Sits on top of other windows; supports snooze, fullscreen break mode, media/DnD integration.

Type: vite + Tauri 2.x (Rust backend)
Deploy: github-actions - release triggered by version bump in package.json (CI syncs tauri.conf.json + Cargo.toml)

## Structure

src/index.html + src/main.ts (timer UI, all phase/state logic), src/settings.html + src/views/settings/ (settings UI; schema.ts drives all fields), src/styles/base.css, src/shared/ (sounds, fullscreen), src/views/timer/ (return-to-corner, timer-edit), src-tauri/src/ (settings.rs, ipc/commands.rs, state.rs)

## Commands

- Dev: `npm run tauri dev`
- Verify TS: `npm run build`
- Verify Rust: `cargo check` (run inside src-tauri/)

## Rules

- No browser deploy, no React/Vue - lit-html templates only
- Window resize via WinAPI (no start_resize_dragging in Tauri 2.x)
- New settings field: update BOTH schema.ts AND settings.rs struct + Default impl, or field resets on restart
- Settings persisted via tauri-kit-settings; serde(default) on struct handles missing fields
- lit-html select: bind `?selected=${opt === current}` per option - never `.value=`
- Icons: src/favicon.png + src/favicon.ico exist - never overwrite; Tauri sizes in src-tauri/icons/
- Version bump: only update package.json - CI syncs tauri.conf.json + Cargo.toml automatically
- Timer phases: PHASE_WORK / PHASE_SHORT / PHASE_LONG - all music/DnD/fullscreen logic gates on these
