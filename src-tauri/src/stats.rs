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
