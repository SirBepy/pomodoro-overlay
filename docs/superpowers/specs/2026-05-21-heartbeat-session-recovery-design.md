# Heartbeat Session Recovery

**Date:** 2026-05-21
**Status:** Approved

## Problem

When the Tauri backend is killed externally (e.g. a parent process shuts down the server), any in-progress timer session has `end_ms: null` in `stats.json`. On next startup, `close_open_on_startup` caps dangling events to 60 seconds (`DANGLING_GRACE_MS`). A 25-minute work session that was still running appears as only 1 minute - the rest is lost.

## Solution

A 5-minute heartbeat: while a phase is running, the JS side writes `last_heartbeat_ms` to `stats.json` every 5 minutes. On startup recovery, `close_open_on_startup` uses the last heartbeat timestamp as the end time instead of the 60-second grace cap.

Worst-case data loss: 5 minutes (last heartbeat interval before the kill).

## Architecture

### `StatsFile` struct (`stats.rs`)

Add one optional field:

```rust
#[serde(default)]
pub last_heartbeat_ms: Option<i64>,
```

`#[serde(default)]` ensures existing `stats.json` files without this field deserialize cleanly.

### `stats::heartbeat` function (`stats.rs`)

```rust
pub fn heartbeat(app: &AppHandle, now_ms: i64) {
    let state = app.state::<StatsState>();
    let mut file = state.0.lock().unwrap();
    file.last_heartbeat_ms = Some(now_ms);
    let _ = persist(app, &file);
}
```

Only updates `last_heartbeat_ms` - does not touch any event. Events remain `end_ms: null` while running, so dashboard display is unaffected.

### `close_open_on_startup` update (`stats.rs`)

```rust
pub fn close_open_on_startup(app: &AppHandle, _now_ms: i64) {
    // ...
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
            closed += 1;
        }
    }
    file.last_heartbeat_ms = None; // clear after recovery
    // persist if closed > 0
}
```

### Tauri command (`commands.rs`)

```rust
#[tauri::command]
pub fn heartbeat_stats(app: AppHandle, now_ms: i64) {
    stats::heartbeat(&app, now_ms);
}
```

Register in `lib.rs` invoke handler alongside existing stats commands.

### JS heartbeat (`stats.ts`)

```ts
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

- `openEvent` calls `startHeartbeat()` (guard prevents double-start on resume)
- `closeOpenEvent` calls `stopHeartbeat()`

## Data flow

```
Phase starts → openEvent() → startHeartbeat() starts 5-min interval
  every 5 min: invoke("heartbeat_stats") → stats.json gets last_heartbeat_ms updated
Phase ends normally → closeOpenEvent() → stopHeartbeat() → close_open_stats_event
  → end_ms + ended_by written; last_heartbeat_ms is irrelevant (event is closed)

App killed mid-session:
  → stats.json has open event (end_ms: null) + last_heartbeat_ms = T
Next startup → close_open_on_startup:
  → open event end_ms set to T (last heartbeat), ended_by = "app_close"
  → last_heartbeat_ms cleared
  → at most 5 minutes of work lost
```

## Non-goals

- Resuming the timer after a crash (not requested)
- Making the interval configurable in settings (unnecessary complexity)
- Heartbeat on pause (paused sessions are already closed via `closeOpenEvent("pause")`)

## Files changed

- `src-tauri/src/stats.rs` - `StatsFile`, `heartbeat()`, `close_open_on_startup()`
- `src-tauri/src/ipc/commands.rs` - `heartbeat_stats` command
- `src-tauri/src/lib.rs` - register command in invoke handler
- `src/shared/stats.ts` - `startHeartbeat`, `stopHeartbeat`, wire into `openEvent`/`closeOpenEvent`
