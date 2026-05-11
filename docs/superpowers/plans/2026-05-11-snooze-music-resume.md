# Snooze Music Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume music when the user presses snooze during a break, then re-pause it when snooze ends and the break resumes.

**Architecture:** Intercept the snooze button click in `main.ts` before delegating to `startSnooze()`. If `musicPausedByApp` is true, fire `media_resume` and reset the flag. Re-pause on snooze end is already handled naturally by the existing `startTimer()` logic.

**Tech Stack:** TypeScript, Tauri 2.x (`invoke`), lit-html

---

### Task 1: Resume music on snooze

**Files:**
- Modify: `src/main.ts` (snooze click listener, ~line 309)

**Context:**
- `musicPausedByApp: boolean` - module-level flag, true when the app paused music at break start
- `settings.pause_music_on_break` - user toggle; guard all music calls with this
- `invoke("media_resume")` - existing Tauri command, no Rust changes needed
- `startSnooze()` - imported from `src/shared/fullscreen.ts`; call it unchanged after the music resume

**What the current code looks like at ~line 309:**
```ts
$("snooze").addEventListener("click", () => startSnooze());
```

- [ ] **Step 1: Replace the snooze click listener**

In `src/main.ts`, find the line:
```ts
$("snooze").addEventListener("click", () => startSnooze());
```
Replace it with:
```ts
$("snooze").addEventListener("click", () => {
  if (settings?.pause_music_on_break && musicPausedByApp) {
    invoke("media_resume").catch(() => {});
    musicPausedByApp = false;
  }
  startSnooze();
});
```

- [ ] **Step 2: Manually verify the full flow**

There are no unit tests for this module. Verify by running the app and following these steps:

1. Start a focus session with "Pause music on break" enabled and music playing.
2. Let the focus session end (or skip to break via skip button) - confirm music pauses.
3. Press snooze - confirm music resumes immediately.
4. Wait for the 2-minute snooze to expire (or shorten `SNOOZE_DURATION` temporarily in `src/shared/fullscreen.ts` to 5 seconds for testing) - confirm music pauses again when break resumes.
5. Also verify: snooze with "Pause music on break" OFF - music should be unaffected.

- [ ] **Step 3: Commit**

Run `/commit` skill and follow its instructions.
