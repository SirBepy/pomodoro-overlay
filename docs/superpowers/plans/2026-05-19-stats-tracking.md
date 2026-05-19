# Stats tracking + Dashboard window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record where every minute goes (focus / short / long / stopwatch / snooze / idle) and surface today + 7-day patterns in a new Dashboard view that becomes the primary entry point to the secondary window. Adds a 4th "Other" stopwatch phase. Settings UI moves under a tab inside the same window.

**Architecture:** Append-only event log persisted to a new Rust-managed `stats.json` next to `settings.json`. Each event = a continuous active interval of one phase with a `session_id` shared across pause/resume intervals. Frontend emits IPC calls on every existing phase transition in `main.ts`. The existing `settings.html` window is restructured into a hash-routed window (`#dashboard` default, `#settings` for existing UI). Tray menu becomes `Pause/Start | Dashboard | Quit`.

**Tech Stack:** Tauri 2.x, Rust (serde + serde_json + uuid), TypeScript (lit-html), vite, vitest (if absent, plain node tests). No new chart library — hand-rolled flex bars.

---

## File map

**Create**
- `src-tauri/src/stats.rs` — `StatsEvent`, `StatsFile`, `StatsState`, load/save/append/range/close-open/reset
- `src-tauri/src/ipc/stats.rs` — Tauri command wrappers around `stats.rs`
- `src/shared/stats.ts` — frontend IPC client (`openEvent`, `closeOpenEvent`, `closeAndOpenNew`, `getRange`, `resetStats`)
- `src/views/window/router.ts` — hash router that mounts dashboard or settings
- `src/views/window/tabs.ts` — top tab bar render
- `src/views/dashboard/dashboard.ts` — top-level view (wires sub-views + live updates)
- `src/views/dashboard/today.ts` — today totals card
- `src/views/dashboard/idle.ts` — idle today + 7-day avg card
- `src/views/dashboard/chart.ts` — 7-day stacked bar chart
- `src/views/dashboard/rollup.ts` — pure rollup functions
- `src/views/dashboard/phase-colors.ts` — phase color constants
- `src/views/dashboard/__tests__/rollup.test.ts` — unit tests
- `src/styles/dashboard.css` — dashboard-only styles
- `docs/superpowers/plans/2026-05-19-stats-tracking.md` — this file

**Modify**
- `src-tauri/Cargo.toml` — add `uuid` dependency
- `src-tauri/src/lib.rs` — wire `stats` module, register commands, change tray menu, add `RunEvent::ExitRequested` handler, update `open_settings_window` callers
- `src-tauri/src/ipc.rs` — declare `stats` submodule
- `src-tauri/src/ipc/commands.rs` — generalise `open_settings_window` to accept a `route` hash
- `src-tauri/src/settings.rs` — add `idle_gap_cap_minutes` field + Default
- `src/views/settings/schema.ts` — add `idle_gap_cap_minutes` setting (System section)
- `src/views/settings/settings.ts` — export `mountSettings(root)` instead of running on load; the new router calls it
- `src/settings.html` — load `views/window/router.ts` instead of `views/settings/settings.ts`
- `src/index.html` — add 4th tab `Other`
- `src/main.ts` — `PHASE_OTHER` constant, stopwatch tick, save/load math, wire stats hooks at every phase transition

---

## Pre-flight: branch + worktree

If using subagent-driven execution, the worktree should already be set up. Otherwise create a branch:

```powershell
git -C C:\Users\tecno\Desktop\Projects\pomodoro-overlay checkout -b feat/stats-dashboard
```

---

## Task 1: Add `idle_gap_cap_minutes` setting

**Files:**
- Modify: `src-tauri/src/settings.rs:1-73`
- Modify: `src/views/settings/schema.ts` (System section group)

- [ ] **Step 1: Add field to Rust struct**

In `src-tauri/src/settings.rs`, inside the `Settings` struct (after `keybind_skip`):

```rust
pub keybind_skip: Option<String>,
pub idle_gap_cap_minutes: u32,
#[serde(flatten)]
pub kit: KitSettings,
```

And in `impl Default for Settings`:

```rust
keybind_pause: None,
keybind_skip: None,
idle_gap_cap_minutes: 240,
kit: KitSettings::default(),
```

- [ ] **Step 2: Add field to schema.ts**

Open `src/views/settings/schema.ts`. Find the System section (search for a section titled "System" near the end, before `systemInline`). Add a new field:

```ts
{
  key: "idle_gap_cap_minutes",
  kind: "integer",
  label: "Idle gap cap (minutes)",
  min: 30,
  max: 1440,
  tooltip:
    "Gaps between recorded activity longer than this are dropped from idle stats. Default 240 (4h) excludes sleep.",
},
```

If the System section doesn't already exist as a section, add the field to the most appropriate existing section (likely the bottom of "Behavior" or wherever System-ish settings live). The field key MUST match the Rust struct field name exactly.

- [ ] **Step 3: Verify Rust compiles**

Run from project root:

```powershell
cd src-tauri
cargo check
cd ..
```

Expected: clean compile.

- [ ] **Step 4: Verify TS builds**

```powershell
npm run build
```

Expected: clean build.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/settings.rs src/views/settings/schema.ts
git commit -m "FEAT: add idle_gap_cap_minutes setting"
```

---

## Task 2: Add uuid dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add uuid to dependencies**

Open `src-tauri/Cargo.toml`. In the `[dependencies]` section, add:

```toml
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 2: Run cargo check**

```powershell
cd src-tauri
cargo check
cd ..
```

Expected: downloads + compiles `uuid` crate. Clean.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "CHORE: add uuid crate"
```

---

## Task 3: Rust stats module (types + IO)

**Files:**
- Create: `src-tauri/src/stats.rs`
- Modify: `src-tauri/src/lib.rs:1-5` (declare `mod stats`)

- [ ] **Step 1: Create `src-tauri/src/stats.rs`**

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const STATS_FILENAME: &str = "stats.json";
const CURRENT_VERSION: u32 = 1;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct StatsEvent {
    pub session_id: String,
    pub phase: String,                       // "work" | "short" | "long" | "other" | "snooze"
    pub start_ms: i64,
    pub end_ms: Option<i64>,
    pub configured_seconds: Option<u32>,
    pub ended_by: Option<String>,            // "natural" | "pause" | "skip" | "switch" | "app_close"
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct StatsFile {
    pub version: u32,
    pub events: Vec<StatsEvent>,
}

impl Default for StatsFile {
    fn default() -> Self {
        Self { version: CURRENT_VERSION, events: Vec::new() }
    }
}

pub struct StatsState(pub Mutex<StatsFile>);

fn stats_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir.join(STATS_FILENAME))
}

pub fn load(app: &AppHandle) -> StatsFile {
    let path = match stats_path(app) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("stats: path error: {e}");
            return StatsFile::default();
        }
    };
    if !path.exists() {
        return StatsFile::default();
    }
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<StatsFile>(&bytes).unwrap_or_else(|e| {
            log::warn!("stats: parse failed, starting empty: {e}");
            StatsFile::default()
        }),
        Err(e) => {
            log::warn!("stats: read failed: {e}");
            StatsFile::default()
        }
    }
}

pub fn persist(app: &AppHandle, file: &StatsFile) -> Result<(), String> {
    let path = stats_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(file).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}
```

- [ ] **Step 2: Declare module in `src-tauri/src/lib.rs`**

At the top of `src-tauri/src/lib.rs`, after `mod settings;`:

```rust
mod hotkeys;
mod ipc;
mod settings;
mod state;
mod stats;
```

- [ ] **Step 3: cargo check**

```powershell
cd src-tauri
cargo check
cd ..
```

Expected: clean.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/stats.rs src-tauri/src/lib.rs
git commit -m "FEAT: stats module skeleton (types + load/persist)"
```

---

## Task 4: Stats mutation helpers (append / close / reset / range)

**Files:**
- Modify: `src-tauri/src/stats.rs` (add functions below the persist function)

- [ ] **Step 1: Append, close-open, range, reset**

Append to `src-tauri/src/stats.rs`:

```rust
pub fn append(app: &AppHandle, mut event: StatsEvent) -> Result<(), String> {
    if event.session_id.is_empty() {
        event.session_id = uuid::Uuid::new_v4().to_string();
    }
    let state = app.state::<StatsState>();
    let mut file = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    file.events.push(event);
    persist(app, &file)
}

pub fn close_open(app: &AppHandle, end_ms: i64, ended_by: String) -> Result<(), String> {
    let state = app.state::<StatsState>();
    let mut file = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(last) = file.events.last_mut() {
        if last.end_ms.is_none() {
            last.end_ms = Some(end_ms.max(last.start_ms));
            last.ended_by = Some(ended_by);
        }
    }
    persist(app, &file)
}

pub fn range(app: &AppHandle, start_ms: i64, end_ms: i64) -> Result<Vec<StatsEvent>, String> {
    let state = app.state::<StatsState>();
    let file = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    let mut out = Vec::new();
    for e in &file.events {
        let e_end = e.end_ms.unwrap_or(end_ms);
        if e_end >= start_ms && e.start_ms <= end_ms {
            out.push(e.clone());
        }
    }
    Ok(out)
}

pub fn reset(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<StatsState>();
    let mut file = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    *file = StatsFile::default();
    persist(app, &file)
}

pub fn close_open_on_startup(app: &AppHandle, fallback_end_ms: i64) {
    let state = app.state::<StatsState>();
    let mut file = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(last) = file.events.last_mut() {
        if last.end_ms.is_none() {
            last.end_ms = Some(fallback_end_ms.max(last.start_ms));
            last.ended_by = Some("app_close".into());
            log::info!("stats: closed dangling open event on startup");
        }
    }
    let _ = persist(app, &file);
}
```

- [ ] **Step 2: cargo check**

```powershell
cd src-tauri
cargo check
cd ..
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/stats.rs
git commit -m "FEAT: stats append/close/range/reset helpers"
```

---

## Task 5: Stats IPC commands

**Files:**
- Create: `src-tauri/src/ipc/stats.rs`
- Modify: `src-tauri/src/ipc.rs` (declare module)
- Modify: `src-tauri/src/lib.rs` (register commands in invoke_handler, manage StatsState, load on setup)

- [ ] **Step 1: Create `src-tauri/src/ipc/stats.rs`**

```rust
use tauri::{AppHandle, Emitter};

use crate::stats::{self, StatsEvent};

#[tauri::command]
pub fn append_stats_event(app: AppHandle, event: StatsEvent) -> Result<(), String> {
    stats::append(&app, event)?;
    let _ = app.emit("stats-updated", ());
    Ok(())
}

#[tauri::command]
pub fn close_open_stats_event(
    app: AppHandle,
    end_ms: i64,
    ended_by: String,
) -> Result<(), String> {
    stats::close_open(&app, end_ms, ended_by)?;
    let _ = app.emit("stats-updated", ());
    Ok(())
}

#[tauri::command]
pub fn get_stats_range(
    app: AppHandle,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<StatsEvent>, String> {
    stats::range(&app, start_ms, end_ms)
}

#[tauri::command]
pub fn reset_stats(app: AppHandle) -> Result<(), String> {
    stats::reset(&app)?;
    let _ = app.emit("stats-updated", ());
    Ok(())
}
```

- [ ] **Step 2: Declare submodule in `src-tauri/src/ipc.rs`**

```rust
pub mod commands;
pub mod dnd;
pub mod stats;
```

- [ ] **Step 3: Register in `src-tauri/src/lib.rs`**

In `src-tauri/src/lib.rs`, add to the `use ipc::...` block:

```rust
use ipc::dnd::{disable_dnd, enable_dnd};
use ipc::stats::{
    append_stats_event, close_open_stats_event, get_stats_range, reset_stats,
};
```

Add `StatsState` import after `use state::...`:

```rust
use state::{DndState, PausedSessionsState, TrayPlayPauseItem};
use stats::StatsState;
```

In the `setup` closure (around line 160-175 where other states are managed) add:

```rust
handle.manage(SettingsState(Mutex::new(settings)));
handle.manage(PausedSessionsState(std::sync::Mutex::new(Vec::new())));
handle.manage(DndState(std::sync::Mutex::new(None)));
handle.manage(StatsState(std::sync::Mutex::new(stats::load(&handle))));

let now_ms = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0);
stats::close_open_on_startup(&handle, now_ms);
```

In the `invoke_handler` macro list, add the four new commands at the end:

```rust
set_tray_running,
append_stats_event,
close_open_stats_event,
get_stats_range,
reset_stats,
```

- [ ] **Step 4: cargo check**

```powershell
cd src-tauri
cargo check
cd ..
```

Expected: clean.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/ipc/stats.rs src-tauri/src/ipc.rs src-tauri/src/lib.rs
git commit -m "FEAT: stats IPC commands wired"
```

---

## Task 6: Frontend stats client

**Files:**
- Create: `src/shared/stats.ts`

- [ ] **Step 1: Create `src/shared/stats.ts`**

```ts
// @ts-nocheck
const { invoke } = window.__TAURI__.core;

export type Phase = "work" | "short" | "long" | "other" | "snooze";
export type EndedBy = "natural" | "pause" | "skip" | "switch" | "app_close";

export interface StatsEvent {
  session_id: string;
  phase: Phase;
  start_ms: number;
  end_ms: number | null;
  configured_seconds: number | null;
  ended_by: EndedBy | null;
}

let currentSessionId: string | null = null;
let currentPhase: Phase | null = null;
let openEventStartMs: number | null = null;

function uuid(): string {
  // crypto.randomUUID is available in Tauri 2.x webview
  return crypto.randomUUID();
}

function nowMs(): number {
  return Date.now();
}

/**
 * Open a new event. If the same phase is being resumed after a pause, pass
 * resumeSession=true so the new interval shares the existing session_id.
 */
export async function openEvent(
  phase: Phase,
  configuredSeconds: number | null,
  resumeSession = false,
): Promise<void> {
  if (!resumeSession || !currentSessionId || currentPhase !== phase) {
    currentSessionId = uuid();
  }
  currentPhase = phase;
  openEventStartMs = nowMs();
  const event: StatsEvent = {
    session_id: currentSessionId,
    phase,
    start_ms: openEventStartMs,
    end_ms: null,
    configured_seconds: configuredSeconds,
    ended_by: null,
  };
  try {
    await invoke("append_stats_event", { event });
  } catch (e) {
    console.warn("stats: append failed", e);
  }
}

/**
 * Close the currently open event. Pass the reason; if "switch" or "skip" or
 * "natural" the session is over and the next openEvent will mint a new
 * session_id. "pause" keeps the session_id so the next openEvent with
 * resumeSession=true continues it.
 */
export async function closeOpenEvent(endedBy: EndedBy): Promise<void> {
  if (openEventStartMs === null) return;
  openEventStartMs = null;
  if (endedBy !== "pause") {
    currentSessionId = null;
    currentPhase = null;
  }
  try {
    await invoke("close_open_stats_event", {
      endMs: nowMs(),
      endedBy,
    });
  } catch (e) {
    console.warn("stats: close failed", e);
  }
}

export async function getRange(
  startMs: number,
  endMs: number,
): Promise<StatsEvent[]> {
  try {
    return await invoke("get_stats_range", { startMs, endMs });
  } catch (e) {
    console.warn("stats: range failed", e);
    return [];
  }
}

export async function resetStats(): Promise<void> {
  await invoke("reset_stats");
  currentSessionId = null;
  currentPhase = null;
  openEventStartMs = null;
}
```

- [ ] **Step 2: TS build**

```powershell
npm run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/shared/stats.ts
git commit -m "FEAT: frontend stats IPC client"
```

---

## Task 7: Add PHASE_OTHER tab to overlay

**Files:**
- Modify: `src/index.html` (add tab)
- Modify: `src/styles/base.css` (no functional CSS needed yet; just ensure the new tab inherits existing `.tab-btn` styles — verify in dev)

- [ ] **Step 1: Add 4th tab**

In `src/index.html`, update the `.phase-tabs` block (currently lines 24-28):

```html
<div class="phase-tabs">
  <button class="tab-btn active" data-phase="work">Focus</button>
  <button class="tab-btn" data-phase="short">Break</button>
  <button class="tab-btn" data-phase="long">Big Break</button>
  <button class="tab-btn" data-phase="other">Other</button>
</div>
```

- [ ] **Step 2: Dev sanity check**

```powershell
npm run tauri dev
```

Click the new "Other" tab. The CSS class for `phase-other` isn't styled yet — the timer should still show `25:00` (stopwatch tick not yet wired). The tab should become active (highlighted) and switching back to Focus should work. No console errors.

Close dev server (Ctrl-C).

- [ ] **Step 3: Commit**

```powershell
git add src/index.html
git commit -m "FEAT: add 'Other' phase tab"
```

---

## Task 8: PHASE_OTHER constant + stopwatch tick in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add constant + helpers**

Open `src/main.ts`. Near the top with the other phase constants (around line 33-35):

```ts
const PHASE_WORK = "work";
const PHASE_SHORT = "short";
const PHASE_LONG = "long";
const PHASE_OTHER = "other";
```

- [ ] **Step 2: Update `phaseDuration`**

Replace the existing `phaseDuration` function (around lines 80-86) with:

```ts
function phaseDuration(p) {
  if (!settings) return 25 * 60;
  if (p === PHASE_SNOOZE) return SNOOZE_DURATION;
  if (p === PHASE_SHORT) return settings.short_break_minutes * 60;
  if (p === PHASE_LONG) return settings.long_break_minutes * 60;
  if (p === PHASE_OTHER) return 0; // stopwatch starts at 0 and counts up
  return settings.work_minutes * 60;
}
```

- [ ] **Step 3: Update `fmt` to support long durations**

Replace the existing `fmt` function (around lines 97-104):

```ts
function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}
```

- [ ] **Step 4: Update `applyPhaseClass`**

Find `applyPhaseClass` (around line 88-95). Add `phase-other` to the remove list:

```ts
function applyPhaseClass() {
  const c = $("app");
  c.classList.remove("phase-work", "phase-short", "phase-long", "phase-snooze", "phase-other");
  c.classList.add(`phase-${phase}`);
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.phase === phase);
  });
}
```

- [ ] **Step 5: Update `tick()` to count up for stopwatch**

Replace `tick()` (around lines 187-194):

```ts
function tick() {
  if (phase === PHASE_OTHER) {
    remainingSec += 1; // stopwatch: count up
    render();
    return;
  }
  remainingSec -= 1;
  if (remainingSec <= 0) {
    handlePhaseEnd(true).catch((e) => console.warn("handlePhaseEnd error", e));
    return;
  }
  render();
}
```

- [ ] **Step 6: Update `loadState()` resume math for stopwatch**

Replace `loadState()` (around lines 56-76):

```ts
function loadState() {
  if (settings?.reset_on_restart) return false;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    phase = s.phase ?? phase;
    if (phase === PHASE_SNOOZE) { phase = PHASE_WORK; return false; }
    workSessionsCompleted = s.workSessionsCompleted ?? 0;
    const elapsed = s.running ? Math.floor((Date.now() - s.savedAt) / 1000) : 0;
    if (phase === PHASE_OTHER) {
      // Stopwatch: stored remainingSec holds elapsed seconds; add wall-time elapsed.
      remainingSec = Math.max(0, (s.remainingSec ?? 0) + elapsed);
      return !!s.running;
    }
    remainingSec = Math.max(0, (s.remainingSec ?? phaseDuration(phase)) - elapsed);
    if (remainingSec <= 10) {
      remainingSec = phaseDuration(phase);
      return false;
    }
    return !!s.running && remainingSec > 0;
  } catch (e) {
    console.warn("loadState failed", e);
    return false;
  }
}
```

- [ ] **Step 7: Skip music pause / DnD / fullscreen for PHASE_OTHER**

In `startTimer()` (around lines 196-220), the existing music + DnD blocks only act on `PHASE_WORK | PHASE_SHORT | PHASE_LONG`. They naturally skip `PHASE_OTHER` because none of the existing conditions match it. No change needed — verify by reading the function and confirming no branch fires for `PHASE_OTHER`.

In `handlePhaseEnd()` (around lines 252-291): when `ended === PHASE_OTHER`, this should NOT advance work-session counter or trigger break logic. Update the function:

```ts
async function handlePhaseEnd(natural = false) {
  pauseTimer();
  if (natural) playSound().catch(() => {});
  const ended = phase;

  if (ended === PHASE_SNOOZE) {
    const next = fsState.pendingBreakPhase ?? PHASE_SHORT;
    fsState.pendingBreakPhase = null;
    setPhaseInternal(next);
    invoke("show_main_window").catch(() => {});
    await enterOverlayFullscreen();
    renderSnoozeButton();
    if (settings.auto_start_break) await startTimer();
    return;
  }

  if (ended === PHASE_OTHER) {
    // Stopwatch ended manually (skip). Just return to work, do not auto-start.
    setPhaseInternal(PHASE_WORK);
    return;
  }

  let next;
  if (ended === PHASE_WORK) {
    workSessionsCompleted += 1;
    const isLong =
      workSessionsCompleted % settings.sessions_before_long_break === 0;
    next = isLong ? PHASE_LONG : PHASE_SHORT;
  } else {
    next = PHASE_WORK;
  }
  setPhaseInternal(next);
  invoke("show_main_window").catch(() => {});

  if (ended === PHASE_WORK && settings.fullscreen_on_focus_end) {
    await enterOverlayFullscreen();
    if (settings.auto_start_break) await startTimer();
  } else {
    if (ended !== PHASE_WORK && fsState.isOverlayFullscreen) {
      await exitOverlayFullscreen();
    }
    const shouldAutoStart =
      next === PHASE_WORK ? settings.auto_start_work : settings.auto_start_break;
    if (shouldAutoStart) await startTimer();
  }
}
```

- [ ] **Step 8: Manual smoke test**

```powershell
npm run tauri dev
```

Click "Other" tab. Timer shows `00:00`. Click START. Timer counts up `00:01`, `00:02`, ... Click pause, resume, verify it continues from where it left off. Click skip — timer returns to Focus phase. Click Focus, START, verify normal 25:00 countdown still works.

Close dev server.

- [ ] **Step 9: Commit**

```powershell
git add src/main.ts
git commit -m "FEAT: stopwatch phase tick/format/resume logic"
```

---

## Task 9: Wire stats logging into main.ts transitions

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Import stats client**

At the top of `src/main.ts`, add an import:

```ts
import { openEvent, closeOpenEvent } from "./shared/stats";
```

- [ ] **Step 2: Hook `startTimer`**

In `startTimer()`, just before `running = true;`:

```ts
async function startTimer() {
  if (running) return;
  if (phase === PHASE_WORK && fsState.isOverlayFullscreen) {
    exitOverlayFullscreen();
  }
  const pmob = settings?.pause_music_on_break;
  if (pmob === "on_break" || pmob === "not_running_focused") {
    if (phase === PHASE_WORK && musicPausedByApp) {
      invoke("media_resume").catch(() => {});
      musicPausedByApp = false;
    } else if ((phase === PHASE_SHORT || phase === PHASE_LONG) && !musicPausedByApp) {
      const paused = await invoke("media_pause_if_playing").catch(() => false);
      if (paused) musicPausedByApp = true;
    }
  }
  if (settings?.dnd_on_focus && phase === PHASE_WORK && !dndEnabledByApp) {
    invoke("enable_dnd").catch(() => {});
    dndEnabledByApp = true;
  }
  // Stats: open event. If we're resuming after a pause (same phase still set),
  // share the existing session_id.
  const configured = phase === PHASE_OTHER ? null : phaseDuration(phase);
  await openEvent(phase, configured, /* resumeSession */ true);
  running = true;
  tickHandle = setInterval(tick, 1000);
  invoke("set_tray_running", { running: true }).catch(() => {});
  syncClickThrough();
  render();
}
```

- [ ] **Step 3: Hook `pauseTimer`**

In `pauseTimer()`:

```ts
function pauseTimer() {
  if (!running) {
    // nothing to close
    running = false;
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    return;
  }
  running = false;
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  closeOpenEvent("pause").catch(() => {});
  if (dndEnabledByApp) {
    invoke("disable_dnd").catch(() => {});
    dndEnabledByApp = false;
  }
  if (settings?.pause_music_on_break === "not_running_focused" && phase === PHASE_WORK && !musicPausedByApp) {
    invoke("media_pause_if_playing").then((paused) => { if (paused) musicPausedByApp = true; }).catch(() => {});
  }
  invoke("set_tray_running", { running: false }).catch(() => {});
  syncClickThrough();
  render();
}
```

- [ ] **Step 4: Hook `setPhase` (manual tab switch)**

In `setPhase(p)`:

```ts
function setPhase(p) {
  if (fsState.snoozeHandle) {
    clearInterval(fsState.snoozeHandle);
    fsState.snoozeHandle = null;
    fsState.pendingBreakPhase = null;
  }
  if (running) closeOpenEvent("switch").catch(() => {});
  pauseTimer();
  phase = p;
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
}
```

Note: `pauseTimer` will also try to close — but the second call is a no-op because `openEventStartMs` is null after the first close.

- [ ] **Step 5: Hook `handlePhaseEnd` natural + skip paths**

In `handlePhaseEnd(natural = false)`, just after `pauseTimer()`:

```ts
async function handlePhaseEnd(natural = false) {
  if (running) {
    await closeOpenEvent(natural ? "natural" : "skip");
  }
  pauseTimer();
  if (natural) playSound().catch(() => {});
  const ended = phase;
  // ... rest unchanged
```

Remove the auto-close that `pauseTimer` does in this path so it doesn't double-close. Since `closeOpenEvent` is idempotent (no-op if no open event), this is safe.

- [ ] **Step 6: Hook `setPhaseInternal`**

`setPhaseInternal` is the auto-transition (e.g. after natural end → next phase). The event for the OLD phase was already closed in step 5. The NEW phase event opens only when `startTimer` is called. So no extra hook needed inside `setPhaseInternal`. Verify by reading the function.

- [ ] **Step 7: Verify snooze flow needs no extra fullscreen.ts hooks**

Read `src/shared/fullscreen.ts:51-60` (`startSnooze`). It calls `_host.setPhase(PHASE_SNOOZE)` then `_host.startTimer()`. With the hooks added above:

- `setPhase(PHASE_SNOOZE)` closes the prior phase event with `"switch"` (Step 4).
- `startTimer()` opens a new event with `phase = "snooze"`, `configured_seconds = SNOOZE_DURATION` (Step 2).
- When snooze ticks down to 0, `handlePhaseEnd(true)` runs and closes the snooze event with `"natural"` (Step 5).

No edits in `fullscreen.ts` needed. Confirm by reading the file. If the implementer finds a flow the current hooks miss (e.g. cancelling snooze via a tab click), `setPhase` also closes the snooze event with `"switch"` — covered.

- [ ] **Step 8: Manual smoke test**

```powershell
npm run tauri dev
```

In a separate terminal, watch the stats file (Windows):

```powershell
Get-Content "$env:APPDATA\com.bepy.pomodoro-overlay\stats.json" -Wait
```

(Adjust the app-config dir name if different — check what Tauri logs on startup, or search for `app_config_dir` output.)

Click Focus → Start → wait 5s → Pause. Observe an event with `ended_by: "pause"`.
Click Start → wait 5s → switch to Short → observe `ended_by: "switch"` on the resumed work event.
Let a short break run to 0 → observe `ended_by: "natural"`.
Click Skip mid-phase → observe `ended_by: "skip"`.
Click Other → Start → wait 5s → Skip → observe stopwatch event with `configured_seconds: null`.

Close dev server.

- [ ] **Step 9: Commit**

```powershell
git add src/main.ts
git commit -m "FEAT: emit stats events on every phase transition"
```

---

## Task 10: ExitRequested handler — close dangling event on quit

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace `.run(...)` block with a run_handler**

In `src-tauri/src/lib.rs`, find the end of the builder chain:

```rust
.run(tauri::generate_context!())
.expect("error while running tauri application");
```

Replace with:

```rust
.build(tauri::generate_context!())
.expect("error while building tauri application")
.run(|app, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        stats::close_open_on_startup(app, now_ms);
    }
});
```

(`close_open_on_startup` is being reused — it closes any open event, which is exactly what we want here too. If you prefer a clearer name, rename to `close_open_with` with a reason parameter, and call with `"app_close"`. Either works.)

- [ ] **Step 2: cargo check + dev run**

```powershell
cd src-tauri
cargo check
cd ..
npm run tauri dev
```

Start the focus timer, then close the app via tray > Quit. Restart, inspect `stats.json` — the previously-open event should have `end_ms` and `ended_by: "app_close"`.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "FEAT: close dangling stats event on quit"
```

---

## Task 11: Tray menu — Dashboard replaces Settings; route param on open_settings_window

**Files:**
- Modify: `src-tauri/src/ipc/commands.rs` (generalise `open_settings_window`)
- Modify: `src-tauri/src/lib.rs` (tray menu items, on_menu_event handler, settings.html URL)

- [ ] **Step 1: Accept a route hash in `open_settings_window`**

In `src-tauri/src/ipc/commands.rs`, replace the existing `open_settings_window`:

```rust
#[tauri::command]
pub fn open_settings_window(app: AppHandle, route: Option<String>) -> Result<(), String> {
    let hash = route.unwrap_or_else(|| "dashboard".into());
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.eval(&format!("window.location.hash = '{hash}'"));
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url = format!("settings.html#{hash}");
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url.into()))
        .title("Pomodoro Overlay")
        .inner_size(440.0, 600.0)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Update tray menu in `src-tauri/src/lib.rs`**

In `build_tray` (around lines 78-141), replace the menu construction:

```rust
fn build_tray(app: &AppHandle) -> tauri::Result<MenuItem<tauri::Wry>> {
    let play_pause = MenuItem::with_id(app, "play_pause", "Start", true, None::<&str>)?;
    let sep_top = PredefinedMenuItem::separator(app)?;
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&play_pause, &sep_top, &dashboard_item, &sep, &quit],
    )?;
    // ... icon + builder unchanged
```

In the `on_menu_event` block:

```rust
.on_menu_event(|app, event| match event.id.as_ref() {
    "dashboard" => {
        let _ = open_settings_window(app.clone(), Some("dashboard".into()));
    }
    "play_pause" => {
        let _ = app.emit("tray-toggle-play", ());
    }
    "quit" => {
        app.exit(0);
    }
    _ => {}
})
```

- [ ] **Step 3: Update the in-setup auto-open caller (if any)**

Find every other caller of `open_settings_window(...)` in `src-tauri/src/`. The only one (per current code) is the menu handler. If any other call exists, pass `None` to land on the dashboard:

```rust
open_settings_window(app.clone(), None)
```

- [ ] **Step 4: cargo check + dev run**

```powershell
cd src-tauri
cargo check
cd ..
npm run tauri dev
```

Right-click the tray icon: menu should show `Start (or Pause) | Dashboard | Quit`. Click Dashboard — secondary window opens (still rendering the old settings UI for now; that's fixed in Task 12). URL hash should be `#dashboard`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
git commit -m "FEAT: tray menu = Pause/Dashboard/Quit; route-aware settings window"
```

---

## Task 12: Window router + tabs

**Files:**
- Create: `src/views/window/router.ts`
- Create: `src/views/window/tabs.ts`
- Modify: `src/settings.html` (load router instead of settings)
- Modify: `src/views/settings/settings.ts` (export `mountSettings`)

- [ ] **Step 1: Convert `views/settings/settings.ts` to export-only**

Replace the entire contents of `src/views/settings/settings.ts` with:

```ts
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../../vendor/tauri_kit/frontend/settings/styles.css";
import { renderSettingsPage } from "../../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema, systemInline } from "./schema";

export function mountSettings(root: HTMLElement) {
  renderSettingsPage(root, {
    schema: settingsSchema,
    systemInline,
    dangerActions: [],
    about: {},
  });
}
```

- [ ] **Step 2: Create `src/views/window/tabs.ts`**

```ts
export type RouteName = "dashboard" | "settings";

export function renderTabs(container: HTMLElement, active: RouteName, onSelect: (r: RouteName) => void) {
  container.innerHTML = `
    <div class="window-tabs">
      <button class="window-tab" data-route="dashboard">Dashboard</button>
      <button class="window-tab" data-route="settings">Settings</button>
    </div>
  `;
  container.querySelectorAll<HTMLButtonElement>(".window-tab").forEach((btn) => {
    const route = btn.dataset.route as RouteName;
    btn.classList.toggle("active", route === active);
    btn.addEventListener("click", () => onSelect(route));
  });
}
```

- [ ] **Step 3: Create `src/views/window/router.ts`**

```ts
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../styles/dashboard.css";
import { mountSettings } from "../settings/settings";
import { mountDashboard } from "../dashboard/dashboard";
import { renderTabs, RouteName } from "./tabs";

const root = document.getElementById("root");
if (!root) throw new Error("window root missing");

root.innerHTML = `
  <div id="window-tabs"></div>
  <div id="window-body"></div>
`;
const tabsEl = root.querySelector<HTMLElement>("#window-tabs")!;
const bodyEl = root.querySelector<HTMLElement>("#window-body")!;

function currentRoute(): RouteName {
  const h = (location.hash || "#dashboard").replace(/^#/, "");
  return h === "settings" ? "settings" : "dashboard";
}

function mount() {
  const route = currentRoute();
  renderTabs(tabsEl, route, (next) => {
    location.hash = `#${next}`;
  });
  bodyEl.innerHTML = "";
  if (route === "dashboard") mountDashboard(bodyEl);
  else mountSettings(bodyEl);
}

window.addEventListener("hashchange", mount);
mount();
```

- [ ] **Step 4: Stub `mountDashboard`**

Create `src/views/dashboard/dashboard.ts` with a placeholder so the router compiles:

```ts
export function mountDashboard(root: HTMLElement) {
  root.innerHTML = `<div style="padding:24px"><h1>Dashboard</h1><p>Coming soon.</p></div>`;
}
```

- [ ] **Step 5: Create `src/styles/dashboard.css` (placeholder)**

```css
.window-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.window-tab {
  background: transparent;
  border: none;
  color: inherit;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 4px;
}
.window-tab.active {
  background: rgba(255, 255, 255, 0.08);
  font-weight: 600;
}
```

- [ ] **Step 6: Point `settings.html` at the router**

In `src/settings.html`, replace the script tag:

```html
<script type="module" src="./views/window/router.ts"></script>
```

- [ ] **Step 7: TS build + dev run**

```powershell
npm run build
npm run tauri dev
```

Open the dashboard from the tray. You should see a two-tab bar at top with "Dashboard" active and a placeholder "Coming soon." Click "Settings" — the existing settings UI mounts. Click "Dashboard" — back to placeholder. URL hash updates on each switch.

- [ ] **Step 8: Commit**

```powershell
git add src/views/window/router.ts src/views/window/tabs.ts src/views/settings/settings.ts src/views/dashboard/dashboard.ts src/styles/dashboard.css src/settings.html
git commit -m "FEAT: hash-routed window with Dashboard + Settings tabs"
```

---

## Task 13: Dashboard rollup functions + tests

**Files:**
- Create: `src/views/dashboard/rollup.ts`
- Create: `src/views/dashboard/__tests__/rollup.test.ts`
- Modify: `package.json` (add vitest if absent)

- [ ] **Step 1: Check if vitest is configured**

Search `package.json` for `"test"` and `"vitest"`. If absent:

```powershell
npm install -D vitest
```

And add a script:

```json
"scripts": {
  "test": "vitest run"
}
```

- [ ] **Step 2: Create `src/views/dashboard/rollup.ts`**

```ts
import type { StatsEvent, Phase } from "../../shared/stats";

export interface DayTotals {
  work_ms: number;
  short_ms: number;
  long_ms: number;
  other_ms: number;
  snooze_ms: number;
  idle_ms: number;
  work_sessions_completed: number;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  return startOfDay(ts) + 24 * 60 * 60 * 1000;
}

/**
 * Sum of (end - start) per phase, clipping each event to [rangeStart, rangeEnd].
 * For events with end_ms = null, treat as ending at min(now, rangeEnd).
 */
export function phaseTotals(
  events: StatsEvent[],
  rangeStart: number,
  rangeEnd: number,
  now: number,
): Record<Phase, number> {
  const out: Record<Phase, number> = {
    work: 0, short: 0, long: 0, other: 0, snooze: 0,
  };
  for (const e of events) {
    const start = Math.max(e.start_ms, rangeStart);
    const rawEnd = e.end_ms ?? now;
    const end = Math.min(rawEnd, rangeEnd);
    if (end <= start) continue;
    out[e.phase] += end - start;
  }
  return out;
}

/**
 * Idle = wall time in [rangeStart, rangeEnd] not covered by any event,
 * EXCLUDING any gap longer than cap_minutes. Includes leading and trailing
 * gaps clipped to the range and to `now` for the trailing edge of "today".
 */
export function idleMs(
  events: StatsEvent[],
  rangeStart: number,
  rangeEnd: number,
  now: number,
  capMinutes: number,
): number {
  const capMs = capMinutes * 60 * 1000;
  const effectiveEnd = Math.min(rangeEnd, now);
  if (effectiveEnd <= rangeStart) return 0;

  // Build sorted list of [start, end] within the window.
  const intervals: Array<[number, number]> = [];
  for (const e of events) {
    const s = Math.max(e.start_ms, rangeStart);
    const rawEnd = e.end_ms ?? now;
    const en = Math.min(rawEnd, effectiveEnd);
    if (en > s) intervals.push([s, en]);
  }
  intervals.sort((a, b) => a[0] - b[0]);

  // Walk gaps.
  let cursor = rangeStart;
  let idle = 0;
  for (const [s, en] of intervals) {
    if (s > cursor) {
      const gap = s - cursor;
      if (gap <= capMs) idle += gap;
    }
    cursor = Math.max(cursor, en);
  }
  if (effectiveEnd > cursor) {
    const gap = effectiveEnd - cursor;
    if (gap <= capMs) idle += gap;
  }
  return idle;
}

export function workSessionsCompleted(events: StatsEvent[]): number {
  const completed = new Set<string>();
  for (const e of events) {
    if (e.phase === "work" && e.ended_by === "natural") {
      completed.add(e.session_id);
    }
  }
  return completed.size;
}

export function todayTotals(
  events: StatsEvent[],
  now: number,
  capMinutes: number,
): DayTotals {
  const s = startOfDay(now);
  const e = endOfDay(now);
  const pt = phaseTotals(events, s, e, now);
  return {
    work_ms: pt.work,
    short_ms: pt.short,
    long_ms: pt.long,
    other_ms: pt.other,
    snooze_ms: pt.snooze,
    idle_ms: idleMs(events, s, e, now, capMinutes),
    work_sessions_completed: workSessionsCompleted(events.filter((ev) => ev.start_ms >= s)),
  };
}

export interface DayBucket {
  date_start: number;       // local-day start
  totals: DayTotals;
}

export function sevenDayBuckets(
  events: StatsEvent[],
  now: number,
  capMinutes: number,
): DayBucket[] {
  const buckets: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDay(now - i * 24 * 60 * 60 * 1000);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const dayEvents = events.filter(
      (e) => (e.end_ms ?? now) >= dayStart && e.start_ms <= dayEnd,
    );
    const pt = phaseTotals(dayEvents, dayStart, dayEnd, now);
    buckets.push({
      date_start: dayStart,
      totals: {
        work_ms: pt.work,
        short_ms: pt.short,
        long_ms: pt.long,
        other_ms: pt.other,
        snooze_ms: pt.snooze,
        idle_ms: idleMs(dayEvents, dayStart, dayEnd, now, capMinutes),
        work_sessions_completed: workSessionsCompleted(
          dayEvents.filter((ev) => ev.start_ms >= dayStart),
        ),
      },
    });
  }
  return buckets;
}
```

- [ ] **Step 3: Create test file**

`src/views/dashboard/__tests__/rollup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  phaseTotals,
  idleMs,
  workSessionsCompleted,
  todayTotals,
  startOfDay,
} from "../rollup";
import type { StatsEvent } from "../../../shared/stats";

const ev = (
  start_ms: number,
  end_ms: number | null,
  phase: StatsEvent["phase"] = "work",
  ended_by: StatsEvent["ended_by"] = "natural",
  session_id = `s-${start_ms}`,
): StatsEvent => ({
  session_id,
  phase,
  start_ms,
  end_ms,
  configured_seconds: 1500,
  ended_by,
});

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe("phaseTotals", () => {
  it("sums durations per phase clipped to range", () => {
    const t = startOfDay(Date.now());
    const events = [
      ev(t + 9 * HOUR, t + 9 * HOUR + 25 * MIN, "work"),
      ev(t + 9 * HOUR + 25 * MIN, t + 9 * HOUR + 30 * MIN, "short"),
    ];
    const out = phaseTotals(events, t, t + 24 * HOUR, Date.now());
    expect(out.work).toBe(25 * MIN);
    expect(out.short).toBe(5 * MIN);
  });

  it("treats open events as ending at now", () => {
    const t = 1_700_000_000_000;
    const events = [ev(t, null, "work")];
    const out = phaseTotals(events, t - HOUR, t + HOUR, t + 10 * MIN);
    expect(out.work).toBe(10 * MIN);
  });
});

describe("idleMs", () => {
  it("returns the full range when there are no events", () => {
    const t = 1_700_000_000_000;
    expect(idleMs([], t, t + HOUR, t + HOUR, 240)).toBe(HOUR);
  });

  it("includes leading and trailing gaps", () => {
    const t = 1_700_000_000_000;
    const events = [ev(t + 10 * MIN, t + 20 * MIN, "work")];
    // 10m before + 40m after = 50m, both under cap
    expect(idleMs(events, t, t + HOUR, t + HOUR, 240)).toBe(50 * MIN);
  });

  it("drops gaps longer than cap", () => {
    const t = 1_700_000_000_000;
    const events = [
      ev(t, t + 5 * MIN, "work"),
      ev(t + 5 * HOUR + 5 * MIN, t + 5 * HOUR + 10 * MIN, "work"),
    ];
    // 5h gap > 4h cap → dropped. Trailing tail kept (under cap).
    const idle = idleMs(events, t, t + 6 * HOUR, t + 6 * HOUR, 240);
    expect(idle).toBe((6 * 60 - 5 - 5 - 5 * 60) * MIN); // 6h - 5m - 5m work - 5h gap excluded = 50m trailing
  });

  it("respects the cap setting (3h cap)", () => {
    const t = 1_700_000_000_000;
    const events = [
      ev(t, t + 5 * MIN, "work"),
      ev(t + 4 * HOUR, t + 4 * HOUR + 5 * MIN, "work"),
    ];
    // 4h - 5m gap > 3h cap → dropped
    const idle = idleMs(events, t, t + 5 * HOUR, t + 5 * HOUR, 180);
    expect(idle).toBeLessThan(HOUR);
  });
});

describe("workSessionsCompleted", () => {
  it("counts distinct session_ids ending naturally with phase=work", () => {
    const events = [
      ev(0, 1, "work", "natural", "a"),
      ev(2, 3, "work", "pause", "a"), // same session, not natural → counts via a
      ev(10, 11, "work", "natural", "b"),
      ev(20, 21, "short", "natural", "c"),
      ev(30, 31, "work", "skip", "d"),
    ];
    expect(workSessionsCompleted(events)).toBe(2);
  });
});

describe("todayTotals", () => {
  it("rolls up today's events", () => {
    const t = startOfDay(Date.now()) + 9 * HOUR;
    const now = t + 30 * MIN;
    const events = [
      ev(t, t + 25 * MIN, "work", "natural"),
      ev(t + 25 * MIN, t + 30 * MIN, "short", "natural"),
    ];
    const out = todayTotals(events, now, 240);
    expect(out.work_ms).toBe(25 * MIN);
    expect(out.short_ms).toBe(5 * MIN);
    expect(out.work_sessions_completed).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests**

```powershell
npm test
```

Expected: all tests pass. If any fail, fix the implementation (not the test) until they do.

- [ ] **Step 5: Commit**

```powershell
git add src/views/dashboard/rollup.ts src/views/dashboard/__tests__/rollup.test.ts package.json package-lock.json
git commit -m "FEAT: stats rollup pure functions with tests"
```

---

## Task 14: Dashboard view (today / idle / chart)

**Files:**
- Create: `src/views/dashboard/phase-colors.ts`
- Create: `src/views/dashboard/today.ts`
- Create: `src/views/dashboard/idle.ts`
- Create: `src/views/dashboard/chart.ts`
- Replace: `src/views/dashboard/dashboard.ts` (drop placeholder, wire real view)
- Modify: `src/styles/dashboard.css` (add card + chart styles)

- [ ] **Step 1: phase-colors.ts**

```ts
export const PHASE_COLORS = {
  work: "#4a9eff",
  other: "#7ec77f",
  short: "#9aa0a6",
  long: "#9aa0a6",
  snooze: "#f5a623",
  idle: "#f5a623",
};
```

- [ ] **Step 2: today.ts**

```ts
import type { DayTotals } from "./rollup";

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function renderToday(root: HTMLElement, t: DayTotals) {
  root.innerHTML = `
    <div class="card">
      <div class="card-label">TODAY</div>
      <div class="today-grid">
        <div><div class="big">${fmtMs(t.work_ms)}</div><div class="small">focus</div></div>
        <div><div class="big">${fmtMs(t.short_ms)}</div><div class="small">short</div></div>
        <div><div class="big">${fmtMs(t.long_ms)}</div><div class="small">long</div></div>
        <div><div class="big">${fmtMs(t.other_ms)}</div><div class="small">other</div></div>
        <div><div class="big">${fmtMs(t.snooze_ms)}</div><div class="small">snooze</div></div>
        <div><div class="big">${fmtMs(t.idle_ms)}</div><div class="small">idle</div></div>
      </div>
      <div class="card-footer">${t.work_sessions_completed} work session${t.work_sessions_completed === 1 ? "" : "s"} completed</div>
    </div>
  `;
}
```

- [ ] **Step 3: idle.ts**

```ts
function fmtMs(ms: number): string {
  const m = Math.round(ms / 60000);
  return `${m} min`;
}

export function renderIdle(root: HTMLElement, todayIdleMs: number, sevenDayAvgIdleMs: number, capMinutes: number) {
  root.innerHTML = `
    <div class="card idle-card">
      <div class="idle-row">
        <div>
          <div class="card-label">IDLE TODAY</div>
          <div class="big">${fmtMs(todayIdleMs)}</div>
        </div>
        <div>
          <div class="card-label">7-DAY AVG</div>
          <div class="big">${fmtMs(sevenDayAvgIdleMs)}</div>
        </div>
      </div>
      <div class="card-footer">Gaps over ${Math.round(capMinutes / 60)}h are excluded (configurable in Settings).</div>
    </div>
  `;
}
```

- [ ] **Step 4: chart.ts**

```ts
import type { DayBucket } from "./rollup";
import { PHASE_COLORS } from "./phase-colors";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${m}m`;
}

export function renderChart(root: HTMLElement, buckets: DayBucket[]) {
  // Determine max total for scaling
  let maxTotal = 0;
  for (const b of buckets) {
    const total =
      b.totals.work_ms + b.totals.other_ms +
      b.totals.short_ms + b.totals.long_ms +
      b.totals.snooze_ms + b.totals.idle_ms;
    if (total > maxTotal) maxTotal = total;
  }
  if (maxTotal === 0) maxTotal = 1;

  const bars = buckets.map((b) => {
    const work = b.totals.work_ms;
    const other = b.totals.other_ms;
    const breaks = b.totals.short_ms + b.totals.long_ms;
    const idleAndSnooze = b.totals.snooze_ms + b.totals.idle_ms;
    const day = new Date(b.date_start);
    const label = WEEKDAY[day.getDay()];
    const tooltip = [
      `${fmtMs(work)} focus`,
      `${fmtMs(other)} other`,
      `${fmtMs(breaks)} breaks`,
      `${fmtMs(idleAndSnooze)} idle/snooze`,
    ].join(" / ");
    const h = (v: number) => `${(v / maxTotal * 100).toFixed(1)}%`;
    return `
      <div class="bar-col" title="${tooltip}">
        <div class="bar-stack">
          <div class="bar-seg" style="height:${h(idleAndSnooze)};background:${PHASE_COLORS.idle}"></div>
          <div class="bar-seg" style="height:${h(breaks)};background:${PHASE_COLORS.short}"></div>
          <div class="bar-seg" style="height:${h(other)};background:${PHASE_COLORS.other}"></div>
          <div class="bar-seg" style="height:${h(work)};background:${PHASE_COLORS.work}"></div>
        </div>
        <div class="bar-label">${label}</div>
      </div>
    `;
  }).join("");

  root.innerHTML = `
    <div class="card">
      <div class="card-label">LAST 7 DAYS</div>
      <div class="chart-row">${bars}</div>
    </div>
  `;
}
```

- [ ] **Step 5: dashboard.ts (real)**

Replace `src/views/dashboard/dashboard.ts` placeholder:

```ts
// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange, resetStats } from "../../shared/stats";
import { todayTotals, sevenDayBuckets, idleMs, startOfDay, endOfDay } from "./rollup";
import { renderToday } from "./today";
import { renderIdle } from "./idle";
import { renderChart } from "./chart";

async function loadCap(): Promise<number> {
  try {
    const s = await invoke("get_settings");
    return s?.idle_gap_cap_minutes ?? 240;
  } catch {
    return 240;
  }
}

async function refresh(root: HTMLElement) {
  const cap = await loadCap();
  const now = Date.now();
  const today = await getRange(startOfDay(now), endOfDay(now));
  const week = await getRange(startOfDay(now - 6 * 24 * 60 * 60 * 1000), endOfDay(now));

  const t = todayTotals(today, now, cap);
  const buckets = sevenDayBuckets(week, now, cap);
  const weekIdleAvg =
    buckets.reduce((acc, b) => acc + b.totals.idle_ms, 0) / Math.max(1, buckets.length);

  const todayEl = root.querySelector<HTMLElement>("#dash-today")!;
  const idleEl = root.querySelector<HTMLElement>("#dash-idle")!;
  const chartEl = root.querySelector<HTMLElement>("#dash-chart")!;
  renderToday(todayEl, t);
  renderIdle(idleEl, t.idle_ms, weekIdleAvg, cap);
  renderChart(chartEl, buckets);
}

export function mountDashboard(root: HTMLElement) {
  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-today"></div>
      <div id="dash-idle"></div>
      <div id="dash-chart"></div>
      <div class="dashboard-footer">
        <button id="clear-stats" class="danger-btn">Clear stats</button>
      </div>
    </div>
  `;
  refresh(root);

  // Live updates while window is visible
  listen("stats-updated", () => refresh(root));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh(root);
  });

  // Clear-stats handler — wired in Task 15
  const btn = root.querySelector<HTMLButtonElement>("#clear-stats")!;
  btn.addEventListener("click", async () => {
    const ok = window.confirm("Permanently delete all stats history? This cannot be undone.");
    if (!ok) return;
    await resetStats();
    refresh(root);
  });
}
```

- [ ] **Step 6: dashboard.css — add card / chart styles**

Append to `src/styles/dashboard.css`:

```css
.dashboard {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 14px;
}
.card-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  opacity: 0.7;
  margin-bottom: 8px;
}
.today-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.today-grid .big {
  font-size: 20px;
  font-weight: 600;
}
.today-grid .small {
  font-size: 11px;
  opacity: 0.6;
}
.card-footer {
  margin-top: 10px;
  font-size: 11px;
  opacity: 0.6;
}
.idle-card .idle-row {
  display: flex;
  gap: 24px;
}
.idle-card .big {
  font-size: 22px;
  font-weight: 600;
  margin-top: 4px;
}
.chart-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
  height: 140px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 4px;
}
.bar-stack {
  flex: 1;
  display: flex;
  flex-direction: column-reverse;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 3px;
  overflow: hidden;
}
.bar-seg {
  width: 100%;
}
.bar-label {
  text-align: center;
  font-size: 10px;
  opacity: 0.6;
}
.dashboard-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
.danger-btn {
  background: transparent;
  border: 1px solid rgba(255, 80, 80, 0.4);
  color: rgba(255, 120, 120, 0.9);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
.danger-btn:hover { background: rgba(255, 80, 80, 0.1); }
```

- [ ] **Step 7: TS build + dev run**

```powershell
npm run build
npm run tauri dev
```

Open dashboard from tray. You should see three cards: Today, Idle, 7-day chart. Run a quick focus session for a minute or two and watch the Today numbers update live (listen to `stats-updated` event fires on each phase change). Clear stats button confirms then empties everything.

- [ ] **Step 8: Commit**

```powershell
git add src/views/dashboard/phase-colors.ts src/views/dashboard/today.ts src/views/dashboard/idle.ts src/views/dashboard/chart.ts src/views/dashboard/dashboard.ts src/styles/dashboard.css
git commit -m "FEAT: dashboard cards (today, idle, 7-day chart, clear)"
```

---

## Task 15: Polishing pass — naming, sanity, manual QA

**Files:**
- Verify all of the above.

- [ ] **Step 1: Re-read `src/main.ts`** end-to-end. Confirm every place that changes phase or running state has the right `openEvent` / `closeOpenEvent` call. Specifically: `startTimer`, `pauseTimer`, `setPhase`, `setPhaseInternal` (no call needed there — verify), `handlePhaseEnd`, `startSnooze` (in fullscreen.ts).

- [ ] **Step 2: Re-read `src-tauri/src/lib.rs`** end-to-end. Confirm tray menu items, `on_menu_event` IDs, and that `RunEvent::ExitRequested` closes any open event.

- [ ] **Step 3: Manual QA checklist**

```powershell
npm run tauri dev
```

Run through:

- [ ] Open dashboard via tray > Dashboard. URL hash = `#dashboard`. Tabs visible at top.
- [ ] Switch to Settings tab. Existing settings UI renders correctly.
- [ ] Switch back to Dashboard. Three cards visible.
- [ ] On the timer overlay, all 4 tabs work: Focus / Break / Big Break / Other.
- [ ] Stopwatch (Other) counts up. Pause + resume continues from same value.
- [ ] Focus → run a full short session to bell. Watch the dashboard's Today.focus number tick up live.
- [ ] Pause mid-focus, dashboard updates show the partial focus minutes preserved.
- [ ] Skip a break. Then take a snooze. Then take another break. Each shows up in stats.
- [ ] Close the app via tray > Quit while a timer is running. Restart. Open dashboard. The event for the killed session shows `ended_by: "app_close"` (check the on-disk file).
- [ ] Change `idle_gap_cap_minutes` in Settings to `30`. Open dashboard — the idle card's caption updates to "Gaps over 1h are excluded".
- [ ] Click "Clear stats" → confirm → all numbers zero out.

- [ ] **Step 4: Build a release-style bundle to make sure prod path compiles**

```powershell
npm run build
cd src-tauri
cargo check
cd ..
```

Both should succeed.

- [ ] **Step 5: Commit any polish fixes**

```powershell
git add -p
git commit -m "CHORE: stats dashboard polish + verification"
```

If nothing changed, skip.

---

## Task 16: Version bump + ship

**Files:**
- Modify: `package.json` (patch bump)

- [ ] **Step 1: Patch bump**

Read current version from `package.json`. Increment patch (`0.3.16` → `0.3.17`). Update `package.json` only — CI syncs the others.

- [ ] **Step 2: Commit version**

Use the project's auto-commit convention:

```powershell
git add package.json
git commit -m "VERSION: 0.3.17"
```

- [ ] **Step 3: Push**

```powershell
git push origin feat/stats-dashboard
```

Open a PR if applicable; otherwise merge to main locally (per project convention) so the release workflow triggers.

---

## Verification summary

- TS builds: `npm run build`
- Rust builds: `cd src-tauri && cargo check`
- Unit tests: `npm test`
- Manual QA: Task 15 checklist
- Live data on disk: `Get-Content "$env:APPDATA\com.bepy.pomodoro-overlay\stats.json"`
