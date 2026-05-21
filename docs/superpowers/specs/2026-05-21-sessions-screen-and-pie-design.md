# Sessions Screen + Day Pie - Design

Date: 2026-05-21
Status: approved

## Goal

Declutter the dashboard's lower half. Move the detailed session list off the
dashboard onto its own screen behind a button, and put a pie chart of how the
day's time was spent (including idle and untracked/app-off time) where the inline
list used to be.

## Decisions (locked)

- **Detail list** lives on a **separate `#sessions` route** with a back-arrow AppBar
  (same pattern as Settings), reached by a button near the 24h bar.
- **Pie replaces the inline session list**; the breakdown bars stay.
- **Pie slices**: Work / Short / Long / Other (phase colors) + Idle (amber) +
  Untracked (gray). Span: today = midnight->now, past days = full 24h.
- **List rows**: `<dot> 5:22 PM - 5:34 PM   12m` - no phase word; a **legend** at the
  top of the screen maps color -> phase. Legend also shown on the dashboard.

## Routing

`src/views/window/router.ts` is hash-based with `mountAppBar`.
- Add `"sessions"` to `RouteName`; `currentRoute()` returns it for `#sessions`.
- `mount()` gains a `sessions` branch calling `mountSessions(bodyEl)` and an AppBar:
  `{ title: "Sessions", leading: { icon: "arrow-left", action: () => location.hash = "#dashboard" } }`.
- Dashboard's "details" button sets `location.hash = "#sessions"`.

## Dashboard layout (revised)

Inside `.dashboard`, top to bottom:
```
#dash-pagination     (unchanged)
#dash-strip          (summary chips, unchanged)
#dash-legend         (NEW - color/phase swatches incl Idle + Untracked)
#dash-bar  + button  (24h bar; a list-icon button navigates to #sessions)
#dash-breakdown      (phase bars, kept)
#dash-pie            (NEW - replaces #dash-sessions)
```
The inline `#dash-sessions` container and the dashboard's call to `renderSessions`
are removed.

## Components

### Legend - `src/views/dashboard/legend.ts`
`renderLegend(root)`: a static row of `<span class="legend-item"><span dot></span>Label</span>`
for Work, Short, Long, Other, Idle, Untracked, using `PHASE_COLORS` + the idle/untracked
colors. Pure of data (always the same). Used on the dashboard and the Sessions screen.

### Pie - `src/views/dashboard/pie.ts` + `pieSlices` in `day-view.ts`
- New pure helper `pieSlices(events, dayStart, now, capMinutes): PieSlice[]` where
  `PieSlice = { key, label, color, ms, pct }`.
  - tracked phase ms from `phaseTotals` (data is non-overlapping post-fix).
  - idle ms from `idleMs`.
  - `daySpan = (isToday ? now : endOfDay) - dayStart` where `isToday = dayStart === startOfDay(now)`.
  - `untracked = max(0, daySpan - trackedSum - idle)`.
  - slices: work, short, long, other, idle, untracked; drop zero slices; `pct = ms/daySpan*100`.
  - colors: phases from `PHASE_COLORS`; idle `#f5a623`; untracked `#3a3a3a` (gray).
- `renderPie(root, slices)`: an inline **SVG** circle drawn as one `<path>` arc per slice
  (each slice = `M cx cy L x1 y1 A r r 0 largeArc 1 x2 y2 Z`, `fill=slice.color`), so each
  slice carries its own `<title>` with `label + fmtDuration(ms)` for native hover tooltips.
  Angles are cumulative fractions of `daySpan`. A single full-circle slice (e.g. an all-idle
  or all-untracked day) is drawn as a plain `<circle>` to avoid the degenerate 360-degree arc.
  Empty day (daySpan 0) renders an all-gray circle.

### Detailed list - `src/views/dashboard/sessions.ts` (reworked) + `sessions-screen.ts`
- `sessionRows` (in `day-view.ts`) gains `endMs` (`startMs + durationMs` of the merged
  group). Existing fields unchanged.
- `renderSessions(root, events, dayStart, now)` row becomes:
  `<dot color> <fmt12(start)> - <fmt12(end)>  <fmtDuration(dur)>` - no phase label.
- New `mountSessions(root)` (in `sessions-screen.ts`): fetches the selected day's events
  (reuse the dashboard's data path / `getRange`), renders `renderLegend` then
  `renderSessions`. Day selection: default to today; **the Sessions screen shows the same
  day the dashboard was last on** - store the selected day in a module-scoped value shared
  with `dashboard.ts`, or pass via the route. Simplest: a small shared `selected-day.ts`
  module holding `selectedDayStart` that both dashboard and sessions read. (Avoids
  persistence - in-memory module state, lost on window close, which is fine.)

## Files

- `src/views/window/router.ts` - add sessions route + AppBar.
- `src/views/dashboard/dashboard.ts` - new layout (legend, button, pie); drop inline list.
- `src/views/dashboard/selected-day.ts` - NEW, shared in-memory selected day.
- `src/views/dashboard/legend.ts` - NEW.
- `src/views/dashboard/pie.ts` - NEW.
- `src/views/dashboard/sessions-screen.ts` - NEW (mountSessions).
- `src/views/dashboard/sessions.ts` - reworked row format.
- `src/views/dashboard/day-view.ts` - add `pieSlices`; add `endMs` to `SessionRow`/`sessionRows`.
- `src/views/dashboard/__tests__/day-view.test.ts` - tests for `pieSlices` + `endMs`.
- `src/styles/dashboard.css` - legend, pie, details-button, sessions-screen rules.

## Non-goals

- No chart library (CSS conic-gradient only).
- No persistence of selected day across window close (in-memory module state).
- No change to stats storage/rollup/migration.

## Verification

- `npm test` (pieSlices: untracked math for today vs past, zero-day; sessionRows endMs).
- `npm run build` (TS) clean.
- Manual QA in `npm run tauri dev`: legend renders; details button opens Sessions screen;
  back returns to the same day; pie proportions look right incl untracked; list rows show
  time-ranges with colored dots and no phase text; dark theme + small-window layout hold.
