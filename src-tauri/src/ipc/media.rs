use crate::state::PausedSessionsState;
use tauri::State;

#[tauri::command]
pub async fn media_pause_if_playing(state: State<'_, PausedSessionsState>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let paused_ids = tokio::task::spawn_blocking(|| -> Result<Vec<String>, String> {
            use windows::Media::Control::{
                GlobalSystemMediaTransportControlsSessionManager,
                GlobalSystemMediaTransportControlsSessionPlaybackStatus,
            };

            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .map_err(|e| e.to_string())?
                .get()
                .map_err(|e| e.to_string())?;

            let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
            let count = sessions.Size().map_err(|e| e.to_string())?;
            let mut paused_ids: Vec<String> = Vec::new();

            for i in 0..count {
                if let Ok(session) = sessions.GetAt(i) {
                    if let Ok(info) = session.GetPlaybackInfo() {
                        if let Ok(status) = info.PlaybackStatus() {
                            if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                                if let Ok(op) = session.TryPauseAsync() {
                                    let _ = op.get();
                                }
                                if let Ok(id) = session.SourceAppUserModelId() {
                                    paused_ids.push(id.to_string());
                                }
                            }
                        }
                    }
                }
            }

            Ok(paused_ids)
        })
        .await
        .map_err(|e| e.to_string())??;

        let had_any = !paused_ids.is_empty();
        *state.0.lock().unwrap() = paused_ids;
        return Ok(had_any);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Ok(false)
    }
}

#[tauri::command]
pub async fn media_resume(state: State<'_, PausedSessionsState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let ids: Vec<String> = {
            let mut guard = state.0.lock().unwrap();
            std::mem::take(&mut *guard)
        };

        if ids.is_empty() {
            return Ok(());
        }

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
                .map_err(|e| e.to_string())?
                .get()
                .map_err(|e| e.to_string())?;

            let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
            let count = sessions.Size().map_err(|e| e.to_string())?;

            for i in 0..count {
                if let Ok(session) = sessions.GetAt(i) {
                    if let Ok(id) = session.SourceAppUserModelId() {
                        if ids.contains(&id.to_string()) {
                            if let Ok(op) = session.TryPlayAsync() {
                                let _ = op.get();
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = state;
    Ok(())
}
