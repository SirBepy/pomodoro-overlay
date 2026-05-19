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
