# Manual tasks for Bepy

- Review and push uncommitted changes in `~/.claude` repo: CLAUDE.md (Process Hygiene section), skills/close/rename-session.ps1 (PID-based rename), untracked skills/character-creator/. One unpushed commit already exists.
- Manually download v0.3.15 NSIS installer from GitHub Releases. The auto-updater on installs prior to 0.3.15 fails on the `ask()` ACL bug, so it can't self-upgrade past it.
- Verify CI release workflow triggered on v0.3.19 push (GitHub Actions, expect installer + auto-update manifest).
- Run `npm run tauri dev` and manually QA: stats checklist in `docs/superpowers/plans/2026-05-19-stats-tracking.md` Task 15, dashboard (header/pagination/summary/timeline/empty state/resize), pie chart (proportions/tooltips), sessions screen (rows/dots/scroll). Tell Claude any visual polish you want after.
### Visual QA - kit palette theming (PR #1)
- Open Settings > System: confirm a "Palette" row with 4 swatch cards (Void/Nebula/Glacier/Cosmo) appears below the Theme select.
- Click each palette: settings window should restyle live to that palette; active card gets the accent border.
- Set mode = System, then flip OS light/dark (Windows theme settings): settings window should follow and switch live without reopening.
- Set mode = Light/Dark explicitly: palette renders its -light / dark variant accordingly.
- Confirm the main timer face is unchanged (its colors are timer-state driven, not palette driven).
- Reopen the app after picking a non-default palette: it should persist (`__kit_palette` saved) and not reset to Void.

### Visual QA - meeting detection
- Join a Zoom/Teams call: overlay should switch to "Other" + start timing, no fullscreen break, no end sounds.
- Google Meet: join with mic on, then mute - meeting-mode should stay active (stay-until-manual latch).
- Turn camera on/off in a browser call - verify it's detected.
- Press the meeting-toggle hotkey mid-call: mode turns OFF and does NOT immediately re-trigger; ending the call + a new call re-triggers.
- Press the hotkey with no call active: mode turns ON (covers silent browser calls).
- Start a screen-share (Zoom/Meet "share screen"): overlay must be invisible in the shared view but still visible to you.
- Toggle "Hide overlay from screen share" off in settings: overlay becomes visible in shares again.
- Edit the "Meeting apps" list in settings, relaunch, confirm a newly-added app is detected.
