# Manual tasks for Bepy

### Visual QA - spam-skip fullscreen race fix
- In `npm run tauri dev`, spam the skip button fast across several work<->break transitions: overlay must always return to the small corner window on work phases (never stay stuck fullscreen), and the saved corner size must survive a relaunch.

### Visual QA - 0.3.25 self-update
- 0.3.25 released and verified (reusable workflow built+published signed installer + correct `latest.json`). Just confirm your installed app actually auto-updates from 0.3.24 -> 0.3.25 (or grab the installer from Releases). After updating: voice mode / idle Discord should NO LONGER trigger meeting mode.

- Review and push uncommitted changes in `~/.claude` repo: CLAUDE.md (Process Hygiene section), skills/close/rename-session.ps1 (PID-based rename), untracked skills/character-creator/. One unpushed commit already exists.
- Manually download v0.3.15 NSIS installer from GitHub Releases. The auto-updater on installs prior to 0.3.15 fails on the `ask()` ACL bug, so it can't self-upgrade past it.
- Verify CI release workflow triggered on v0.3.23 push (GitHub Actions, expect installer + auto-update manifest), then relaunch the app to pull the update.
- Run `npm run tauri dev` and manually QA: stats checklist in `docs/superpowers/plans/2026-05-19-stats-tracking.md` Task 15, dashboard (header/pagination/summary/timeline/empty state/resize), pie chart (proportions/tooltips), sessions screen (rows/dots/scroll). Tell Claude any visual polish you want after.
### Visual QA - kit palette theming (PR #1)
- Open Settings > System: confirm a "Palette" row with 4 swatch cards (Void/Nebula/Glacier/Cosmo) appears below the Theme select.
- Click each palette: settings window should restyle live to that palette; active card gets the accent border.
- Set mode = System, then flip OS light/dark (Windows theme settings): settings window should follow and switch live without reopening.
- Set mode = Light/Dark explicitly: palette renders its -light / dark variant accordingly.
- Confirm the main timer face is unchanged (its colors are timer-state driven, not palette driven).
- Reopen the app after picking a non-default palette: it should persist (`__kit_palette` saved) and not reset to Void.

### Visual QA - meeting detection (core verified 0.3.22; these remain)
- Start a screen-share (Zoom/Meet "share screen"): overlay must be invisible in the shared view but still visible to you.
- Toggle "Hide overlay from screen share" off in settings: overlay becomes visible in shares again.
- Edit the "Meeting apps" list in settings, relaunch, confirm a newly-added app is detected (covers a call with camera+mic off in a native app).

### Visual QA - meeting mic/browser fix (logic + tests verified; confirm real-world)
- Have Discord running but NOT in a call: meeting mode must NOT trigger (the bug). Check the log shows mic:false now.
- Join a Discord voice call: meeting mode SHOULD trigger (via audio-render check).
- Start a Google Meet / Zoom-web call in the browser: meeting mode SHOULD still trigger (browser holds mic).
- Settings > Phone is unaffected; check the new "Meeting browsers" field shows the default browser list and is editable.

### Visual QA - VAPID copy-key button (ai_todo 06, build verified)
- Settings > Phone > Companion: a "VAPID public key" row with a "Copy" button appears below "Send test push".
- Click Copy: toast "VAPID public key copied."; paste elsewhere to confirm it's the real key (matches settings.json `vapid_public_key`). Use this when re-deploying the PWA / setting the repo variable.

### Phone push companion - pair your phone (setup + deploy DONE)
- PWA is live at https://sirbepy.github.io/pomodoro-overlay/ (Pages configured, VAPID key injected, verified).
- On Android Chrome: open that URL, Add to Home screen, open it, tap Enable notifications, grant permission, copy the pairing code, paste into desktop Settings > Pair phone.

### Visual QA - phone push companion
- Settings > enable "Notify my phone", click "Send test push": phone buzzes within seconds (with screen off too).
- Start a short work timer, let it end naturally: phone shows "Focus done / Now: Short break".
- Open the PWA: shows current phase, a live countdown, and "Ends ~HH:MM".
- Toggle off "Notify on focus end", end a focus phase: NO notification fires.
- Sleep the PC: PWA shows "updated Nm ago" staleness; desktop timer keeps working, no crash.
- (Optional) Clear the PWA's site data, trigger a push: desktop logs "subscription gone" and Settings shows the re-pair banner.
