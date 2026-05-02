# Ship pomodoro 0.3.0 (kit v2 adoption)

## Goal
Bump pomodoro-overlay to 0.3.0, push to main, watch CI publish the release, and verify end-to-end auto-update from installed 0.2.1 prompts and installs 0.3.0.

## Context
Plans E and F (kit v2 build + pomodoro adoption) executed during the 2026-05-02 session. Plan F Tasks 9+10 (bump + ship + verify) were not executed because the session ended after a mid-implementation easter-egg bug fix and several user-driven tweaks (schema reorg, auto_advance split, tooltip, visibleWhen, white-border fix). All those changes are committed locally on `main` but the version is still 0.2.1.

The user's installed app is 0.2.0 (or 0.2.1 — they had at least one prior version installed). They've successfully tested auto-update from 0.2.0 → 0.2.1 in a previous round, so the pipeline is proven.

Latest local pomodoro commits (newest first):
- `91a0ba2` CHORE: pull kit fix for version-tap rerender
- `6437111` FEAT: split auto_advance into auto_start_work + auto_start_break...
- `e6205e7` FEAT: main window listens for settings-reset event and reloads
- `8dd1a79` REFACTOR: app startup uses runAutoUpdateCheck...
- ...etc.

Latest kit commit on main: `c157800` (FIX: about page version-tap easter-egg rerender).

Plan reference: `docs/superpowers/plans/2026-05-02-plan-f-pomodoro-adopts-kit-v2.md` Tasks 9+10.

## Approach
**Pre-flight:** confirm user has manually verified the kit v2 settings UI in `npm run tauri dev`. If they haven't, do not ship — run them through the manual UX check from Plan F Task 8 first (drill into every section, verify white border gone, easter-egg works, tooltip + conditional Transparency work, auto_advance split shows Work + Break toggles).

**Bump (3 files):**
- `package.json`: `"version": "0.3.0"`
- `src-tauri/tauri.conf.json`: `"version": "0.3.0"`
- `src-tauri/Cargo.toml`: `version = "0.3.0"`

**Verify locally:**
- `cd src-tauri; cargo check`
- `npm run build`

**Commit + push:**
- `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`
- `git commit -m "CHORE: bump to v0.3.0 (kit v2 adoption)"`
- `git push origin main`

**Watch CI (~10-15 min on Windows):**
- `gh run list -R SirBepy/pomodoro-overlay --limit 1` to find the run id
- `gh run watch <id> -R SirBepy/pomodoro-overlay --exit-status` (run_in_background: true)

**Verify release:**
- `gh release view tauri-v0.3.0 -R SirBepy/pomodoro-overlay` — assets: `.exe`, `.exe.sig`, `.msi`, `latest.json`
- `curl -sL https://github.com/SirBepy/pomodoro-overlay/releases/latest/download/latest.json` — version should be 0.3.0, signature non-empty, URL points to the 0.3.0 .exe

**End-to-end auto-update:**
- User launches their installed 0.2.0/0.2.1
- Within ~5s, prompt should appear: "Version 0.3.0 is available. Install now?"
- User clicks Yes → downloads + installs + restarts at 0.3.0
- User opens settings → all kit v2 features work (drill-in, theme, About, etc.)
- Settings file at `%APPDATA%\com.sirbepy.pomodoro-overlay\settings.json` preserves their previous values; new `__kit_*` keys default sensibly; legacy `auto_advance` (if present) maps to both new flags

## Acceptance
- [ ] User has manually verified all kit v2 tweaks in dev mode (the full UX checklist above)
- [ ] Pomodoro 3 version sources match at 0.3.0
- [ ] CI run for `tauri-v0.3.0` succeeded green
- [ ] GitHub release `tauri-v0.3.0` published with `.exe`, `.exe.sig`, `.msi`, `latest.json`
- [ ] `latest.json` correctly serves version 0.3.0 with valid signature
- [ ] Installed prior version → upgrade prompt → install → 0.3.0 launches with settings preserved
- [ ] No regressions: pomodoro overlay timer/hover/corner behavior unchanged

## Verification commands
```
cd src-tauri && cargo check
cd .. && npm run build
gh release view tauri-v0.3.0 -R SirBepy/pomodoro-overlay
curl -sL https://github.com/SirBepy/pomodoro-overlay/releases/latest/download/latest.json
```
