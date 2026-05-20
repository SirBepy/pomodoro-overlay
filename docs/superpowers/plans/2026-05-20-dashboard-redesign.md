# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 7-day bar chart dashboard with a per-day vertical timeline, fix a stats-inflation bug, add retention pruning, and swap the tab-bar navigation for context-aware headers.

**Architecture:** Three independent commits in order: (1) Rust bug fix, (2) Rust retention setting + pruning, (3) TypeScript/CSS full dashboard redesign. The redesign removes the tab bar, replaces chart.ts with a new timeline.ts, folds today/idle cards into a compact summary strip, and adds per-day pagination in the dashboard header.

**Tech Stack:** Tauri 2.x (Rust backend), Vite + TypeScript frontend, lit-html (innerHTML string templates, no framework), Phosphor Icons web, CSS absolute positioning for timeline blocks.

**Verification commands:**
- Rust: `cargo check` inside `src-tauri/`
- TypeScript: `npm run build` at project root
- Visual: `npm run tauri dev` (manual)

**Commit rule:** Never `git commit` directly. Always invoke `/commit` skill.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/src/stats.rs` | Modify | Fix `close_open_on_startup`; add `prune_old_events` |
| `src-tauri/src/settings.rs` | Modify | Add `stats_retention_days`; remove 3 `stats_show_*` fields |
| `src/views/settings/schema.ts` | Modify | Add retention field; remove 3 card-toggle fields |
| `src/views/window/router.ts` | Rewrite | Remove tabs; inject context header per route |
| `src/views/window/tabs.ts` | Delete | Replaced by context headers |
| `src/views/dashboard/dashboard.ts` | Rewrite | Pagination state; wire strip + timeline + header |
| `src/views/dashboard/timeline.ts` | Create | Vertical timeline renderer |
| `src/views/dashboard/summary-strip.ts` | Create | Compact focus/sessions/idle chip row |
| `src/views/dashboard/chart.ts` | Delete | Replaced by timeline.ts |
| `src/views/dashboard/today.ts` | Delete | Replaced by summary-strip.ts |
| `src/views/dashboard/idle.ts` | Delete | Folded into summary-strip.ts |
| `src/styles/dashboard.css` | Modify | Add header-row, date-nav, summary-strip, timeline styles |

---

## Task 1: Fix close_open_on_startup (Bug Fix)

**Spec:** Section 2 — Root cause: multiple dangling open events accumulate if app crashes repeatedly. `close_open_on_startup` only closes the last event. Fix: close ALL events with `end_ms == None`.

**Files:**
- Modify: `src-tauri/src/stats.rs`

- [ ] **Step 1: Open `src-tauri/src/stats.rs` and find `close_open_on_startup` (around line 117)**

Current code closes only `file.events.last_mut()`. Replace the entire function body with a loop:

```rust
pub fn close_open_on_startup(app: &AppHandle, fallback_end_ms: i64) {
    let state = app.state::<StatsState>();
    let mut file = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let mut closed = 0usize;
    for event in file.events.iter_mut() {
        if event.end_ms.is_none() {
            event.end_ms = Some(fallback_end_ms.max(event.start_ms));
            event.ended_by = Some("app_close".into());
            closed += 1;
        }
    }
    if closed > 0 {
        log::info!("stats: closed {} dangling open event(s) on startup", closed);
        let _ = persist(app, &file);
    }
}
```

- [ ] **Step 2: Run `cargo check` inside `src-tauri/`**

```
cd src-tauri
cargo check
```

Expected: no errors.

- [ ] **Step 3: Commit via `/commit` skill**

Suggested message: `FIX: close all dangling open stats events on startup, not just last`

---

## Task 2: Retention Setting + Pruning

**Spec:** Section 5 — New `stats_retention_days` setting (default 30, min 7, max 365). On startup, after `close_open_on_startup`, prune events older than retention window.

**Files:**
- Modify: `src-tauri/src/stats.rs`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/views/settings/schema.ts`

- [ ] **Step 1: Add `prune_old_events` to `src-tauri/src/stats.rs`**

Add this function at the bottom of the file, after `close_open_on_startup`:

```rust
pub fn prune_old_events(app: &AppHandle, retention_days: u32, now_ms: i64) {
    if retention_days == 0 {
        return;
    }
    let cutoff_ms = now_ms - (retention_days as i64 * 86_400_000);
    let state = app.state::<StatsState>();
    let mut file = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let before = file.events.len();
    file.events.retain(|e| {
        let end = e.end_ms.unwrap_or(e.start_ms);
        end >= cutoff_ms
    });
    let removed = before - file.events.len();
    if removed > 0 {
        log::info!("stats: pruned {} event(s) older than {} days", removed, retention_days);
        let _ = persist(app, &file);
    }
}
```

- [ ] **Step 2: Add `stats_retention_days` to `src-tauri/src/settings.rs`**

In the `Settings` struct, add after `idle_gap_cap_minutes`:

```rust
pub stats_retention_days: u32,
```

Remove these three fields from the struct (they'll be replaced by the always-visible summary strip):

```rust
// DELETE these lines:
pub stats_show_today: bool,
pub stats_show_idle: bool,
pub stats_show_chart: bool,
```

In `impl Default for Settings`, add after `idle_gap_cap_minutes: 240,`:

```rust
stats_retention_days: 30,
```

And remove the three deleted fields' defaults:

```rust
// DELETE these lines from Default:
stats_show_today: true,
stats_show_idle: true,
stats_show_chart: true,
```

- [ ] **Step 3: Wire `prune_old_events` into `src-tauri/src/lib.rs`**

Search for `stats::close_open_on_startup` in `lib.rs`. There are two call sites. For the **startup call site** (around line 196, inside the `setup` closure), add the prune call immediately after:

```rust
stats::close_open_on_startup(&handle, now_ms);
// Add this block:
{
    let settings = handle.state::<SettingsState>();
    let days = settings.0.lock().map(|s| s.stats_retention_days).unwrap_or(30);
    stats::prune_old_events(&handle, days, now_ms);
}
```

For the **second call site** (around line 290, in the window-focus/reopen handler), add the same block after it:

```rust
stats::close_open_on_startup(app, now_ms);
// Add this block:
{
    let settings = app.state::<SettingsState>();
    let days = settings.0.lock().map(|s| s.stats_retention_days).unwrap_or(30);
    stats::prune_old_events(app, days, now_ms);
}
```

- [ ] **Step 4: Add retention field to `src/views/settings/schema.ts`**

In the `Stats` section, inside the first group (`Dashboard cards`), remove the three card-toggle fields entirely:

```typescript
// DELETE from the "Dashboard cards" group fields array:
{
  key: "stats_show_today",
  kind: "toggle",
  label: "Today summary",
  tooltip: "Show the today totals card on the dashboard.",
},
{
  key: "stats_show_idle",
  kind: "toggle",
  label: "Idle card",
  tooltip: "Show the idle-time card on the dashboard.",
},
{
  key: "stats_show_chart",
  kind: "toggle",
  label: "7-day chart",
  tooltip: "Show the 7-day breakdown chart on the dashboard.",
},
```

Rename the group title from `"Dashboard cards"` to `"Retention"` and add the retention field:

```typescript
{
  title: "Retention",
  fields: [
    {
      key: "stats_retention_days",
      kind: "integer",
      label: "Keep stats for (days)",
      min: 7,
      max: 365,
      tooltip: "Events older than this are deleted on startup. Default: 30 days.",
    },
  ],
},
```

- [ ] **Step 5: Verify Rust compiles**

```
cd src-tauri
cargo check
```

Expected: no errors.

- [ ] **Step 6: Verify TypeScript compiles**

```
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit via `/commit` skill**

Suggested message: `FEAT: stats retention setting (default 30 days) with startup pruning`

---

## Task 3: Delete Removed Files

Clean up before rebuilding to avoid confusion.

**Files:**
- Delete: `src/views/window/tabs.ts`
- Delete: `src/views/dashboard/chart.ts`
- Delete: `src/views/dashboard/today.ts`
- Delete: `src/views/dashboard/idle.ts`

- [ ] **Step 1: Delete the four files**

Use the `/delete` skill or run:

```powershell
Remove-Item "src/views/window/tabs.ts"
Remove-Item "src/views/dashboard/chart.ts"
Remove-Item "src/views/dashboard/today.ts"
Remove-Item "src/views/dashboard/idle.ts"
```

Do NOT commit yet — the files that import them still reference them and will fail `npm run build`. They'll be fixed in the next tasks.

---

## Task 4: Summary Strip

**Spec:** Section 4 — Compact single-row chip display: focus time, sessions, idle. Replaces today/idle cards.

**Files:**
- Create: `src/views/dashboard/summary-strip.ts`

- [ ] **Step 1: Create `src/views/dashboard/summary-strip.ts`**

```typescript
import type { DayTotals } from "./rollup";
import { fmtHoursMinutes } from "./fmt";

export function renderSummaryStrip(root: HTMLElement, totals: DayTotals): void {
  root.innerHTML = `
    <div class="summary-strip">
      <span class="summary-chip summary-chip-work">
        <i class="ph ph-timer"></i>
        ${fmtHoursMinutes(totals.work_ms)} focus
      </span>
      <span class="summary-chip summary-chip-sessions">
        <i class="ph ph-check-circle"></i>
        ${totals.work_sessions_completed} session${totals.work_sessions_completed !== 1 ? "s" : ""}
      </span>
      <span class="summary-chip summary-chip-idle">
        <i class="ph ph-coffee"></i>
        ${fmtHoursMinutes(totals.idle_ms)} idle
      </span>
    </div>
  `;
}
```

---

## Task 5: Vertical Timeline Renderer

**Spec:** Section 3 — 1px/min, 5px min height, auto-clip to active window, hour gridlines, phase colors, tooltip on hover.

**Files:**
- Create: `src/views/dashboard/timeline.ts`

- [ ] **Step 1: Create `src/views/dashboard/timeline.ts`**

```typescript
import type { StatsEvent } from "../../shared/stats";
import { PHASE_COLORS } from "./phase-colors";
import { startOfDay, endOfDay } from "./rollup";

const MIN_BLOCK_PX = 5;
const MS_PER_PX = 60_000; // 1 minute per pixel

function fmt12(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

export function renderTimeline(
  root: HTMLElement,
  events: StatsEvent[],
  dayStart: number,
  now: number,
): void {
  const dayEnd = endOfDay(dayStart);
  const isToday = dayStart <= now && now < dayEnd;

  // Filter events that overlap this day
  const dayEvents = events.filter((e) => {
    const eEnd = e.end_ms ?? now;
    return eEnd >= dayStart && e.start_ms <= dayEnd;
  });

  if (dayEvents.length === 0) {
    const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    root.innerHTML = `<div class="timeline-empty">No activity on ${label}</div>`;
    return;
  }

  // Clip window
  const clipStart = Math.max(Math.min(...dayEvents.map((e) => e.start_ms)), dayStart);
  const rawEnd = isToday ? now : Math.max(...dayEvents.map((e) => e.end_ms ?? now));
  const clipEnd = Math.min(rawEnd, dayEnd);
  const totalMs = Math.max(clipEnd - clipStart, 1);
  const totalPx = Math.ceil(totalMs / MS_PER_PX);

  // Hour ticks within clip window
  const hourTicks: number[] = [];
  const firstHour = Math.ceil(clipStart / 3_600_000) * 3_600_000;
  for (let t = firstHour; t <= clipEnd; t += 3_600_000) {
    hourTicks.push(t);
  }

  // Build gridlines HTML
  const gridlines = hourTicks.map((t) => {
    const top = Math.round((t - clipStart) / MS_PER_PX);
    const label = fmt12(t);
    return `
      <div class="tl-gridline" style="top:${top}px;">
        <span class="tl-hour-label">${label}</span>
      </div>
    `;
  }).join("");

  // Build event blocks HTML
  const blocks = dayEvents.map((e) => {
    const eStart = Math.max(e.start_ms, clipStart);
    const eEnd = Math.min(e.end_ms ?? now, clipEnd);
    if (eEnd <= eStart) return "";
    const top = Math.round((eStart - clipStart) / MS_PER_PX);
    const height = Math.max(MIN_BLOCK_PX, Math.round((eEnd - eStart) / MS_PER_PX));
    const color = (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888";
    const tooltip = `${e.phase} · ${fmt12(eStart)}–${fmt12(eEnd)} · ${fmtDuration(eEnd - eStart)}`;
    return `<div class="tl-block" style="top:${top}px;height:${height}px;background:${color};" title="${tooltip}"></div>`;
  }).join("");

  root.innerHTML = `
    <div class="timeline-scroll">
      <div class="tl-axis-col">
        ${hourTicks.map((t) => {
          const top = Math.round((t - clipStart) / MS_PER_PX);
          return `<span class="tl-axis-label" style="top:${top}px;">${fmt12(t)}</span>`;
        }).join("")}
      </div>
      <div class="tl-track" style="height:${totalPx}px;">
        ${gridlines}
        ${blocks}
      </div>
    </div>
  `;
}
```

---

## Task 6: Router — Remove Tabs, Add Context Headers

**Spec:** Section 1 — Dashboard gets title + date-nav + cog. Settings gets a back-button strip above the kit body. No submodule changes.

**Files:**
- Rewrite: `src/views/window/router.ts`

- [ ] **Step 1: Rewrite `src/views/window/router.ts`**

```typescript
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../../vendor/tauri_kit/frontend/settings/styles.css";
import "../../styles/dashboard.css";
import { applyTheme } from "../../../vendor/tauri_kit/frontend/settings/pages/theme";
import { mountSettings } from "../settings/settings";
import { mountDashboard } from "../dashboard/dashboard";

// @ts-ignore
const { invoke } = window.__TAURI__.core;

export type RouteName = "dashboard" | "settings";

const root = document.getElementById("root");
if (!root) throw new Error("window root missing");

root.innerHTML = `
  <div id="window-header"></div>
  <div id="window-body"></div>
`;

const headerEl = root.querySelector<HTMLElement>("#window-header")!;
const bodyEl = root.querySelector<HTMLElement>("#window-body")!;

function currentRoute(): RouteName {
  const h = (location.hash || "#dashboard").replace(/^#/, "");
  return h === "settings" ? "settings" : "dashboard";
}

function renderSettingsHeader(): void {
  headerEl.innerHTML = `
    <div class="ctx-header ctx-header-settings">
      <button class="ctx-back-btn" id="back-to-dashboard">
        <i class="ph ph-arrow-left"></i> Settings
      </button>
    </div>
  `;
  headerEl.querySelector("#back-to-dashboard")!.addEventListener("click", () => {
    location.hash = "#dashboard";
  });
}

export function renderDashboardHeader(
  selectedDayStart: number,
  earliestDayStart: number,
  onNavigate: (newDayStart: number) => void,
): void {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const isPrevDisabled = selectedDayStart <= earliestDayStart;
  const isNextDisabled = selectedDayStart >= todayStart;

  const dateLabel = new Date(selectedDayStart).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });

  const minDate = new Date(earliestDayStart).toISOString().slice(0, 10);
  const maxDate = new Date(todayStart).toISOString().slice(0, 10);
  const currentDate = new Date(selectedDayStart).toISOString().slice(0, 10);

  headerEl.innerHTML = `
    <div class="ctx-header ctx-header-dashboard">
      <span class="ctx-title">Dashboard</span>
      <div class="ctx-date-nav">
        <button class="ctx-nav-btn" id="nav-prev" ${isPrevDisabled ? "disabled" : ""}>
          <i class="ph ph-caret-left"></i>
        </button>
        <input type="date" class="ctx-date-picker" id="date-picker"
          value="${currentDate}" min="${minDate}" max="${maxDate}">
        <button class="ctx-nav-btn" id="nav-next" ${isNextDisabled ? "disabled" : ""}>
          <i class="ph ph-caret-right"></i>
        </button>
      </div>
      <button class="ctx-cog-btn" id="open-settings" title="Settings">
        <i class="ph ph-gear"></i>
      </button>
    </div>
  `;

  headerEl.querySelector("#nav-prev")!.addEventListener("click", () => {
    if (!isPrevDisabled) onNavigate(selectedDayStart - 86_400_000);
  });
  headerEl.querySelector("#nav-next")!.addEventListener("click", () => {
    if (!isNextDisabled) onNavigate(selectedDayStart + 86_400_000);
  });
  headerEl.querySelector("#date-picker")!.addEventListener("change", (ev) => {
    const val = (ev.target as HTMLInputElement).value;
    if (val) onNavigate(startOfDay(new Date(val).getTime()));
  });
  headerEl.querySelector("#open-settings")!.addEventListener("click", () => {
    location.hash = "#settings";
  });
}

// startOfDay helper (duplicates rollup.ts to avoid circular import)
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function mount() {
  const route = currentRoute();
  bodyEl.innerHTML = "";
  if (route === "settings") {
    renderSettingsHeader();
    mountSettings(bodyEl);
  } else {
    mountDashboard(bodyEl, headerEl, renderDashboardHeader);
  }
}

window.addEventListener("hashchange", mount);

(async () => {
  try {
    const s = await invoke<any>("get_settings");
    applyTheme(s?.__kit_theme ?? "system");
  } catch {
    applyTheme("system");
  }
  mount();
})();
```

---

## Task 7: Dashboard — Full Rewrite

**Spec:** Sections 1, 3, 4, 6 — Pagination state, load day events, render summary strip + timeline, update header on navigate.

**Files:**
- Rewrite: `src/views/dashboard/dashboard.ts`

- [ ] **Step 1: Rewrite `src/views/dashboard/dashboard.ts`**

```typescript
// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { todayTotals, startOfDay, endOfDay } from "./rollup";
import { renderSummaryStrip } from "./summary-strip";
import { renderTimeline } from "./timeline";
// Inline type to avoid circular import (router.ts imports dashboard.ts)
type RenderHeaderFn = (
  selectedDayStart: number,
  earliestDayStart: number,
  onNavigate: (newDay: number) => void,
) => void;

let selectedDayStart: number = startOfDay(Date.now());
let earliestDayStart: number = startOfDay(Date.now());

let unlistenStats: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function teardown() {
  if (unlistenStats) { unlistenStats(); unlistenStats = null; }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

async function loadEarliestDay(): Promise<number> {
  // Fetch a wide range to find oldest event. Retention max is 365 days.
  const farPast = Date.now() - 366 * 86_400_000;
  try {
    const events = await invoke("get_stats_range", { startMs: farPast, endMs: Date.now() });
    if (events.length === 0) return startOfDay(Date.now());
    const oldest = Math.min(...events.map((e: any) => e.start_ms));
    return startOfDay(oldest);
  } catch {
    return startOfDay(Date.now());
  }
}

async function refresh(
  stripEl: HTMLElement,
  timelineEl: HTMLElement,
  headerEl: HTMLElement,
  renderHeader: typeof RenderHeaderFn,
): Promise<void> {
  const now = Date.now();
  const settings = await invoke("get_settings").catch(() => ({})) as any;
  const cap: number = settings?.idle_gap_cap_minutes ?? 240;

  const events = await getRange(startOfDay(selectedDayStart), endOfDay(selectedDayStart));

  // For past days pass endOfDay-1ms so startOfDay() inside todayTotals stays on the right day.
  // For today pass `now` so open events are capped at current time.
  const isToday = selectedDayStart === startOfDay(now);
  const nowArg = isToday ? now : endOfDay(selectedDayStart) - 1;
  const totals = todayTotals(events, nowArg, cap);
  renderSummaryStrip(stripEl, totals);
  renderTimeline(timelineEl, events, selectedDayStart, now);
  renderHeader(selectedDayStart, earliestDayStart, (newDay) => {
    selectedDayStart = newDay;
    refresh(stripEl, timelineEl, headerEl, renderHeader);
  });
}

export function mountDashboard(
  root: HTMLElement,
  headerEl: HTMLElement,
  renderHeader: typeof RenderHeaderFn,
): void {
  teardown();

  selectedDayStart = startOfDay(Date.now());

  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-strip"></div>
      <div id="dash-timeline"></div>
    </div>
  `;

  const stripEl = root.querySelector<HTMLElement>("#dash-strip")!;
  const timelineEl = root.querySelector<HTMLElement>("#dash-timeline")!;

  loadEarliestDay().then((earliest) => {
    earliestDayStart = earliest;
    refresh(stripEl, timelineEl, headerEl, renderHeader);
  });

  listen("stats-updated", () => {
    refresh(stripEl, timelineEl, headerEl, renderHeader);
  }).then((un) => { unlistenStats = un; });

  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      refresh(stripEl, timelineEl, headerEl, renderHeader);
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npm run build
```

Expected: no type errors. Fix any import errors from deleted files.

---

## Task 8: CSS — Headers, Strip, Timeline

**Files:**
- Modify: `src/styles/dashboard.css`

- [ ] **Step 1: Append to `src/styles/dashboard.css`**

Add these rules at the end of the file:

```css
/* ── Context headers ─────────────────────────────── */
#window-header {
  flex-shrink: 0;
}

.ctx-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #2a2a2a);
  gap: 8px;
  height: 38px;
  box-sizing: border-box;
}

.ctx-title {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  color: var(--text-primary, #e0e0e0);
}

.ctx-back-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary, #aaa);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 4px;
}
.ctx-back-btn:hover { background: var(--hover-bg, rgba(255,255,255,0.06)); }

.ctx-cog-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary, #aaa);
  font-size: 16px;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.ctx-cog-btn:hover { color: var(--text-primary, #e0e0e0); }

.ctx-date-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ctx-nav-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary, #aaa);
  font-size: 14px;
  padding: 2px 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.ctx-nav-btn:disabled { opacity: 0.3; cursor: default; }
.ctx-nav-btn:not(:disabled):hover { background: var(--hover-bg, rgba(255,255,255,0.06)); }

.ctx-date-picker {
  background: var(--input-bg, #2a2a2a);
  border: 1px solid var(--border, #444);
  color: var(--text-primary, #e0e0e0);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
  cursor: pointer;
}

/* ── Summary strip ───────────────────────────────── */
#dash-strip {
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #2a2a2a);
}

.summary-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.summary-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 12px;
  background: var(--chip-bg, rgba(255,255,255,0.06));
  color: var(--text-secondary, #aaa);
}

.summary-chip-work { color: #4a9eff; }
.summary-chip-sessions { color: #7ec77f; }
.summary-chip-idle { color: #9aa0a6; }

/* ── Timeline ────────────────────────────────────── */
#dash-timeline {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.timeline-scroll {
  display: flex;
  min-height: 100%;
}

.tl-axis-col {
  position: relative;
  width: 52px;
  flex-shrink: 0;
  border-right: 1px solid var(--border, #2a2a2a);
}

.tl-axis-label {
  position: absolute;
  right: 6px;
  font-size: 9px;
  color: var(--text-muted, #555);
  transform: translateY(-50%);
  white-space: nowrap;
}

.tl-track {
  position: relative;
  flex: 1;
  background: var(--track-bg, #181818);
}

.tl-gridline {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--border, #2a2a2a);
  pointer-events: none;
}

.tl-hour-label {
  display: none; /* labels on axis col only */
}

.tl-block {
  position: absolute;
  left: 4px;
  right: 4px;
  border-radius: 2px;
  cursor: default;
  transition: opacity 0.1s;
}
.tl-block:hover { opacity: 0.8; }

.timeline-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: var(--text-muted, #555);
  font-size: 13px;
}

/* dashboard flex layout */
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
}
```

- [ ] **Step 2: Run `npm run build` to verify no TS/CSS errors**

Expected: clean compile.

- [ ] **Step 3: Commit all dashboard changes via `/commit` skill**

Suggested message: `FEAT: dashboard redesign - vertical timeline, context headers, summary strip, per-day pagination`

---

## Task 9: Visual Verification

- [ ] **Step 1: Run `npm run tauri dev`**

Check:
- Dashboard opens on today's day with the date navigator in the header.
- Cog icon navigates to Settings. Back button returns to Dashboard.
- Timeline shows colored blocks for today's events. Hover shows tooltip.
- Prev/Next pagination loads different days. Prev is disabled at oldest day; Next is disabled on today.
- Summary strip shows focus time, session count, idle time.
- Empty day shows "No activity on [date]" message.
- Stats Settings page shows only "Retention" group with `Keep stats for (days)` field. The three card-toggle fields are gone.

- [ ] **Step 2: Verify the 113h bug is gone**

If you had the bug before, open today's dashboard. "Other" total in summary strip should be a sane number (minutes, not hundreds of hours). The next app launch after the fix closes all dangling events.

---

## Rollup.ts Note

`sevenDayBuckets` in `rollup.ts` is no longer called anywhere. Leave it in place (it's pure, no side effects). It can be deleted in a future cleanup pass.
