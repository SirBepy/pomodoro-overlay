use crate::settings::{self, Settings, SettingsState};
use crate::state::PausedSessionsState;
use crate::{apply_autostart, compute_corner_position, resize_and_anchor};
use tauri::{image::Image, AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub fn get_settings(state: State<SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    settings: Settings,
) -> Result<(), String> {
    {
        let mut s = state.0.lock().unwrap();
        *s = settings.clone();
    }
    log::info!("settings saved");
    settings::persist(&app, &settings)?;
    if let Some(win) = app.get_webview_window("main") {
        let (w, h) = settings.expanded_size();
        let _ = resize_and_anchor(&win, &settings, w, h);
        let _ = win.set_always_on_top(settings.always_on_top);
    }
    apply_autostart(&app, settings.autostart);
    Ok(())
}

#[tauri::command]
pub fn set_window_size(app: AppHandle, expanded: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let s = app.state::<SettingsState>();
    let settings = s.0.lock().unwrap().clone();
    let _ = expanded;
    let (w, h) = settings.expanded_size();
    resize_and_anchor(&win, &settings, w, h).map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(settings.always_on_top);
    Ok(())
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Pomodoro Overlay - Settings")
        .inner_size(440.0, 600.0)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(t) = app.tray_by_id("main-tray") {
        let icon = app
            .default_window_icon()
            .cloned()
            .unwrap_or_else(|| Image::from_bytes(include_bytes!("../../icons/32x32.png")).unwrap());
        let _ = t.set_icon(Some(icon));
    }
}

#[tauri::command]
pub async fn pick_sound_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Audio", &["wav", "mp3", "ogg", "flac", "m4a"])
        .pick_file(move |f| {
            let _ = tx.send(f.map(|p| p.to_string()));
        });
    rx.recv().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_resize(app: AppHandle, direction: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            PostMessageW, WM_NCLBUTTONDOWN, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTTOPLEFT, HTTOPRIGHT,
        };

        let win = app
            .get_webview_window("main")
            .ok_or_else(|| "no main window".to_string())?;

        let handle = win.window_handle().map_err(|e| e.to_string())?;
        let hwnd = match handle.as_raw() {
            RawWindowHandle::Win32(h) => h.hwnd.get() as *mut std::ffi::c_void,
            _ => return Err("not a Win32 window".into()),
        };

        let ht: usize = match direction.as_str() {
            "NorthWest" => HTTOPLEFT as usize,
            "NorthEast" => HTTOPRIGHT as usize,
            "SouthWest" => HTBOTTOMLEFT as usize,
            "SouthEast" => HTBOTTOMRIGHT as usize,
            _ => return Err(format!("unknown direction: {direction}")),
        };

        unsafe {
            ReleaseCapture();
            PostMessageW(hwnd, WM_NCLBUTTONDOWN, ht, 0);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (app, direction);
    Ok(())
}

#[tauri::command]
pub fn save_window_size(app: AppHandle, state: State<'_, SettingsState>) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let settings = {
        let mut s = state.0.lock().unwrap();
        s.width = size.width;
        s.height = size.height;
        s.clone()
    };
    settings::persist(&app, &settings)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn get_corner_position(app: AppHandle) -> Result<(i32, i32), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let s = app.state::<SettingsState>();
    let settings = s.0.lock().unwrap().clone();
    let (w, h) = settings.expanded_size();
    compute_corner_position(&win, &settings, w, h).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_window_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_window_fullscreen(app: AppHandle, fullscreen: bool) -> Result<(), String> {
    log::info!("fullscreen: {fullscreen}");
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    if fullscreen {
        let monitor = win
            .current_monitor()
            .map_err(|e| e.to_string())?
            .or(win.primary_monitor().map_err(|e| e.to_string())?)
            .ok_or_else(|| "no monitor".to_string())?;
        let work = monitor.work_area();
        win.set_size(PhysicalSize::new(work.size.width, work.size.height))
            .map_err(|e| e.to_string())?;
        win.set_position(PhysicalPosition::new(work.position.x, work.position.y))
            .map_err(|e| e.to_string())?;
    } else {
        let s = app.state::<SettingsState>();
        let settings = s.0.lock().unwrap().clone();
        let (w, h) = settings.expanded_size();
        resize_and_anchor(&win, &settings, w, h).map_err(|e| e.to_string())?;
        let _ = win.set_always_on_top(settings.always_on_top);
    }
    Ok(())
}

#[tauri::command]
pub fn is_cursor_over_window(app: AppHandle) -> Result<bool, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let cx = cursor.x as i32;
    let cy = cursor.y as i32;
    let in_x = cx >= pos.x && cx < pos.x + size.width as i32;
    let in_y = cy >= pos.y && cy < pos.y + size.height as i32;
    Ok(in_x && in_y)
}

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
