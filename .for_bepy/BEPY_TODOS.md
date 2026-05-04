# Manual tasks for Bepy

- Run `npm run tauri dev` in pomodoro-overlay and verify all kit v2 tweaks: white border gone, schema is Times/Window/Sound, Auto-start work/break toggles in Times, tooltip on "Return to corner after", Transparency hidden when Fade=Never, easter-egg unlocks Copy debug logs after 5 taps on version.
- After verification: tell Claude "ship 0.3.0" and let the AI todo execute the bump + push + CI watch + auto-update test.
- Review and push uncommitted changes in `~/.claude` repo: CLAUDE.md (Process Hygiene section), skills/close/rename-session.ps1 (PID-based rename), untracked skills/character-creator/. One unpushed commit already exists.
