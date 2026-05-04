# Split app.js fullscreen/snooze into a module

## Goal

Extract the fullscreen-overlay and snooze subsystem from `src/app.js` into a separate module. app.js is currently 481 lines, and the fullscreen/snooze logic is a coherent unit that can live independently.

## Context

app.js grew past 400 lines this session when the `fullscreen_on_focus_end` feature was added. The code splits cleanly at line ~181: everything from `enterOverlayFullscreen` through `endSnooze` (plus related state vars `isOverlayFullscreen`, `snoozeCount`, `snoozeHandle`, `snoozeRemaining`, `pendingBreakPhase`, `PHASE_SNOOZE`, `SNOOZE_DURATION`) is self-contained. The rest of app.js is the core timer loop.

## Approach

Create `src/fullscreen.js` (or `src/snooze.js`) as an ES module exporting:
- `enterOverlayFullscreen()` / `exitOverlayFullscreen()`
- `startSnooze()` / `endSnooze()`
- `renderSnoozeButton()`
- `isOverlayFullscreen` state (either exported ref or getter)

The module needs access to: `invoke`, `settings`, `phase`, `snoozeCount`, `pendingBreakPhase`, `phaseDuration`, `applyPhaseClass`, `renderSnoozeButton`, `startTimer`, `render`. Most of these are circular deps - pass them as init-time callbacks or a shared state object rather than importing directly.

Rejected alternative: convert app.js to a class - too much churn for a one-file JS app.

## Acceptance

- `src/app.js` drops below 350 lines
- All fullscreen and snooze behavior unchanged (test manually: enable `fullscreen_on_focus_end`, let a focus session end, verify fullscreen + snooze button + purple timer + exit on focus start)
- `cargo check` and `vite build` both pass
