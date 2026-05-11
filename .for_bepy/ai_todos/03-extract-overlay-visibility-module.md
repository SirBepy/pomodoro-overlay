# Extract overlay visibility module from main.ts

## Goal
Move the hover/click-through/visibility logic out of `src/main.ts` into a dedicated module under `src/views/timer/visibility.ts`, mirroring the pattern already used by `return-to-corner.ts` and `timer-edit.ts`.

## Context
`src/main.ts` is now 426 lines (over the 400-line threshold). A clear seam exists: lines around `applyVisibility`, `clickThroughActive`, `syncClickThrough`, `setupHoverOpacity`, plus the module-level `isHovered`, `modifierHeld`, `isClickThrough` flags. These have a single concern (overlay opacity + click-through state driven by hover and modifier polling) and don't reach into timer/phase logic except via injected getters.

Files in scope:
- `src/main.ts:110-160` (visibility/hover block)
- `src/main.ts:181-198` (`syncClickThrough` calls inside startTimer/pauseTimer — leave the calls, just import the function)

## Approach
Create `src/views/timer/visibility.ts` exporting `setupVisibility({ getSettings, getRunning, getPhase, getIsSnoozePhase })` returning `{ syncClickThrough, applyVisibility }`. Move the three flags + four functions inside. Keep the 150ms poll loop inside the module. In `main.ts`, replace inline definitions with one import + one setup call; keep the calls in `startTimer`/`pauseTimer`/`settings-updated` listener using the returned `syncClickThrough`.

## Acceptance
- `src/main.ts` drops below 380 lines.
- `src/views/timer/visibility.ts` exists, exports a setup function with the documented signature.
- Click-through still works: hover-fade smooth, modifier press toggles interactivity, `set_tray_running` still called on start/pause.
- No behavior change.
