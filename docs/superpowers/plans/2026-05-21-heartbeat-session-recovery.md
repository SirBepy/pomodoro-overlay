# Heartbeat Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `last_heartbeat_ms` to `stats.json` every 5 minutes while a phase is running so that hard-killed sessions recover to within 5 minutes of actual end time instead of being capped at 60 seconds.

**Architecture:** JS fires a `setInterval` (5 min) when a phase opens and clears it when the phase closes. Each tick calls a new `heartbeat_stats` Tauri command that writes `last_heartbeat_ms` to `stats.json`. On startup, `close_open_on_startup` uses `last_heartbeat_ms` as the dangling-event end time (if > `start_ms`), falling back to the existing 60-second grace only when no heartbeat was written.

**Tech Stack:** Rust (stats.rs, ipc/stats.rs, lib.rs), TypeScript (stats.ts), Vitest (JS unit tests skipped - invoke can't be mocked without a test harness; Rust unit tests cover the critical recovery path)

---

### Task 1: Add `last_heartbeat_ms` to `StatsFile` and `heartbeat()` to `stats.rs`

**Files:**
- Modify: `src-tauri/src/stats.rs`

- [ ] **Step 1: Add `last_heartbeat_ms` field to `StatsFile`**

In `src-tauri/src/stats.rs`, update the `StatsFile` struct:

```rust
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct StatsFile {
    pub version: u32,
    pub events: Vec<StatsEvent>,
    pub last_heartbeat_ms: Option<i64>,
}
```

Update `Default` impl (already derived via `#[serde(default)]` on the struct, but the manual `Default` impl for `StatsFile` needs the new field):

```rust
impl Default for StatsFile {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            events: Vec::new(),
            last_heartbeat_ms: None,
        }
    }
}
```

- [ ] **Step 2: Add `heartbeat()` function**

Add this function to `src-tauri/src/stats.rs` after the `close_open` function:

```rust
pub fn heartbeat(app: &AppHandle, now_ms: i64) {
    let state = app.state::<StatsState>();
    let mut file = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    file.last_heartbeat_ms = Some(now_ms);
    let _ = persist(app, &file);
}
```

- [ ] **Step 3: Update `close_open_on_startup` to use the heartbeat**

Replace the body of `close_open_on_startup` in `src-tauri/src/stats.rs`:

```rust
pub fn close_open_on_startup(app: &AppHandle, _now_ms: i64) {
    let state = app.state::<StatsState>();
    let mut file = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let heartbeat = file.last_heartbeat_ms;
    let mut closed = 0usize;
    for event in file.events.iter_mut() {
        if event.end_ms.is_none() {
            let recovery_end = heartbeat
                .filter(|&hb| hb > event.start_ms)
                .unwrap_or_else(|| {
                    let configured_ms = event.configured_seconds.map(|s| s as i64 * 1000);
                    event.start_ms + configured_ms.unwrap_or(DANGLING_GRACE_MS).min(DANGLING_GRACE_MS)
                });
            event.end_ms = Some(recovery_end);
            event.ended_by = Some("app_close".into());
            closed += 1;
        }
    }
    file.last_heartbeat_ms = None;
    if closed > 0 {
        log::info!("stats: closed {} dangling open event(s) on startup", closed);
        let _ = persist(app, &file);
    }
}
```

- [ ] **Step 4: Add Rust unit tests**

Add a `#[cfg(test)]` module at the bottom of `src-tauri/src/stats.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn open_event(start_ms: i64, configured_seconds: Option<u32>) -> StatsEvent {
        StatsEvent {
            session_id: "test".into(),
            phase: "work".into(),
            start_ms,
            end_ms: None,
            configured_seconds,
            ended_by: None,
        }
    }

    #[test]
    fn recovery_uses_heartbeat_when_present_and_after_start() {
        let mut file = StatsFile {
            version: CURRENT_VERSION,
            events: vec![open_event(1000, Some(1500))],
            last_heartbeat_ms: Some(900_000), // 15 minutes after start
        };
        // Simulate close_open_on_startup logic inline (no AppHandle in unit tests)
        let heartbeat = file.last_heartbeat_ms;
        for event in file.events.iter_mut() {
            if event.end_ms.is_none() {
                let recovery_end = heartbeat
                    .filter(|&hb| hb > event.start_ms)
                    .unwrap_or_else(|| {
                        let configured_ms = event.configured_seconds.map(|s| s as i64 * 1000);
                        event.start_ms + configured_ms.unwrap_or(DANGLING_GRACE_MS).min(DANGLING_GRACE_MS)
                    });
                event.end_ms = Some(recovery_end);
                event.ended_by = Some("app_close".into());
            }
        }
        file.last_heartbeat_ms = None;

        assert_eq!(file.events[0].end_ms, Some(900_000));
        assert_eq!(file.events[0].ended_by.as_deref(), Some("app_close"));
        assert_eq!(file.last_heartbeat_ms, None);
    }

    #[test]
    fn recovery_falls_back_to_grace_when_no_heartbeat() {
        let mut file = StatsFile {
            version: CURRENT_VERSION,
            events: vec![open_event(1000, Some(1500))],
            last_heartbeat_ms: None,
        };
        let heartbeat = file.last_heartbeat_ms;
        for event in file.events.iter_mut() {
            if event.end_ms.is_none() {
                let recovery_end = heartbeat
                    .filter(|&hb| hb > event.start_ms)
                    .unwrap_or_else(|| {
                        let configured_ms = event.configured_seconds.map(|s| s as i64 * 1000);
                        event.start_ms + configured_ms.unwrap_or(DANGLING_GRACE_MS).min(DANGLING_GRACE_MS)
                    });
                event.end_ms = Some(recovery_end);
                event.ended_by = Some("app_close".into());
            }
        }

        // configured_seconds=1500 → 1500_000 ms, but capped to DANGLING_GRACE_MS (60_000)
        assert_eq!(file.events[0].end_ms, Some(1000 + DANGLING_GRACE_MS));
    }

    #[test]
    fn recovery_ignores_heartbeat_before_event_start() {
        let mut file = StatsFile {
            version: CURRENT_VERSION,
            events: vec![open_event(5000, None)],
            last_heartbeat_ms: Some(3000), // before start_ms=5000
        };
        let heartbeat = file.last_heartbeat_ms;
        for event in file.events.iter_mut() {
            if event.end_ms.is_none() {
                let recovery_end = heartbeat
                    .filter(|&hb| hb > event.start_ms)
                    .unwrap_or_else(|| {
                        let configured_ms = event.configured_seconds.map(|s| s as i64 * 1000);
                        event.start_ms + configured_ms.unwrap_or(DANGLING_GRACE_MS).min(DANGLING_GRACE_MS)
                    });
                event.end_ms = Some(recovery_end);
                event.ended_by = Some("app_close".into());
            }
        }

        // Heartbeat is before start → falls back to grace
        assert_eq!(file.events[0].end_ms, Some(5000 + DANGLING_GRACE_MS));
    }
}
```

- [ ] **Step 5: Run Rust tests**

```
cd src-tauri
cargo test stats
```

Expected output: `test stats::tests::recovery_uses_heartbeat_when_present_and_after_start ... ok` (and the other two).

- [ ] **Step 6: Verify Rust compiles clean**

```
cd src-tauri
cargo check
```

Expected: no errors or warnings from the changed file.

---

### Task 2: Add `heartbeat_stats` Tauri command and register it

**Files:**
- Modify: `src-tauri/src/ipc/stats.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add command to `ipc/stats.rs`**

Append to the end of `src-tauri/src/ipc/stats.rs`:

```rust
#[tauri::command]
pub fn heartbeat_stats(app: AppHandle, now_ms: i64) {
    stats::heartbeat(&app, now_ms);
}
```

- [ ] **Step 2: Import and register in `lib.rs`**

In `src-tauri/src/lib.rs`, add `heartbeat_stats` to the `use ipc::stats::` import line:

```rust
use ipc::stats::{
    append_stats_event, close_open_stats_event, get_stats_range, heartbeat_stats, reset_stats,
};
```

Add `heartbeat_stats` to the `invoke_handler` list (alongside the other stats commands):

```rust
        .invoke_handler(tauri::generate_handler![
            // ... existing commands ...
            append_stats_event,
            close_open_stats_event,
            get_stats_range,
            reset_stats,
            heartbeat_stats,
        ])
```

- [ ] **Step 3: Verify Rust compiles clean**

```
cd src-tauri
cargo check
```

Expected: no errors.

- [ ] **Step 4: Commit**

Stage and commit via `/commit`.

---

### Task 3: Wire JS heartbeat in `stats.ts`

**Files:**
- Modify: `src/shared/stats.ts`

- [ ] **Step 1: Add heartbeat constants and state**

After the `openEventStartMs` module-level variable in `src/shared/stats.ts`, add:

```ts
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
```

- [ ] **Step 2: Add `startHeartbeat` and `stopHeartbeat` helpers**

Add these two functions before `openEvent` in `src/shared/stats.ts`:

```ts
function startHeartbeat(): void {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = setInterval(() => {
    invoke("heartbeat_stats", { nowMs: Date.now() }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
```

- [ ] **Step 3: Call `startHeartbeat` in `openEvent`**

At the end of `openEvent`, just before `} catch (e) {` block, add `startHeartbeat()`:

```ts
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
  startHeartbeat();
  try {
    await invoke("append_stats_event", { event });
  } catch (e) {
    console.warn("stats: append failed", e);
  }
}
```

- [ ] **Step 4: Call `stopHeartbeat` in `closeOpenEvent`**

At the start of `closeOpenEvent` (before the early return), add `stopHeartbeat()`:

```ts
export async function closeOpenEvent(endedBy: EndedBy): Promise<void> {
  stopHeartbeat();
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
```

Also stop the heartbeat in `resetStats` so a running timer doesn't heartbeat after a reset:

```ts
export async function resetStats(): Promise<void> {
  stopHeartbeat();
  await invoke("reset_stats");
  currentSessionId = null;
  currentPhase = null;
  openEventStartMs = null;
}
```

- [ ] **Step 5: Verify TypeScript builds clean**

```
npm run build
```

Expected: no TS errors, build completes.

- [ ] **Step 6: Commit**

Stage and commit via `/commit`.

---

## Manual QA (after both commits)

Run `npm run tauri dev`. Start a work session. Wait ~5 minutes to confirm the first heartbeat fires (check `stats.json` in `%APPDATA%\pomodoro-overlay\` - `last_heartbeat_ms` should be present). Kill the dev process via Task Manager. Restart the app and open the dashboard - the killed session should appear with a duration close to actual work time, not capped at 1 minute.
