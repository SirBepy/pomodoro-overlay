# Sessions Screen + Day Pie - Implementation Plan

> Executed inline by the main agent. Commits go through the `/commit` skill, one logical unit at a time. Tests are pure-function vitest (node env).

**Goal:** Move the detailed session list to its own `#sessions` route behind a button, and replace the inline list on the dashboard with an SVG pie of the day's time (phases + idle + untracked).

**Architecture:** Pure helpers in `day-view.ts` (`pieSlices`, `sessionRows`+`endMs`) feed thin renderers (`legend`, `pie`, `sessions`). A shared `selected-day.ts` module holds the in-memory selected day so the dashboard and the sessions screen agree. Routing stays hash-based via `mountAppBar`.

---

## Task 1: day-view helpers (TDD)

**Files:** `src/views/dashboard/day-view.ts`, `__tests__/day-view.test.ts`

- Add `endMs` to `SessionRow`; set `endMs = startMs + durationMs` after merge (sum of member durations from the first start).
- Add `PieSlice { key, label, color, ms, pct }` and `pieSlices(events, dayStart, now, capMinutes)`:
  - `pt = phaseTotals(events, dayStart, endOfDay(dayStart), now)`; `idle = idleMs(events, dayStart, endOfDay(dayStart), now, capMinutes)`.
  - `isToday = dayStart === startOfDay(now)`; `daySpan = (isToday ? now : endOfDay(dayStart)) - dayStart`.
  - `tracked = pt.work+pt.short+pt.long+pt.other` (snooze folded into... no: include snooze? snooze is a phase but rare; fold snooze into tracked too to keep the pie summing. Add a snooze slice only if >0). Use slices: work, short, long, other, snooze, idle, untracked.
  - `untracked = max(0, daySpan - tracked - snooze - idle)`.
  - `pct = daySpan>0 ? ms/daySpan*100 : 0`; drop zero-ms slices; idle color `#f5a623`, untracked `#3a3a3a`, phases from `PHASE_COLORS`.

**Tests:** past day full-24h untracked; today midnight->now untracked; daySpan 0 -> empty array; sessionRows endMs equals start+summed duration; pct sums ~100 when no rounding.

Verify: `npm test -- day-view` green. Build. Stage; `/commit`.

## Task 2: selected-day shared module

**Files (new):** `src/views/dashboard/selected-day.ts`
- `getSelectedDay()` / `setSelectedDay(ms)`, module-scoped `let`, default `startOfDay(Date.now())`. In-memory only (comment: not persisted; resets on window close, which is the intended UX).
- `dashboard.ts` will replace its local `selectedDayStart` with these.

## Task 3: legend renderer

**Files (new):** `src/views/dashboard/legend.ts`
- `renderLegend(root)`: row of `<span class="legend-item"><span class="legend-dot" style="background:COLOR"></span>LABEL</span>` for Work/Short/Long/Other/Idle/Untracked using `PHASE_COLORS` + idle `#f5a623` + untracked `#3a3a3a`.

## Task 4: pie renderer

**Files (new):** `src/views/dashboard/pie.ts`
- `renderPie(root, slices)`: inline SVG (viewBox 0 0 100 100, r=48, center 50,50). One `<path>` arc per slice with cumulative angles, `fill=slice.color`, `<title>${label} - ${fmtDuration(ms)}</title>`. Single 100% slice -> `<circle>`. Empty -> gray circle. Helper to convert angle->x,y on the circle.

## Task 5: sessions row rework

**Files:** `src/views/dashboard/sessions.ts`
- Row -> `<span dot color><span time>${fmt12(start)} - ${fmt12(end)}</span><span dur>${fmtDuration(dur)}</span>`. Drop `PHASE_LABEL`/phase span. Uses `r.endMs` now.

## Task 6: sessions screen

**Files (new):** `src/views/dashboard/sessions-screen.ts`
- `mountSessions(root)`: read `getSelectedDay()`, `getRange(startOfDay, endOfDay)`, render `<div class="sessions-screen">` containing a legend slot + sessions slot; call `renderLegend` and `renderSessions`. Listen to `stats-updated` to refresh; teardown on unmount (return/teardown like dashboard).

## Task 7: router

**Files:** `src/views/window/router.ts`
- `RouteName |= "sessions"`; `currentRoute()` returns `"sessions"` for `#sessions`.
- `mount()` sessions branch: `mountAppBar(headerEl, { title: "Sessions", leading: { icon: "arrow-left", action: () => location.hash = "#dashboard" } })` then `mountSessions(bodyEl)`. Import + teardown.

## Task 8: dashboard layout

**Files:** `src/views/dashboard/dashboard.ts`
- Markup: `#dash-pagination`, `#dash-strip`, `#dash-legend`, `#dash-bar` (+ a `.dash-details-btn` list-icon button), `#dash-breakdown`, `#dash-pie`. Remove `#dash-sessions`.
- Use `getSelectedDay`/`setSelectedDay` instead of the local var.
- `refresh`: renderLegend(once), renderDayBar, renderBreakdown, renderPie(from pieSlices). Remove renderSessions.
- Details button click -> `location.hash = "#sessions"`.

## Task 9: CSS

**Files:** `src/styles/dashboard.css`
- `.dash-legend`/`.legend-item`/`.legend-dot`; bar+button row (`#dash-bar` flex, `.dash-details-btn`); `#dash-pie` centered, `.day-pie svg` sizing; `.sessions-screen` padding + its legend; keep session-row styles (reused). Match the larger sizing already in place.

## Task 10: verify

- `npm test`, `npm run build` clean.
- `npm run tauri dev`: details button -> Sessions screen -> back to same day; pie correct incl untracked; rows show time-ranges, no phase text; legend on both screens; dark theme + small window hold.

## Self-review
- Spec routing/legend/pie/list/untracked all mapped to tasks 1-9. Verification task 10. Types: `SessionRow.endMs` defined in T1, used in T5; `PieSlice` in T1 used in T4. Snooze handled as its own slice in pieSlices so the pie always sums to daySpan.
