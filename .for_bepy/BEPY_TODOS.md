# Manual tasks for Bepy

- Review and push uncommitted changes in `~/.claude` repo: CLAUDE.md (Process Hygiene section), skills/close/rename-session.ps1 (PID-based rename), untracked skills/character-creator/. One unpushed commit already exists.
- Manually download v0.3.15 NSIS installer from GitHub Releases. The auto-updater on installs prior to 0.3.15 fails on the `ask()` ACL bug, so it can't self-upgrade past it.
- Verify CI release workflow triggered on v0.3.19 push (GitHub Actions, expect installer + auto-update manifest).
- Run `npm run tauri dev` and manually QA: stats checklist in `docs/superpowers/plans/2026-05-19-stats-tracking.md` Task 15, dashboard (header/pagination/summary/timeline/empty state/resize), pie chart (proportions/tooltips), sessions screen (rows/dots/scroll). Tell Claude any visual polish you want after.
- Push the `vendor/tauri_kit` submodule (commit `48daec6`, scrollbar) BEFORE pushing the parent repo, or CI fails with "not our ref".

### Urgent
- Push the `vendor/tauri_kit` submodule commit `45a4661` (meeting-detection + capture-hide kit crates), THEN bump the parent submodule pointer (`git add vendor/tauri_kit` + commit) before the next release. Local builds work via the path dep, but CI/fresh-clone needs the pushed pointer or the meeting crates are missing.

### Visual QA - meeting detection
- Join a Zoom/Teams call: overlay should switch to "Other" + start timing, no fullscreen break, no end sounds.
- Google Meet: join with mic on, then mute - meeting-mode should stay active (stay-until-manual latch).
- Turn camera on/off in a browser call - verify it's detected.
- Press the meeting-toggle hotkey mid-call: mode turns OFF and does NOT immediately re-trigger; ending the call + a new call re-triggers.
- Press the hotkey with no call active: mode turns ON (covers silent browser calls).
- Start a screen-share (Zoom/Meet "share screen"): overlay must be invisible in the shared view but still visible to you.
- Toggle "Hide overlay from screen share" off in settings: overlay becomes visible in shares again.
- Edit the "Meeting apps" list in settings, relaunch, confirm a newly-added app is detected.
