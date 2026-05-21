use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const STATS_FILENAME: &str = "stats.json";
const CURRENT_VERSION: u32 = 2;

/// When the app is killed with a phase still running, the real end time is
/// unknown. Dangling open events are capped to this grace (or the configured
/// end if shorter) so unverifiable time is dropped by the dashboard's 1-minute
/// filter instead of producing a phantom long block.
const DANGLING_GRACE_MS: i64 = 60_000;

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
    pub last_heartbeat_ms: Option<i64>,
}

impl Default for StatsFile {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            events: Vec::new(),
            last_heartbeat_ms: None,
        }
    }
}

pub struct StatsState(pub Mutex<StatsFile>);

fn stats_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
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
    let mut file = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<StatsFile>(&bytes).unwrap_or_else(|e| {
            log::warn!("stats: parse failed, starting empty: {e}");
            StatsFile::default()
        }),
        Err(e) => {
            log::warn!("stats: read failed: {e}");
            StatsFile::default()
        }
    };
    if migrate(&mut file) {
        match persist(app, &file) {
            Ok(()) => log::info!("stats: migrated to v{CURRENT_VERSION}"),
            Err(e) => log::warn!("stats: migration persist failed: {e}"),
        }
    }
    file
}

/// Bring `file` up to `CURRENT_VERSION`. Returns true if anything changed.
///
/// v2: collapse overlapping events into a non-overlapping timeline. Activity is
/// sequential (one phase at a time); overlapping events were a bug (multiple
/// open events force-closed to the same instant) that inflated phase totals into
/// the hundreds of hours. Sort by start and clamp each event's end to the next
/// event's start. Open events (end_ms = None) are left for `close_open_on_startup`.
fn migrate(file: &mut StatsFile) -> bool {
    if file.version >= CURRENT_VERSION {
        return false;
    }
    file.events.sort_by_key(|e| e.start_ms);
    for i in 0..file.events.len().saturating_sub(1) {
        let next_start = file.events[i + 1].start_ms;
        if let Some(end) = file.events[i].end_ms {
            if end > next_start {
                file.events[i].end_ms = Some(next_start.max(file.events[i].start_ms));
            }
        }
    }
    file.version = CURRENT_VERSION;
    true
}

pub fn persist(app: &AppHandle, file: &StatsFile) -> Result<(), String> {
    let path = stats_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(file).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

pub fn append(app: &AppHandle, mut event: StatsEvent) -> Result<(), String> {
    if event.session_id.is_empty() {
        event.session_id = uuid::Uuid::new_v4().to_string();
    }
    let state = app.state::<StatsState>();
    let mut file = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    // Invariant: at most one event open at a time. If the previous event is
    // still open, close it to this event's start so activity never overlaps -
    // overlapping events were the cause of phantom multi-day phase totals.
    if let Some(last) = file.events.last_mut() {
        if last.end_ms.is_none() {
            last.end_ms = Some(event.start_ms.max(last.start_ms));
            last.ended_by = Some("switch".into());
        }
    }
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

pub fn heartbeat(app: &AppHandle, now_ms: i64) {
    let state = app.state::<StatsState>();
    let mut file = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    file.last_heartbeat_ms = Some(now_ms);
    // No stats-updated emit: heartbeat only updates last_heartbeat_ms, not event data.
    let _ = persist(app, &file);
}

fn resolve_recovery_end(heartbeat: Option<i64>, event: &StatsEvent) -> i64 {
    heartbeat
        .filter(|&hb| hb > event.start_ms)
        .unwrap_or_else(|| {
            let configured_ms = event.configured_seconds.map(|s| s as i64 * 1000);
            event.start_ms + configured_ms.unwrap_or(DANGLING_GRACE_MS).min(DANGLING_GRACE_MS)
        })
}

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
            event.end_ms = Some(resolve_recovery_end(heartbeat, event));
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
        let event = open_event(1000, Some(1500));
        let heartbeat = Some(900_000_i64); // 15 minutes after start

        let end = resolve_recovery_end(heartbeat, &event);

        assert_eq!(end, 900_000);
    }

    #[test]
    fn recovery_falls_back_to_grace_when_no_heartbeat() {
        let event = open_event(1000, Some(1500));
        let heartbeat = None;

        let end = resolve_recovery_end(heartbeat, &event);

        // configured_seconds=1500 -> 1500_000 ms, but capped to DANGLING_GRACE_MS (60_000)
        assert_eq!(end, 1000 + DANGLING_GRACE_MS);
    }

    #[test]
    fn recovery_ignores_heartbeat_before_event_start() {
        let event = open_event(5000, None);
        let heartbeat = Some(3000_i64); // before start_ms=5000

        let end = resolve_recovery_end(heartbeat, &event);

        // Heartbeat is before start -> falls back to grace
        assert_eq!(end, 5000 + DANGLING_GRACE_MS);
    }
}
