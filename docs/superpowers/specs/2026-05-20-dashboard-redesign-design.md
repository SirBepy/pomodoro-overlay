# Dashboard Redesign — Design Spec
_2026-05-20_

## Summary

Six changes to the stats dashboard: context-aware navigation headers, a bug fix for inflated "Other" totals, a vertical per-day timeline replacing the 7-day bar chart, configurable retention, per-day pagination, and a compact summary strip replacing the today/idle cards.

---

## 1. Context-aware navigation headers

**Current state:** A persistent tab bar (`window-tabs` div, `tabs.ts`) sits above the body. Routes are `#dashboard` and `#settings`.

**Change:** Remove the tab bar entirely. Each route renders its own header row.

- **Dashboard header:** Left - "Dashboard" title. Center - date navigator (prev / today / next + date picker). Right - cog icon (Phosphor `gear`) that sets `location.hash = '#settings'`.
- **Settings header:** The router injects a slim back-button strip (`← Settings` label) above where `mountSettings(bodyEl)` renders. This strip sets `location.hash = '#dashboard'` on click. The kit's own header and tab bar remain inside the settings body — no submodule changes.

**Files touched:**
- `src/views/window/router.ts` — remove `renderTabs`, add `renderDashboardHeader` + `injectSettingsBackButton`
- `src/views/window/tabs.ts` — delete entirely
- `src/styles/dashboard.css` — new header row styles

---

## 2. Bug fix: "Other" shows 113h+

**Root cause:** `close_open_on_startup` in `stats.rs` closes only `file.events.last_mut()`. If the app crashed repeatedly, multiple events have `end_ms = null`. Each dangling open event is returned by `range()` for any query window that overlaps its `start_ms`, and `phaseTotals` accumulates all of them independently. N open events × hours-since-start = impossible totals.

**Fix:** Change `close_open_on_startup` to iterate **all** events and close every one with `end_ms == None`, not just the last.

```rust
// stats.rs - close_open_on_startup
for event in file.events.iter_mut() {
    if event.end_ms.is_none() {
        event.end_ms = Some(fallback_end_ms.max(event.start_ms));
        event.ended_by = Some("app_close".into());
    }
}
```

**Files touched:** `src-tauri/src/stats.rs`

---

## 3. Vertical per-day timeline (replaces bar chart)

**Layout:** Full-body width, scrollable vertically. Time axis runs top-to-bottom. Auto-clips to the span from the day's first event to its last event. For today specifically, clip end = `now` (live, updates on each refresh). No midnight-to-midnight waste.

**Rendering:**
- 1 px per minute baseline.
- Minimum block height: 5px, so even a 1-min event is visible.
- Events rendered as `position:absolute` divs: `top = (event.start - clipStart) / 60000` px, `height = max(5, duration_ms / 60000)` px.
- Phase colors from `phase-colors.ts` (work=blue, other=green, break=gray, snooze=amber).
- Hour gridlines at each full hour within the visible span.
- Time axis on the left: labels at each hour tick.
- Tooltip on hover: phase name + start–end time + duration.
- Empty day (no events): shows "No activity recorded" centered.

**New file:** `src/views/dashboard/timeline.ts` — `renderTimeline(root, events, clipStart, clipEnd, now)`.

**Removed:** `src/views/dashboard/chart.ts` (7-day bar chart, replaced entirely).

**Files touched:** `src/views/dashboard/timeline.ts` (new), `src/views/dashboard/chart.ts` (delete), `src/views/dashboard/dashboard.ts`

---

## 4. Compact summary strip

**Replaces** the today-totals card and idle card (both currently rendered as full cards). Now a single slim row above the timeline:

```
[ 🔵 3h 45m focus ]  [ ✓ 4 sessions ]  [ 💤 32m idle ]
```

Three stat chips, always visible, not toggleable (the toggle settings for `stats_show_today` / `stats_show_idle` are removed from schema and settings.rs, since the strip is always shown). The `stats_show_chart` setting also goes away — the timeline is the dashboard now.

**Files touched:**
- `src/views/dashboard/today.ts` — rewrite to `renderSummaryStrip(root, totals)`
- `src/views/dashboard/idle.ts` — delete; idle value folded into strip
- `src/views/settings/schema.ts` — remove `stats_show_today`, `stats_show_idle`, `stats_show_chart` fields
- `src-tauri/src/settings.rs` — remove those three fields from struct and Default

---

## 5. Configurable retention

**New setting:** `stats_retention_days` — integer, default 30, min 7, max 365. Controls how many days of events to keep.

**Pruning:** On startup, after `close_open_on_startup`, call `prune_old_events(app)`. It computes `cutoff_ms = now - retention_days * 86_400_000` and retains only events where `end_ms.unwrap_or(start_ms) >= cutoff_ms`. Persists if any events were removed.

**Schema entry (Stats section):**
```ts
{
  key: "stats_retention_days",
  kind: "integer",
  label: "Keep stats for (days)",
  min: 7, max: 365,
  tooltip: "Events older than this are deleted on startup. Default: 30 days.",
}
```

**Files touched:**
- `src/views/settings/schema.ts` — add field to Stats section
- `src-tauri/src/settings.rs` — add `stats_retention_days: u32`, default `30`
- `src-tauri/src/stats.rs` — add `prune_old_events(app)`, call from startup in `lib.rs`

---

## 6. Per-day pagination

**Navigation:** Dashboard header contains: `← [date label] →` with a click-to-pick date input in the center. Default = today. Prev/next step by one day. Bounds: earliest retained event's day (lower) to today (upper). The `←` button is disabled at the lower bound; `→` is disabled when selected day = today. Future dates are not selectable in the date picker.

**Data loading:** `dashboard.ts` tracks `selectedDay: Date`. On navigation, calls `getRange(startOfDay(selected), endOfDay(selected))` and re-renders timeline + summary strip for that day. "Today" is always the default on open.

**Empty day:** If `getRange` returns `[]`, timeline area shows "No activity on [date]".

**Files touched:** `src/views/dashboard/dashboard.ts`, `src/views/window/router.ts` (header renders date nav)

---

## Implementation order

**Commit 1 — Bug fix (standalone, ship immediately):**
- Fix `close_open_on_startup` to close all dangling open events.

**Commit 2 — Retention setting + pruning (Rust only):**
- Add `stats_retention_days` to `settings.rs` + `schema.ts`.
- Add `prune_old_events` to `stats.rs`, wire into startup.

**Commit 3 — Dashboard redesign (TS/CSS):**
- Remove tabs, add context headers.
- Replace chart with vertical timeline.
- Replace today/idle cards with summary strip.
- Per-day pagination in header.
- Remove the three `stats_show_*` settings.

---

## Key files reference

| File | Action |
|------|--------|
| `src-tauri/src/stats.rs` | Fix `close_open_on_startup`, add `prune_old_events` |
| `src-tauri/src/settings.rs` | Add `stats_retention_days`, remove 3 `stats_show_*` fields |
| `src/views/settings/schema.ts` | Add retention field, remove 3 card-toggle fields |
| `src/views/window/router.ts` | Remove tabs, add context headers |
| `src/views/window/tabs.ts` | Delete |
| `src/views/dashboard/dashboard.ts` | Full rewrite: pagination, strip, timeline wiring |
| `src/views/dashboard/timeline.ts` | New: vertical timeline renderer |
| `src/views/dashboard/chart.ts` | Delete |
| `src/views/dashboard/today.ts` | Rewrite to summary strip |
| `src/views/dashboard/idle.ts` | Delete |
| `src/styles/dashboard.css` | Header row + summary strip styles |
