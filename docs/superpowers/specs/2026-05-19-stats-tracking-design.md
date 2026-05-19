# Stats tracking + Dashboard window

Date: 2026-05-19

## Goal

Record where each minute of the day goes (focus / break / stopwatch / snooze / idle) so the user can spot patterns — primarily: how much time leaks into untracked gaps after breaks. Surface this through a new Dashboard view that becomes the primary entry point to the secondary window; existing Settings UI moves into a tab inside the same window.

## Non-goals (v1)

- Custom date ranges, month view, year view.
- Per-session detail / clickable bars.
- CSV / JSON export.
- Labels or tags on stopwatch sessions (e.g. "dog walk").
- Sync across machines.

## Scope summary

1. New phase: `PHASE_OTHER` (stopwatch, counts up, off the work/break cycle).
2. Append-only event log persisted in a new Rust-managed file (`stats.json`).
3. New IPC commands to append, query, and reset the log.
4. The existing secondary window (currently "Settings") becomes a router-driven window with two routes: `#dashboard` (new, default) and `#settings` (existing UI, unchanged).
5. Tray right-click menu: replace `Settings...` with `Dashboard`. No ellipsis on any item.
6. New setting: `idle_gap_cap_minutes` (default 240).

## Data model

### Event

Each event represents one continuous active interval of one phase. A pause splits one logical phase instance ("session") into multiple intervals that share a `session_id`.

```ts
type StatsEvent = {
  session_id: string;          // uuid; shared by intervals of the same phase instance
  phase: "work" | "short" | "long" | "other" | "snooze";
  start_ms: number;            // epoch millis
  end_ms: number | null;       // null while the event is currently open
  configured_seconds: number | null;  // configured length at start; null for stopwatch
  ended_by: "natural" | "pause" | "skip" | "switch" | "app_close" | null;
                               // null while open
};
```

Open events (`end_ms === null`) are closed:
- On the next phase transition (pause / skip / switch / natural end).
- On app start, if a previous run left one open (closed with `app_close`, see Recovery).
- On Tauri `ExitRequested` (closed with `app_close`).

### Storage layout

New file: `stats.json` in the same directory as `settings.json`. Top-level shape:

```json
{
  "version": 1,
  "events": [ /* StatsEvent[] in append order */ ]
}
```

`serde(default)` on the wrapper handles missing fields. Saved via plain `serde_json` + atomic rename (write `.tmp` then rename); does not need to go through `tauri-kit-settings`. Saved on every event mutation; debouncing is not needed at this rate (~25 writes/day).

### Recovery (app close mid-run)

On startup, after loading `stats.json`:

1. If the last event has `end_ms === null`, set its `end_ms = max(start_ms, savedAt_of_resumable_state)` and `ended_by = "app_close"`.
2. The existing `loadState()` in `main.ts` already determines whether the previous run was active and how much elapsed. Reuse `savedAt` from the pomodoro state localStorage entry as the close timestamp when present; otherwise use `start_ms` (zero-length close).

This means a force-killed app produces one closed event with `app_close` reason — no dangling open events.

### Resume

When `loadState()` chooses to resume an active phase, `main.ts` opens a *new* event with a new `session_id`. The closed-on-startup event represents the previous run; the resumed run is its own session. The gap between the two will register as idle in the dashboard rollup.

## Phase: stopwatch (`PHASE_OTHER`)

A 4th tab in the timer overlay, after Long: `Focus | Short | Long | Other`.

Semantics:
- Counts up from `0:00`. No `phaseDuration` value applies; `configured_seconds` in the event is `null`.
- Switching to `PHASE_OTHER` pauses the current phase (existing `setPhase` behaviour) and closes its event with `ended_by: "switch"`.
- Does not advance `workSessionsCompleted`.
- Does not trigger break transitions, snooze, fullscreen, music pause, or DnD. It is neutral.
- Pressing skip ends the session (`ended_by: "skip"`) and returns to `PHASE_WORK`.
- Pressing pause closes the current interval (`ended_by: "pause"`); pressing start re-opens a new interval with the same `session_id`.
- Saved state (`STATE_KEY`) persists `phase === PHASE_OTHER` and `remainingSec` (which holds *elapsed* seconds for stopwatch, not remaining). The resume math in `loadState()` adds elapsed-since-savedAt for stopwatch instead of subtracting, then continues counting up.

`tick()` increments `remainingSec` for `PHASE_OTHER` instead of decrementing, and never triggers `handlePhaseEnd()`.

Display format unchanged (`MM:SS`); when minutes ≥ 60 the formatter switches to `H:MM:SS`.

### Tab name

Default label: **`Other`**. (`PHASE_OTHER` in code.) The user can revisit the label later — this is a string change only.

## Idle metric

Definition: wall time on a given day not covered by any event.

Computation:
1. Take all events overlapping the date range (clip start/end at range boundaries).
2. Sort by `start_ms`.
3. For each adjacent pair `(prev, next)`: `gap = next.start_ms - prev.end_ms`. If `gap <= idle_gap_cap_minutes * 60_000`, add it to idle. Otherwise drop it.
4. Also: leading gap (range start → first event start) and trailing gap (last event end → range end / now) follow the same cap rule.

For "today" the trailing edge is `Date.now()` when the dashboard is open. The dashboard re-fetches on visibility change so the trailing gap stays current without polling.

The same algorithm runs over the last 7 days for the 7-day idle average.

### Setting

New field `idle_gap_cap_minutes: number` (default `240`).

- `src/views/settings/schema.ts`: add field + UI control (numeric input, min 30, max 1440).
- `src-tauri/src/settings.rs`: add `idle_gap_cap_minutes: u32` to the settings struct + `Default` impl returning 240.
- Lives on the System subpage of the Settings UI.

## Window restructure

### Router

The existing secondary window (currently bootstrapped from `src/settings.html` + `src/views/settings/`) becomes a two-route window:

- `#dashboard` (default when opened)
- `#settings`

Implementation:
- Rename mental model: the file `settings.html` stays as the window entry, but `src/views/settings/settings.ts` is split:
  - New `src/views/window/router.ts` — reads `location.hash`, mounts either dashboard or settings content into `#root`.
  - New `src/views/window/tabs.ts` — renders the top tab bar; clicks update `location.hash`, triggering a router re-mount.
- New folder `src/views/dashboard/`:
  - `dashboard.ts` — top-level view, wires today + idle + chart sub-views.
  - `today.ts` — renders today totals.
  - `idle.ts` — renders today + 7-day idle.
  - `chart.ts` — renders the 7-day stacked bar chart.
  - `rollup.ts` — pure functions: `todayTotals(events, now)`, `sevenDayRollup(events, now, idleCapMinutes)`, `idleMinutes(events, rangeStart, rangeEnd, idleCapMinutes)`.
  - `phase-colors.ts` — phase → color constants.
- Existing `src/views/settings/` is untouched in behaviour. Its entry function is invoked by the router instead of running on page load.

The window opens on `#dashboard` whenever Tauri reveals it (from the tray menu). The hash is not persisted; switching tabs only updates the in-window route.

### Tray menu

`src-tauri/src/lib.rs` `build_tray`:

```rust
let play_pause = MenuItem::with_id(app, "play_pause", "Start", true, None);
let dashboard  = MenuItem::with_id(app, "dashboard",  "Dashboard", true, None);
let sep        = PredefinedMenuItem::separator(app)?;
let quit       = MenuItem::with_id(app, "quit", "Quit", true, None);
let menu = Menu::with_items(app, &[&play_pause, &dashboard, &sep, &quit])?;
```

`on_menu_event` for `"dashboard"` opens the secondary window with hash `#dashboard` (the existing `open_settings_window` helper, with a hash arg or a successor `open_window(route)` function).

The current `"settings"` menu id is removed entirely. No ellipsis on any item label.

Left-click behaviour on the tray icon (toggle main overlay visibility) is unchanged.

## Dashboard UI (layout A — stacked)

Single column, vertical scroll. Three stacked cards:

### Card 1: Today

```
TODAY
2h 15m focus   |   35m short   |   20m long   |   18m other   |   5m snooze   |   42m idle
4 work sessions completed
```

- Focus / short / long / other / snooze = sum of (end_ms - start_ms) clipped to today, per phase.
- Sessions = count of distinct `session_id`s today where `phase === "work"` and the session has at least one event with `ended_by === "natural"`.

### Card 2: Idle / unmeasured

```
IDLE TODAY        7-DAY AVG
42 min            38 min
```

Caption: `Gaps over 4h are excluded (configurable in Settings > System).` The "4h" text reads the live setting.

### Card 3: Last 7 days (bar chart)

- One bar per day, oldest left, today right.
- X-axis labels: weekday short ("Mon", "Tue", …). Today highlighted.
- Stacked segments per bar, bottom-to-top: focus (blue) → other (green) → breaks combined (grey) → snooze + idle combined (orange). The today card keeps these separate; the bar chart combines them for legibility at small sizes.
- Hand-rolled DOM, no chart library. Flex column per bar, fixed-height container, segment heights as percentages of the day's recorded total.
- Hover (on a bar) shows a tooltip with the per-phase minute breakdown for that day.

### "Clear stats" button

Footer of dashboard view. Confirm with a `tauri-plugin-dialog` `ask()` modal: "Permanently delete all stats history? This cannot be undone." On confirm, calls a new `reset_stats` IPC command that overwrites `stats.json` with `{ version: 1, events: [] }`.

### Live updates

When the dashboard window is visible:
- `main.ts` emits `stats-updated` after each IPC append.
- Dashboard listens via `listen("stats-updated", …)` and re-fetches today's events.
- 7-day rollup re-fetches only on `document.visibilitychange` to visible (cheaper).

## IPC surface

New commands in `src-tauri/src/ipc/commands.rs`:

- `append_stats_event(event: StatsEvent) -> Result<(), String>` — append, persist, emit `stats-updated`.
- `close_open_event(end_ms: i64, ended_by: String) -> Result<(), String>` — update the latest event if open; emit `stats-updated`.
- `get_stats_range(start_ms: i64, end_ms: i64) -> Result<Vec<StatsEvent>, String>` — return all events overlapping the range.
- `reset_stats() -> Result<(), String>` — overwrite with empty file; emit `stats-updated`.

`StatsState(Mutex<StatsFile>)` in `src-tauri/src/state.rs`. Lazy-loaded on first command.

## main.ts hooks

The transitions that already exist in `src/main.ts` are the only places that need to call into stats:

| Transition | What to log |
|---|---|
| `startTimer()` (and stopwatch start) | Open new event (or new interval of same session if resuming after pause). |
| `pauseTimer()` | Close current event with `pause`. |
| `setPhase(p)` (manual tab switch) | Close current event with `switch`. |
| `setPhaseInternal(p)` (auto transition after natural end) | Close current event with `natural`. The new phase event opens when the user (or auto-start) starts it. |
| `handlePhaseEnd()` skip path | Close with `skip`. |
| `startSnooze()` | Close current event with `switch`, open snooze event. |
| App startup `loadState()` resume | Close any dangling open event with `app_close`. If resuming, open a new event with new `session_id`. |
| Tauri `ExitRequested` | Close any dangling open event with `app_close`. |

A small `src/shared/stats.ts` module centralises this: `openEvent(phase, configuredSeconds)`, `closeOpenEvent(reason)`, `closeAndOpenNew(reason, newPhase, configuredSeconds)`. Each call invokes the right IPC command.

## Settings impact

- `idle_gap_cap_minutes` added in both schema.ts and settings.rs as described.
- Existing `settings-reset` flow is unchanged. Stats are *not* wiped on settings reset. The Dashboard has its own explicit "Clear stats" button for that.
- The `settings.html` window entry is unchanged file-wise; its boot path now goes through `router.ts`.

## Migration / first run

- On first launch after upgrade, `stats.json` does not exist. The loader treats this as `{ version: 1, events: [] }`.
- No backfill: history starts when the feature ships.

## Testing notes

- Pure rollup functions (`todayTotals`, `sevenDayRollup`, `idleMinutes`) are testable with no Tauri context. Add unit tests under `src/views/dashboard/__tests__/rollup.test.ts` (matches existing project test style if any; otherwise none).
- Manual: switch phases, pause mid-phase, force-quit the app, restart — verify event log shape and that idle never includes a > cap gap.

## Out of scope, explicitly

- Backfill / import from outside.
- Notifications based on stats ("you have been idle too long").
- Goals / streaks.
- Per-session tagging.
- Time zone changes mid-day (we treat "today" as local-time day from `Date.now()`).
