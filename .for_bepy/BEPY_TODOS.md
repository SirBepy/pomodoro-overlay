# Manual tasks for Bepy

- Review and push uncommitted changes in `~/.claude` repo: CLAUDE.md (Process Hygiene section), skills/close/rename-session.ps1 (PID-based rename), untracked skills/character-creator/. One unpushed commit already exists.
- Manually download v0.3.15 NSIS installer from GitHub Releases. The auto-updater on installs prior to 0.3.15 fails on the `ask()` ACL bug, so it can't self-upgrade past it.
- Verify CI release workflow triggered on v0.3.18 push (GitHub Actions, expect installer + auto-update manifest).
- Run `npm run tauri dev` and click through the stats QA checklist in `docs/superpowers/plans/2026-05-19-stats-tracking.md` Task 15, plus the dashboard visual QA in ai_todo #04 and the pie/sessions QA in ai_todo #07. (Playwright can't reach Tauri webview - must be done manually in the app.)
- Push the `vendor/tauri_kit` submodule (commit `48daec6`, scrollbar) BEFORE pushing the parent repo, or CI fails with "not our ref".
