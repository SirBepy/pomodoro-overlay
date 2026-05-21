# Manual tasks for Bepy

- Review and push uncommitted changes in `~/.claude` repo: CLAUDE.md (Process Hygiene section), skills/close/rename-session.ps1 (PID-based rename), untracked skills/character-creator/. One unpushed commit already exists.
- Manually download v0.3.15 NSIS installer from GitHub Releases. The auto-updater on installs prior to 0.3.15 fails on the `ask()` ACL bug, so it can't self-upgrade past it.
- Verify CI release workflow triggered on v0.3.19 push (GitHub Actions, expect installer + auto-update manifest).
- Run `npm run tauri dev` and manually QA: stats checklist in `docs/superpowers/plans/2026-05-19-stats-tracking.md` Task 15, dashboard (header/pagination/summary/timeline/empty state/resize), pie chart (proportions/tooltips), sessions screen (rows/dots/scroll). Tell Claude any visual polish you want after.
- Push the `vendor/tauri_kit` submodule (commit `48daec6`, scrollbar) BEFORE pushing the parent repo, or CI fails with "not our ref".
