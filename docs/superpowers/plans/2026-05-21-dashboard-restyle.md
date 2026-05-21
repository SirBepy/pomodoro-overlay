# Dashboard Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ugly tall vertical timeline with a fixed 24h horizontal day-bar + phase breakdown + session list, and ship a sleek reusable scrollbar in the tauri_kit submodule.

**Architecture:** Pure positioning/aggregation helpers (vitest-tested, node env) feed thin DOM renderers. The day-bar maps each event to a `left%`/`width%` segment across a fixed 24h span; breakdown and session list reuse the existing `rollup.ts` numbers and `PHASE_COLORS`. The scrollbar is a tokenized CSS file added to the kit's existing `@import` chain, which the dashboard already loads via `router.ts`.

**Tech Stack:** TypeScript, lit-html (templates not needed here - innerHTML strings), vitest (node env), CSS custom properties. No Rust changes.

---

## Commit policy (Joe's global rules - READ FIRST)

- NEVER run bare `git commit`. The main agent commits via the `/commit` skill.
- **Subagents must NOT commit.** Each task's final step says "Stage with `git add <files>`; do NOT commit. Report back; main agent runs `/commit`." If executing inline, the orchestrator runs `/commit` after each task instead.
- One PowerShell/Bash command per call. No `&&`, `;`, `|`. Use `git -C <abs-path>`.
- **Submodule (Task 1):** commit the submodule first; it must be pushed before the parent or CI fails ("not our ref"). Do not push unless Joe asks - just commit and flag the unpushed submodule in the report.

## File structure

- `vendor/tauri_kit/frontend/settings/styles/tokens.css` - add `--scrollbar-*` tokens (3 theme blocks). [submodule]
- `vendor/tauri_kit/frontend/settings/styles/scrollbar.css` - NEW, global scrollbar rules. [submodule]
- `vendor/tauri_kit/frontend/settings/styles.css` - append scrollbar import. [submodule]
- `src/views/dashboard/day-view.ts` - NEW. Pure helpers: `daySegments`, `breakdownRows`, `sessionRows` + their types.
- `src/views/dashboard/__tests__/day-view.test.ts` - NEW. Tests for the three helpers.
- `src/views/dashboard/day-bar.ts` - NEW. `renderDayBar` (replaces `timeline.ts`).
- `src/views/dashboard/breakdown.ts` - NEW. `renderBreakdown`.
- `src/views/dashboard/sessions.ts` - NEW. `renderSessions`.
- `src/views/dashboard/timeline.ts` - DELETE after `day-bar.ts` lands.
- `src/views/dashboard/dashboard.ts` - rewire markup + `refresh` to the three new renderers.
- `src/styles/dashboard.css` - drop `.timeline-*` / `.tl-*` rules; add day-bar / breakdown / session-list rules.
- `src/views/dashboard/phase-colors.ts`, `rollup.ts`, `fmt.ts` - unchanged (consumed only).

---

## Task 1: Shared scrollbar in tauri_kit submodule

**Files:**
- Modify: `vendor/tauri_kit/frontend/settings/styles/tokens.css`
- Create: `vendor/tauri_kit/frontend/settings/styles/scrollbar.css`
- Modify: `vendor/tauri_kit/frontend/settings/styles.css`

No unit test (CSS only). Verified by build + manual QA in Task 8.

- [ ] **Step 1: Add `--scrollbar-*` tokens to the light block**

In `tokens.css`, inside `:root, [data-theme="light"]` (after `--kit-border`), add:

```css
  --scrollbar-thumb:       rgba(0, 0, 0, 0.22);
  --scrollbar-thumb-hover: rgba(0, 0, 0, 0.38);
  --scrollbar-track:       transparent;
  --scrollbar-size:        9px;
```

- [ ] **Step 2: Add the dark tokens to BOTH dark blocks**

Add the same four lines (dark values) inside `[data-theme="dark"]` AND inside the `@media (prefers-color-scheme: dark) { [data-theme="system"] { ... } }` block:

```css
  --scrollbar-thumb:       rgba(255, 255, 255, 0.18);
  --scrollbar-thumb-hover: rgba(255, 255, 255, 0.32);
  --scrollbar-track:       transparent;
  --scrollbar-size:        9px;
```

- [ ] **Step 3: Create `scrollbar.css`**

```css
/* sirbepy_tauri_kit - global scrollbar. Themed via --scrollbar-* in tokens.css.
   Standards props as cross-engine fallback; webkit pseudo-elements gated behind
   @supports so the two mechanisms never collide on one element. */
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
    border: 2px solid transparent;
    background-clip: padding-box;
    min-height: 36px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-corner { background: transparent; }
}
```

- [ ] **Step 4: Append the import**

In `vendor/tauri_kit/frontend/settings/styles.css`, add after the existing imports:

```css
@import url("./styles/scrollbar.css");
```

- [ ] **Step 5: Stage the submodule changes (do NOT commit)**

The submodule is its own git repo. Stage inside it:

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay\vendor\tauri_kit" add frontend/settings/styles/tokens.css frontend/settings/styles/scrollbar.css frontend/settings/styles.css`

Report back: "tauri_kit scrollbar staged - needs submodule commit (`/commit`) then parent pointer bump. Submodule must be pushed before parent."

---

## Task 2: Day-view pure helpers (TDD)

**Files:**
- Create: `src/views/dashboard/day-view.ts`
- Test: `src/views/dashboard/__tests__/day-view.test.ts`

These are the only logic-bearing pieces; the renderers below are thin wrappers.

- [ ] **Step 1: Write the failing test**

Create `src/views/dashboard/__tests__/day-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { daySegments, breakdownRows, sessionRows } from "../day-view";
import { startOfDay } from "../rollup";
import { PHASE_COLORS } from "../phase-colors";
import type { StatsEvent } from "../../../shared/stats";
import type { DayTotals } from "../rollup";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const ev = (start_ms: number, end_ms: number | null, phase: StatsEvent["phase"] = "work"): StatsEvent => ({
  session_id: `s-${start_ms}`, phase, start_ms, end_ms, configured_seconds: 1500, ended_by: "natural",
});

describe("daySegments", () => {
  it("maps an event to left%/width% across a fixed 24h day", () => {
    const day = startOfDay(1_700_000_000_000);
    const segs = daySegments([ev(day + 6 * HOUR, day + 12 * HOUR, "work")], day, day + 24 * HOUR);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBeCloseTo(25, 5);   // 6/24
    expect(segs[0].widthPct).toBeCloseTo(25, 5);   // 6/24
    expect(segs[0].color).toBe(PHASE_COLORS.work);
  });

  it("clips open events to now and out-of-day edges to the day bounds", () => {
    const day = startOfDay(1_700_000_000_000);
    const segs = daySegments([ev(day - 2 * HOUR, null, "work")], day, day + 3 * HOUR);
    expect(segs[0].leftPct).toBeCloseTo(0, 5);     // clipped to dayStart
    expect(segs[0].widthPct).toBeCloseTo(12.5, 5); // 3h of 24h
  });

  it("drops zero/negative-length segments", () => {
    const day = startOfDay(1_700_000_000_000);
    expect(daySegments([ev(day + HOUR, day + HOUR, "work")], day, day + 24 * HOUR)).toHaveLength(0);
  });
});

describe("breakdownRows", () => {
  const totals: DayTotals = {
    work_ms: 90 * MIN, short_ms: 20 * MIN, long_ms: 10 * MIN,
    other_ms: 0, snooze_ms: 0, idle_ms: 60 * MIN, work_sessions_completed: 3,
  };
  it("combines short+long into breaks and drops zero buckets", () => {
    const rows = breakdownRows(totals);
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(["work", "breaks", "idle"]); // other=0 dropped
    const breaks = rows.find((r) => r.key === "breaks")!;
    expect(breaks.ms).toBe(30 * MIN);
    expect(breaks.color).toBe(PHASE_COLORS.short);
  });
  it("computes pct as share of summed buckets", () => {
    const rows = breakdownRows(totals); // sum = 90+30+60 = 180
    expect(rows.find((r) => r.key === "work")!.pct).toBeCloseTo(50, 5);
  });
  it("returns empty array when everything is zero", () => {
    expect(breakdownRows({ work_ms: 0, short_ms: 0, long_ms: 0, other_ms: 0, snooze_ms: 0, idle_ms: 0, work_sessions_completed: 0 })).toEqual([]);
  });
});

describe("sessionRows", () => {
  const day = startOfDay(1_700_000_000_000);
  it("returns oldest-first rows with clipped durations and colors", () => {
    const rows = sessionRows([
      ev(day + 10 * HOUR, day + 10 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR, day + 9 * HOUR + 5 * MIN, "short"),
    ], day, day + 24 * HOUR);
    expect(rows.map((r) => r.startMs)).toEqual([day + 9 * HOUR, day + 10 * HOUR]);
    expect(rows[0].durationMs).toBe(5 * MIN);
    expect(rows[1].color).toBe(PHASE_COLORS.work);
  });
  it("clips an open event to now", () => {
    const rows = sessionRows([ev(day + 9 * HOUR, null, "work")], day, day + 9 * HOUR + 10 * MIN);
    expect(rows[0].durationMs).toBe(10 * MIN);
  });
  it("excludes zero-length events", () => {
    expect(sessionRows([ev(day + 9 * HOUR, day + 9 * HOUR, "work")], day, day + 24 * HOUR)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test - verify it fails**

Run: `npm test -- day-view`
Expected: FAIL ("Cannot find module '../day-view'" / exports undefined).

- [ ] **Step 3: Implement `day-view.ts`**

```ts
import type { StatsEvent, Phase } from "../../shared/stats";
import type { DayTotals } from "./rollup";
import { endOfDay } from "./rollup";
import { PHASE_COLORS } from "./phase-colors";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BarSegment {
  leftPct: number;
  widthPct: number;
  color: string;
  phase: Phase;
  startMs: number;
  endMs: number;
}

/** Map each event to a proportional segment across the fixed 24h of `dayStart`.
 *  Open events (end_ms == null) clip to min(now, endOfDay). Min visual width is a CSS concern. */
export function daySegments(events: StatsEvent[], dayStart: number, now: number): BarSegment[] {
  const dayEnd = endOfDay(dayStart);
  const out: BarSegment[] = [];
  for (const e of events) {
    const start = Math.max(e.start_ms, dayStart);
    const end = Math.min(e.end_ms ?? now, dayEnd, now); // clip to day end and (for open events) to now
    if (end <= start) continue;
    out.push({
      leftPct: ((start - dayStart) / DAY_MS) * 100,
      widthPct: ((end - start) / DAY_MS) * 100,
      color: (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888",
      phase: e.phase,
      startMs: start,
      endMs: end,
    });
  }
  return out;
}

export interface BreakdownRow {
  key: "work" | "breaks" | "idle" | "other";
  label: string;
  ms: number;
  color: string;
  pct: number;
}

/** Buckets for the breakdown block: work / breaks(short+long) / idle / other.
 *  Drops zero buckets; pct = share of summed non-zero buckets. */
export function breakdownRows(totals: DayTotals): BreakdownRow[] {
  const raw: Array<Omit<BreakdownRow, "pct">> = [
    { key: "work", label: "Work", ms: totals.work_ms, color: PHASE_COLORS.work },
    { key: "breaks", label: "Breaks", ms: totals.short_ms + totals.long_ms, color: PHASE_COLORS.short },
    { key: "idle", label: "Idle", ms: totals.idle_ms, color: PHASE_COLORS.idle },
    { key: "other", label: "Other", ms: totals.other_ms, color: PHASE_COLORS.other },
  ];
  const nonZero = raw.filter((r) => r.ms > 0);
  const sum = nonZero.reduce((acc, r) => acc + r.ms, 0);
  if (sum === 0) return [];
  return nonZero.map((r) => ({ ...r, pct: (r.ms / sum) * 100 }));
}

export interface SessionRow {
  startMs: number;
  phase: Phase;
  durationMs: number;
  color: string;
}

/** Oldest-first rows for the session list. Clips open events to now; excludes zero-length.
 *  Idle is gap time (not an event), so it does not appear here. */
export function sessionRows(events: StatsEvent[], dayStart: number, now: number): SessionRow[] {
  const dayEnd = endOfDay(dayStart);
  const rows: SessionRow[] = [];
  for (const e of events) {
    const start = Math.max(e.start_ms, dayStart);
    const end = Math.min(e.end_ms ?? now, dayEnd);
    if (end <= start) continue;
    rows.push({
      startMs: start,
      phase: e.phase,
      durationMs: end - start,
      color: (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888",
    });
  }
  rows.sort((a, b) => a.startMs - b.startMs);
  return rows;
}
```

- [ ] **Step 4: Run the test - verify it passes**

Run: `npm test -- day-view`
Expected: PASS (all 3 describe blocks green).

- [ ] **Step 5: Stage (do NOT commit)**

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay" add src/views/dashboard/day-view.ts src/views/dashboard/__tests__/day-view.test.ts`
Report back for `/commit`.

---

## Task 3: Day-bar renderer

**Files:**
- Create: `src/views/dashboard/day-bar.ts`

Renders the 24h bar from `daySegments`. CSS comes in Task 7. No unit test (DOM string; covered by helper tests + manual QA).

- [ ] **Step 1: Implement `day-bar.ts`**

```ts
import type { StatsEvent } from "../../shared/stats";
import { daySegments } from "./day-view";
import { endOfDay } from "./rollup";

function fmt12(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

const AXIS_TICKS = ["12a", "6a", "12p", "6p", "12a"]; // fixed, never shift

export function renderDayBar(root: HTMLElement, events: StatsEvent[], dayStart: number, now: number): void {
  const dayEnd = endOfDay(dayStart);
  const dayEvents = events.filter((e) => (e.end_ms ?? now) >= dayStart && e.start_ms <= dayEnd);

  if (dayEvents.length === 0) {
    const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    root.innerHTML = `
      <div class="day-bar day-bar--empty"></div>
      <div class="day-axis">${AXIS_TICKS.map((t) => `<span>${t}</span>`).join("")}</div>
      <div class="day-bar-empty-msg">No activity on ${label}</div>
    `;
    return;
  }

  const segs = daySegments(dayEvents, dayStart, now).map((s) => {
    const tip = `${s.phase} · ${fmt12(s.startMs)}–${fmt12(s.endMs)} · ${fmtDuration(s.endMs - s.startMs)}`;
    return `<div class="day-bar-seg" style="left:${s.leftPct}%;width:${s.widthPct}%;background:${s.color};" title="${tip}"></div>`;
  }).join("");

  root.innerHTML = `
    <div class="day-bar">${segs}</div>
    <div class="day-axis">${AXIS_TICKS.map((t) => `<span>${t}</span>`).join("")}</div>
  `;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS (no TS errors). `day-bar.ts` not yet imported anywhere, so no behavior change.

- [ ] **Step 3: Stage (do NOT commit)**

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay" add src/views/dashboard/day-bar.ts`
Report back for `/commit`.

---

## Task 4: Breakdown renderer

**Files:**
- Create: `src/views/dashboard/breakdown.ts`

- [ ] **Step 1: Implement `breakdown.ts`**

```ts
import type { DayTotals } from "./rollup";
import { breakdownRows } from "./day-view";
import { fmtHoursMinutes } from "./fmt";

export function renderBreakdown(root: HTMLElement, totals: DayTotals): void {
  const rows = breakdownRows(totals);
  if (rows.length === 0) { root.innerHTML = ""; return; }
  root.innerHTML = `
    <div class="breakdown">
      ${rows.map((r) => `
        <div class="breakdown-row">
          <span class="breakdown-label">${r.label}</span>
          <span class="breakdown-track">
            <span class="breakdown-fill" style="width:${r.pct}%;background:${r.color};"></span>
          </span>
          <span class="breakdown-value">${fmtHoursMinutes(r.ms)}</span>
        </div>
      `).join("")}
    </div>
  `;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Stage (do NOT commit)**

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay" add src/views/dashboard/breakdown.ts`
Report back for `/commit`.

---

## Task 5: Session list renderer

**Files:**
- Create: `src/views/dashboard/sessions.ts`

- [ ] **Step 1: Implement `sessions.ts`**

```ts
import type { StatsEvent } from "../../shared/stats";
import { sessionRows } from "./day-view";

const PHASE_LABEL: Record<string, string> = {
  work: "Work", short: "Short break", long: "Long break", other: "Other", snooze: "Snooze", idle: "Idle",
};

function fmt12(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

export function renderSessions(root: HTMLElement, events: StatsEvent[], dayStart: number, now: number): void {
  const rows = sessionRows(events, dayStart, now);
  if (rows.length === 0) { root.innerHTML = ""; return; }
  root.innerHTML = `
    <div class="session-list">
      ${rows.map((r) => `
        <div class="session-row">
          <span class="session-dot" style="background:${r.color};"></span>
          <span class="session-time">${fmt12(r.startMs)}</span>
          <span class="session-phase">${PHASE_LABEL[r.phase] ?? r.phase}</span>
          <span class="session-dur">${fmtDuration(r.durationMs)}</span>
        </div>
      `).join("")}
    </div>
  `;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Stage (do NOT commit)**

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay" add src/views/dashboard/sessions.ts`
Report back for `/commit`.

---

## Task 6: Rewire dashboard.ts

**Files:**
- Modify: `src/views/dashboard/dashboard.ts`

Swap the timeline import + container + render call for the three new renderers. `totals` (a `DayTotals`) is already computed in `refresh` and already corresponds to the *selected* day (see note below), so the breakdown reuses it directly.

> Note: `todayTotals(events, nowArg, cap)` derives its day from `nowArg`. `refresh` passes `nowArg = isToday ? now : endOfDay(selectedDayStart) - 1`, so `startOfDay(nowArg) === selectedDayStart` for past days. The totals already match the selected day - no change needed.

- [ ] **Step 1: Update imports**

Replace:
```ts
import { renderTimeline } from "./timeline";
```
with:
```ts
import { renderDayBar } from "./day-bar";
import { renderBreakdown } from "./breakdown";
import { renderSessions } from "./sessions";
```

- [ ] **Step 2: Update `refresh` signature + body**

Change `refresh` to take three body containers instead of one timeline element. Replace the `refresh` function's parameter list and the render section:

```ts
async function refresh(
  paginationEl: HTMLElement,
  stripEl: HTMLElement,
  barEl: HTMLElement,
  breakdownEl: HTMLElement,
  sessionsEl: HTMLElement,
  renderHeader: RenderHeaderFn,
): Promise<void> {
  const now = Date.now();
  const settings = await invoke("get_settings").catch(() => ({})) as any;
  const cap: number = settings?.idle_gap_cap_minutes ?? 240;

  const events = await getRange(startOfDay(selectedDayStart), endOfDay(selectedDayStart));

  const isToday = selectedDayStart === startOfDay(now);
  const nowArg = isToday ? now : endOfDay(selectedDayStart) - 1;
  const totals = todayTotals(events, nowArg, cap);

  renderSummaryStrip(stripEl, totals);
  renderDayBar(barEl, events, selectedDayStart, now);
  renderBreakdown(breakdownEl, totals);
  renderSessions(sessionsEl, events, selectedDayStart, now);
  renderHeader();
  renderPagination(paginationEl, selectedDayStart, earliestDayStart, (newDay) => {
    selectedDayStart = newDay;
    refresh(paginationEl, stripEl, barEl, breakdownEl, sessionsEl, renderHeader);
  });
}
```

- [ ] **Step 3: Update `mountDashboard` markup + wiring**

Replace the `root.innerHTML` block and the element lookups + the three `refresh(...)` call sites:

```ts
  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-pagination"></div>
      <div id="dash-strip"></div>
      <div id="dash-bar"></div>
      <div id="dash-breakdown"></div>
      <div id="dash-sessions"></div>
    </div>
  `;

  const paginationEl = root.querySelector<HTMLElement>("#dash-pagination")!;
  const stripEl = root.querySelector<HTMLElement>("#dash-strip")!;
  const barEl = root.querySelector<HTMLElement>("#dash-bar")!;
  const breakdownEl = root.querySelector<HTMLElement>("#dash-breakdown")!;
  const sessionsEl = root.querySelector<HTMLElement>("#dash-sessions")!;
```

Update all three `refresh(...)` call sites (in `loadEarliestDay().then`, the `stats-updated` listener, and `visibilityHandler`) to:
```ts
    refresh(paginationEl, stripEl, barEl, breakdownEl, sessionsEl, renderHeader);
```

- [ ] **Step 4: Delete the old timeline file**

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay" rm src/views/dashboard/timeline.ts`
Expected: file removed and staged.

- [ ] **Step 5: Verify build + tests**

Run: `npm run build`
Expected: PASS (no remaining `timeline` import).
Run: `npm test`
Expected: PASS (rollup + day-view suites green).

- [ ] **Step 6: Stage (do NOT commit)**

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay" add src/views/dashboard/dashboard.ts`
Report back for `/commit`. (timeline.ts deletion already staged by `git rm`.)

---

## Task 7: Dashboard CSS

**Files:**
- Modify: `src/styles/dashboard.css`

- [ ] **Step 1: Remove the old timeline rules**

Delete every rule under the `/* ── Timeline ── */` section: `#dash-timeline`, `.timeline-scroll`, `.tl-axis-col`, `.tl-axis-label`, `.tl-track`, `.tl-gridline`, `.tl-hour-label`, `.tl-block`, `.tl-block:hover`, `.timeline-empty`.

- [ ] **Step 2: Add the new day-view rules**

Append to `dashboard.css`:

```css
/* ── 24h day-bar ─────────────────────────────────── */
#dash-bar { flex-shrink: 0; padding: 8px 10px 2px; }

.day-bar {
  position: relative;
  height: 22px;
  border-radius: 4px;
  background: var(--track-bg, #181818);
  overflow: hidden;
}
.day-bar-seg {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 2px;        /* keep slivers from fully vanishing */
  border-radius: 1px;
}
.day-axis {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--text-muted, #555);
  padding: 2px 1px 0;
}
.day-bar-empty-msg {
  text-align: center;
  color: var(--text-muted, #555);
  font-size: 12px;
  padding: 8px 0;
}

/* ── Phase breakdown ─────────────────────────────── */
#dash-breakdown { flex-shrink: 0; padding: 6px 10px; border-bottom: 1px solid var(--border, #2a2a2a); }
.breakdown { display: flex; flex-direction: column; gap: 4px; }
.breakdown-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.breakdown-label { width: 48px; flex-shrink: 0; color: var(--text-secondary, #aaa); }
.breakdown-track { flex: 1; height: 6px; border-radius: 3px; background: var(--track-bg, #181818); overflow: hidden; }
.breakdown-fill { display: block; height: 100%; border-radius: 3px; }
.breakdown-value { width: 52px; flex-shrink: 0; text-align: right; color: var(--text-secondary, #aaa); }

/* ── Session list ────────────────────────────────── */
#dash-sessions { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 10px 8px; }
.session-list { display: flex; flex-direction: column; }
.session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border, #2a2a2a);
}
.session-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.session-time { width: 64px; flex-shrink: 0; color: var(--text-secondary, #aaa); }
.session-phase { flex: 1; color: var(--text-primary, #e0e0e0); }
.session-dur { flex-shrink: 0; color: var(--text-secondary, #aaa); }
```

> The `.dashboard` container already has `height:100%; overflow:hidden` and the body scroll lives on `#dash-sessions` (`flex:1; overflow-y:auto`). This makes the session list the only scroll region; the kit scrollbar from Task 1 styles it.

- [ ] **Step 2b: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Stage (do NOT commit)**

Run: `git -C "C:\Users\tecno\Desktop\Projects\pomodoro-overlay" add src/styles/dashboard.css`
Report back for `/commit`.

---

## Task 8: Manual QA (supersedes ai_todo 04)

**Files:** none (verification).

- [ ] **Step 1: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Walk the dashboard**

Confirm each:
- 24h day-bar renders segments in phase colors at correct positions; hover tooltip shows phase/time/duration.
- Breakdown rows (Work/Breaks/Idle/Other) are proportional, colored, and drop zero buckets.
- Session list scrolls with the new sleek thin scrollbar (not the chunky OS one); rows oldest-first with colored dots.
- Empty day shows the empty bar + "No activity on <date>".
- Pagination prev/next + date-jump still work and re-render all three regions.
- Dark theme correct; layout holds at small window sizes; no console errors.
- Scrollbar styling also applies on the Settings route (kit-wide).

- [ ] **Step 3: Mark ai_todo done**

Delete `.for_bepy/ai_todos/04-dashboard-visual-qa.md` (this plan's QA supersedes it). Stage the deletion for `/commit`.

- [ ] **Step 4: Submodule push reminder**

If Joe wants to deploy: the tauri_kit submodule commit (Task 1) must be pushed BEFORE the parent repo, or CI fails ("not our ref"). Then bump the parent's submodule pointer and push the parent.

---

## Self-review notes

- Spec Part A (scrollbar) → Task 1. Reaches dashboard via existing `router.ts` kit `styles.css` import (verified). ✓
- Spec Part B1 (24h bar) → Tasks 2 (`daySegments`) + 3. Fixed axis ticks, min-width slivers, open-event clip, empty state. ✓
- Spec Part B2 (breakdown) → Tasks 2 (`breakdownRows`) + 4. short+long=breaks, idle, other; colors from PHASE_COLORS. ✓
- Spec Part B3 (session list) → Tasks 2 (`sessionRows`) + 5. Oldest-first, no idle rows, only scroll region. ✓
- Wiring + old-file removal → Tasks 6, 7. ✓
- Verification → `npm run build`, `npm test`, manual QA Task 8. No Rust → no `cargo check`. ✓
- Type consistency: `daySegments`/`breakdownRows`/`sessionRows` signatures defined in Task 2 match all renderer call sites in Tasks 3-5 and the `refresh` calls in Task 6. ✓
