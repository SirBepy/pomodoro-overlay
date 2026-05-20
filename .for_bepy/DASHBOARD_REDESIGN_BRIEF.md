# Dashboard Redesign - Brief for next chat

Start the next session by reading this, then invoke the **brainstorming** skill before any code.
This is a big, multi-part change - design first, build second.

## Goal

Rework the stats dashboard: new headers, a day-based time-grid chart, configurable
data retention, and per-day pagination. Plus fix a stats-rollup bug.

## Requested changes

1. **Dashboard header**: title "Dashboard" on the left, a **settings cog** in the top-right
   that navigates to the Settings route.
2. **Settings header**: title "Settings" + a **back button** that returns to the Dashboard route.
   (Today the kit owns this header - see `root.ts` - and settings/dashboard are two routes in
   the same window via `src/views/window/router.ts`. Wiring cog ↔ back needs router work and
   likely a kit header tweak.)
3. **Bug: "Other" shows 113h 32m for today** - impossible. Root-cause with the
   systematic-debugging skill. Prime suspects: the PHASE_OTHER stopwatch (counts *up* from 0,
   see `main.ts` tick) and/or an open event with a very old `start_ms` being clipped to "now"
   in `todayTotals`/`phaseTotals` (`src/views/dashboard/rollup.ts`). Joe is resetting stats,
   which hides it but does NOT fix the cause - it can recur.
4. **7-day view → day × hour time-grid**: instead of the current stacked bar per day
   (`chart.ts`), show a grid of days × hours filled with colored blocks per task type
   (phase colors in `phase-colors.ts`). Calendar/heatmap feel.
5. **Configurable retention**: keep ~last month of stats by default, with a setting to change
   how much history to keep. Needs a new setting (e.g. `stats_retention_days`, default 30) in
   BOTH `schema.ts` and `settings.rs` struct+Default, plus pruning logic in the Rust stats
   store (`src-tauri/src/stats.rs`) - prune on load/append.
6. **Per-day pagination** (supersedes #4's "see 7 days at once"): show one day at a time with
   prev/next and a quick **jump-to-day** (date picker). Default to today; bound by earliest
   data and the retention window.

## Open design questions (resolve in brainstorming)

- Time-grid: granularity (hourly? 15-min?), render approach (CSS grid vs canvas), how to draw
  overlapping/partial-hour events, and how phase colors map to blocks.
- Retention: prune on startup vs on every append; does `stats.json` currently grow unbounded?
  What's the storage shape and is pruning cheap?
- Navigation: does adding a dashboard cog + settings back-button mean customizing the kit's
  settings header, or routing around it in the app? (kit is the `vendor/tauri_kit` submodule -
  changes there need a submodule commit + parent pointer bump.)
- Pagination bounds + empty-day rendering.

## Key files

- Dashboard: `src/views/dashboard/{dashboard.ts, chart.ts, today.ts, idle.ts, rollup.ts, fmt.ts, phase-colors.ts}`
- Rollup math (where "Other" total is computed): `src/views/dashboard/rollup.ts`
- Stats frontend: `src/shared/stats.ts`
- Stats backend/storage: `src-tauri/src/stats.rs`, `src-tauri/src/ipc/stats.rs`
- Window routing: `src/views/window/router.ts`
- Kit settings header: `vendor/tauri_kit/frontend/settings/pages/root.ts` (submodule)
- Settings schema: `src/views/settings/schema.ts` (+ `settings.rs` struct/Default for any new field)

## State at handoff (2026-05-20)

- The recent batch (keybind Shift fix, Show/Hide hotkey, overlay default tuning, stats settings
  page with card toggles + relocated Clear stats, dev update-gate, CSS hover-clip fix, corner
  select fix) is all committed on `main`.
- **Unpushed**: submodule commit `e2daa04` in `vendor/tauri_kit` - push the submodule before
  pushing the parent or CI fails ("not our ref").
- The new Stats settings page already has card-visibility toggles; the redesign builds on that.
