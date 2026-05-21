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

#[tauri::command]
pub fn heartbeat_stats(app: AppHandle, now_ms: i64) {
    stats::heartbeat(&app, now_ms);
}
