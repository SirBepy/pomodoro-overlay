# Visual QA + polish the day pie and sessions screen

## Goal

Confirm the new day-pie chart and the detailed sessions screen look and behave correctly in
the running app, and apply any visual polish Joe wants.

## Context

Added in the 2026-05-21 session (spec `docs/superpowers/specs/2026-05-21-sessions-screen-and-pie-design.md`):
the dashboard gained a color/phase legend, a list-icon button next to the 24h bar that opens a
new `#sessions` route, and an SVG pie (`src/views/dashboard/pie.ts`, slices from
`pieSlices` in `day-view.ts`) replacing the inline list. The dev app exited before Joe could
visually confirm these. Playwright can't reach the Tauri webview, so QA is manual.

At session end Claude offered to tweak pie size, donut-vs-solid, and button placement - pending
Joe's reaction.

## Approach

Run `npm run tauri dev` and check:
- Legend renders all phases in their real colors; details button opens the Sessions screen; back
  returns to the same day.
- Pie proportions look right including Idle (amber) and Untracked (gray); hover tooltips show
  per-slice durations; today = midnight→now, past days = full 24h.
- Sessions rows show `5:22 PM - 5:34 PM   12m` with colored dots and no phase text; scrolls.
- Dark theme + small-window layout hold.

Then apply Joe's polish preferences (candidates: pie diameter, donut hole vs solid, button
position/size).

## Acceptance

All checks pass in the running app with no console errors, and Joe's requested visual tweaks (if
any) are applied.
