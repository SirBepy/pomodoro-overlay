# Dashboard Restyle - Design

Date: 2026-05-21
Status: approved (pending spec review)

## Goal

The stats dashboard looks ugly. Two complaints:

1. **Default OS scrollbar** is chunky and off-theme.
2. **The single-day timeline** is a tall vertical 1px/min scroll rail with thin invisible
   slivers for short breaks. Looks scattered and forces scrolling.

Fix both. Keep the dashboard single-day (per-day pagination stays), but redesign the day
view and ship a sleek, reusable scrollbar.

## Decisions (locked with Joe)

- **Timeline**: redesign single-day. Replace the tall vertical rail with a **horizontal
  24h day-bar** + per-phase breakdown + scrollable session list.
- **Time axis**: **fixed 24h** (00:00-24:00). Chosen for axis stability (labels never shift
  as the day progresses). Slivers being invisible on the bar is acceptable *because* the
  session list below carries exact detail.
- **Phase colors**: reuse `PHASE_COLORS` from `src/views/dashboard/phase-colors.ts`
  everywhere (bar segments, breakdown bars, session-row dots) so each phase reads identically.
- **Scrollbar**: shared in the `tauri_kit` submodule, themeable via `--scrollbar-*` tokens,
  so every Tauri app inherits it. Needs a submodule commit + parent pointer bump.

## Part A - Scrollbar (tauri_kit submodule)

Add a reusable, themeable scrollbar to the kit's existing token + import chain.

### Files

- `vendor/tauri_kit/frontend/settings/styles/tokens.css` - add `--scrollbar-*` tokens to the
  light block (`:root, [data-theme="light"]`), the dark block (`[data-theme="dark"]`), and the
  `@media (prefers-color-scheme: dark) [data-theme="system"]` block.
- `vendor/tauri_kit/frontend/settings/styles/scrollbar.css` - **new file** with the rules below.
- `vendor/tauri_kit/frontend/settings/styles.css` - append `@import url("./styles/scrollbar.css");`
  to the chain.

### Tokens

```css
/* :root, [data-theme="light"] */
--scrollbar-thumb:       rgba(0, 0, 0, 0.22);
--scrollbar-thumb-hover: rgba(0, 0, 0, 0.38);
--scrollbar-track:       transparent;
--scrollbar-size:        9px;

/* [data-theme="dark"]  AND  the system-dark @media block */
--scrollbar-thumb:       rgba(255, 255, 255, 0.18);
--scrollbar-thumb-hover: rgba(255, 255, 255, 0.32);
--scrollbar-track:       transparent;
--scrollbar-size:        9px;
```

### scrollbar.css

Dual-mechanism: standards `scrollbar-color`/`scrollbar-width` as the cross-engine fallback
(Firefox / WebKit-without-pseudo), and the richer `::-webkit-scrollbar` version gated behind
`@supports selector(::-webkit-scrollbar)` so the two never collide on one element. WebView2 is
Evergreen Chromium and honors the pseudo-elements exactly like desktop Chrome.

```css
/* sirbepy_tauri_kit - global scrollbar. Themed via --scrollbar-* in tokens.css. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
}

@supports selector(::-webkit-scrollbar) {
  * { scrollbar-width: auto; scrollbar-color: auto; }

  ::-webkit-scrollbar { width: var(--scrollbar-size); height: var(--scrollbar-size); }
  ::-webkit-scrollbar-track { background: var(--scrollbar-track); }
  ::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 999px;
    border: 2px solid transparent;   /* insets the thumb so it reads thinner than the gutter */
    background-clip: padding-box;
    min-height: 36px;
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); background-clip: padding-box; }
  ::-webkit-scrollbar-corner { background: transparent; }
}
```

Note `overflow: overlay` is removed from Chromium - do not use. True overlay/auto-hide is an OS
setting, not CSS.

### Reaching the dashboard window

The dashboard window must actually load the kit style chain (or at least these tokens +
`scrollbar.css`). Verify during planning whether `src/window.html` / dashboard route already
imports the kit `styles.css`; if not, either import it or mirror the `--scrollbar-*` tokens into
`src/styles/base.css` and import `scrollbar.css`. The scrollbar must apply to `#window-body` and
`#dash-sessions` (the two scroll containers).

### Submodule discipline

Per project rule + memory: commit the submodule first and push it before the parent, or CI
fails with "not our ref". Bump the parent pointer after.

## Part B - Single-day redesign

New vertical layout inside `.dashboard` (top to bottom):

```
[ pagination row ]            (unchanged: prev / date-picker / next)
[ summary chips  ]            (unchanged: focus / sessions / idle)
[ 24h day-bar    ]            (NEW - replaces vertical timeline track)
[ phase breakdown]            (NEW)
[ session list   ]            (NEW - this is the only scroll region)
```

### B1 - 24h horizontal day-bar

- Replaces the vertical `.timeline-scroll` / `.tl-track` rail entirely.
- A fixed-width horizontal bar representing 00:00 -> 24:00 of `selectedDayStart`.
- Each event becomes an absolutely-positioned segment: `left = (start - dayStart)/dayMs * 100%`,
  `width = duration/dayMs * 100%`, `background = PHASE_COLORS[phase]`. Enforce a small
  `min-width` (~2px) so a segment never fully vanishes (it may still be too thin to read - the
  list covers detail).
- Open events (`end_ms == null`) clip to `min(now, endOfDay)`.
- Hour axis below the bar with a few fixed ticks (12a / 6a / 12p / 6p / 12a). Ticks never move.
- Hover/title tooltip per segment: `phase - start-end - duration` (reuse current `fmt12` /
  `fmtDuration`).
- Empty day: render the bar as an empty track + the existing "No activity on <date>" message.

### B2 - Phase breakdown

- A compact rows block under the bar. One row per non-zero bucket:
  **Work**, **Breaks** (short + long combined), **Idle**, and **Other** if non-zero.
- Each row: label, a mini horizontal bar whose width is proportional to that bucket's share of
  the day's tracked time, and the formatted duration (`fmtHoursMinutes`).
- Colors from `PHASE_COLORS`: work `#4a9eff`, breaks gray `#9aa0a6`, idle amber `#f5a623`,
  other green `#7ec77f`.
- Source the numbers from existing rollup: `phaseTotals(...)` for work/short/long/other,
  `idleMs(...)` for idle. (`dashboard.ts` already computes `todayTotals`; reuse or extend it so
  the breakdown and summary strip agree.)

### B3 - Session list

- Scrollable list of the day's events, newest-or-oldest first (oldest-first matches a timeline
  read; confirm in plan, default oldest-first).
- One row per event: a phase-colored dot (`PHASE_COLORS`), start time (`fmt12`), phase label,
  duration (`fmtDuration`). Idle is gap time, not an event, so it does **not** appear as a row
  (it shows in the bar gaps + breakdown). Confirm in plan whether to synthesize idle rows -
  default **no**.
- This list is the **only** scroll container in the body; the bar + breakdown are fixed height.
  Apply the kit scrollbar here.

### Files

- `src/views/dashboard/timeline.ts` - rewrite `renderTimeline` to render the **24h day-bar**
  (no more vertical track / gridlines / axis column). Or rename to `day-bar.ts`; decide in plan.
- `src/views/dashboard/dashboard.ts` - update `mountDashboard` markup to add `#dash-breakdown`
  and `#dash-sessions` containers and call the new renderers in `refresh`.
- New: `src/views/dashboard/breakdown.ts` (renderPhaseBreakdown) and
  `src/views/dashboard/sessions.ts` (renderSessionList). Keep each renderer single-purpose.
- `src/styles/dashboard.css` - remove `.timeline-scroll / .tl-axis-col / .tl-axis-label /
  .tl-track / .tl-gridline / .tl-hour-label / .tl-block` rules; add `.day-bar`, `.day-bar-seg`,
  `.day-axis`, `.breakdown`, `.breakdown-row`, `.session-list`, `.session-row` rules.
- `src/views/dashboard/phase-colors.ts` - unchanged (source of truth for colors).

## Non-goals

- No multi-day / weekly / heatmap view (researched, deferred - single-day stays).
- No change to stats storage, retention, rollup math, or pagination behavior.
- No new settings fields.

## Verification

- `npm run build` (TS) passes.
- `cargo check` not needed (no Rust changes).
- Manual QA in `npm run tauri dev` (this supersedes ai_todo `04-dashboard-visual-qa.md`):
  bar renders segments in phase colors at correct 24h positions; breakdown rows proportional and
  colored; session list scrolls with the new sleek scrollbar; empty day shows empty state;
  pagination + date jump still work; dark theme correct; layout holds at small window sizes;
  no console errors.
- Playwright cannot reach the Tauri webview (`window.__TAURI__` undefined) - QA is manual.
