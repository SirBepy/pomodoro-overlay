# Split src/main.ts into view-level modules

## Goal

Break `src/main.ts` (503 lines, `// @ts-nocheck`) into smaller focused modules under `src/views/timer/` following the tauri spec's view pattern.

## Context

main.ts was migrated from app.js during /bepy-project-setup. It's a single flat file with distinct concerns: timer state + tick logic, phase management, return-to-corner animation, resize handles, and timer edit mode. The tauri spec says views live in `src/views/<view>/<view>.ts`. main.ts is the timer view's entry point and warrants splitting.

`// @ts-nocheck` is at the top because the file uses `window.__TAURI__` globals that aren't typed. Leave this as-is unless typing is also tackled.

## Approach

Suggested split seams (don't have to be exact - use judgment):

1. `src/views/timer/return-to-corner.ts` - `lerp`, `animateToCorner`, `scheduleReturnToCorner`, `setupReturnToCorner` + their state vars
2. `src/views/timer/timer-edit.ts` - `editMode`, `editBuffer`, `editSnapshot`, `editDirty`, `enterEditMode`, `exitEditMode`, `renderEditMode`, `setupTimerEdit`
3. `src/views/timer/main.ts` (or `src/main.ts` remains) - the rest: settings, phase state, tick, render, init, event listeners

Each extracted module exports its functions and state. main.ts imports from them.

Keep `// @ts-nocheck` on all files in this group since they share the same typing problem.

## Acceptance

- `vite build` succeeds (or at minimum `npx tsc --noEmit` passes for typed files).
- No behavior changes - pure structural refactor.
- Each extracted file is under 150 lines.
- Imports in main.ts resolve correctly.
