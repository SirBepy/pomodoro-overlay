# Snooze Music Resume

**Date:** 2026-05-11

## Problem

When a break starts, the app pauses music (`musicPausedByApp = true`). If the user presses snooze, music stays paused during the snooze phase. It should resume instead.

## Behavior

1. Break starts - music pauses, `musicPausedByApp = true`
2. User presses snooze - music resumes, `musicPausedByApp = false`, snooze timer starts
3. Snooze ends - break phase resumes, `startTimer()` auto-called, music pauses again

## Change

**File:** `src/main.ts` - snooze click listener (~line 309)

Before calling `startSnooze()`, check `musicPausedByApp` and fire `media_resume`.

```ts
$("snooze").addEventListener("click", () => {
  if (settings?.pause_music_on_break && musicPausedByApp) {
    invoke("media_resume").catch(() => {});
    musicPausedByApp = false;
  }
  startSnooze();
});
```

## No other changes needed

- No changes to `fullscreen.ts` - `startSnooze()` is unmodified
- No new Rust commands - `media_resume` already exists
- Re-pause on snooze end is handled naturally: `handlePhaseEnd` calls `startTimer()` with break phase and `musicPausedByApp = false`, which pauses music via existing logic
- Only fires when `pause_music_on_break` setting is enabled
