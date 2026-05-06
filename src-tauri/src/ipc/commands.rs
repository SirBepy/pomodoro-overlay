use crate::settings::{self, Settings, SettingsState};
use crate::state::{DndState, PausedSessionsState};
use crate::{apply_autostart, compute_corner_position, resize_and_anchor};
use tauri::{image::Image, AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
mod dnd_impl {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY,
    };

    const KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\Cache\\DefaultAccount\\$$windows.data.notifications.quiethourssettings\\Current";
    const VALUE_NAME: &str = "Data";
    const PROFILE_ALARMS_ONLY: &str = "Microsoft.QuietHoursProfile.AlarmsOnly";

    const STR_OFFSET: usize = 26;
    const COUNT_OFFSET: usize = 25;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    pub fn read_blob() -> Option<Vec<u8>> {
        unsafe {
            let mut hkey: windows_sys::Win32::System::Registry::HKEY = std::ptr::null_mut();
            let key = wide(KEY_PATH);
            if RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_QUERY_VALUE, &mut hkey) != 0 {
                return None;
            }
            let val = wide(VALUE_NAME);
            let mut size: u32 = 0;
            let mut kind: u32 = 0;
            let rc1 = RegQueryValueExW(
                hkey,
                val.as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            );
            if rc1 != 0 || kind != REG_BINARY || size == 0 {
                RegCloseKey(hkey);
                return None;
            }
            let mut buf = vec![0u8; size as usize];
            let rc2 = RegQueryValueExW(
                hkey,
                val.as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                buf.as_mut_ptr(),
                &mut size,
            );
            RegCloseKey(hkey);
            if rc2 == 0 {
                buf.truncate(size as usize);
                Some(buf)
            } else {
                None
            }
        }
    }

    pub fn write_blob(data: &[u8]) -> bool {
        if data.is_empty() {
            return false;
        }
        unsafe {
            let mut hkey: windows_sys::Win32::System::Registry::HKEY = std::ptr::null_mut();
            let key = wide(KEY_PATH);
            if RegOpenKeyExW(HKEY_CURRENT_USER, key.as_ptr(), 0, KEY_SET_VALUE, &mut hkey) != 0 {
                return false;
            }
            let val = wide(VALUE_NAME);
            let rc = RegSetValueExW(
                hkey,
                val.as_ptr(),
                0,
                REG_BINARY,
                data.as_ptr(),
                data.len() as u32,
            );
            RegCloseKey(hkey);
            rc == 0
        }
    }

    fn current_filetime() -> u64 {
        use std::time::SystemTime;
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        (nanos / 100) + 116_444_736_000_000_000u64
    }

    fn stamp_filetime(buf: &mut [u8]) {
        if buf.len() >= 12 {
            buf[4..12].copy_from_slice(&current_filetime().to_le_bytes());
        }
    }

    pub fn build_alarms_only(original: &[u8]) -> Option<Vec<u8>> {
        if original.len() < STR_OFFSET {
            return None;
        }
        let old_count = original[COUNT_OFFSET] as usize;
        let old_str_end = STR_OFFSET + old_count * 2;
        if old_str_end > original.len() {
            return None;
        }
        let trailing = &original[old_str_end..];

        let new_chars: Vec<u16> = PROFILE_ALARMS_ONLY.encode_utf16().collect();
        let new_count = new_chars.len();
        let mut new_str_bytes = Vec::with_capacity(new_count * 2);
        for u in &new_chars {
            new_str_bytes.extend_from_slice(&u.to_le_bytes());
        }

        let mut out = Vec::with_capacity(STR_OFFSET + new_str_bytes.len() + trailing.len());
        out.extend_from_slice(&original[..STR_OFFSET]);
        out[COUNT_OFFSET] = new_count as u8;
        stamp_filetime(&mut out);
        out.extend_from_slice(&new_str_bytes);

        if trailing.len() >= 4
            && trailing[0] == 0xCA
            && trailing[1] as usize == old_count
            && trailing[2] == 0x00
            && trailing[3] == 0x00
        {
            out.push(0xCA);
            out.push(new_count as u8);
            out.push(0x00);
            out.push(0x00);
            out.extend_from_slice(&trailing[4..]);
        } else {
            out.extend_from_slice(trailing);
        }

        Some(out)
    }

    pub fn refresh_filetime(blob: &[u8]) -> Vec<u8> {
        let mut out = blob.to_vec();
        stamp_filetime(&mut out);
        out
    }

    pub fn kick_wpn_user_service() {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("powershell.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                "Get-Service -Name 'WpnUserService_*' -ErrorAction SilentlyContinue | Restart-Service -Force -ErrorAction SilentlyContinue",
            ])
            .output();
    }
}

#[cfg(target_os = "windows")]
fn dnd_backup_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("dnd_backup.bin"))
}

#[cfg(target_os = "windows")]
pub(crate) fn recover_dnd_backup(blob: &[u8]) -> bool {
    let refreshed = dnd_impl::refresh_filetime(blob);
    if dnd_impl::write_blob(&refreshed) {
        dnd_impl::kick_wpn_user_service();
        true
    } else {
        false
    }
}

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

#[tauri::command]
pub fn enable_dnd(app: AppHandle, state: State<'_, DndState>) {
    #[cfg(target_os = "windows")]
    {
        let mut guard = state.0.lock().unwrap();
        if guard.is_some() {
            return;
        }
        let Some(original) = dnd_impl::read_blob() else {
            log::warn!("enable_dnd: CloudStore quiethours blob not present; skipping");
            return;
        };
        let Some(new_blob) = dnd_impl::build_alarms_only(&original) else {
            log::warn!("enable_dnd: failed to build AlarmsOnly blob; skipping");
            return;
        };
        if let Some(p) = dnd_backup_path(&app) {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(&p, &original) {
                log::warn!("enable_dnd: failed to write backup file: {e}");
            }
        }
        if dnd_impl::write_blob(&new_blob) {
            *guard = Some(original);
            dnd_impl::kick_wpn_user_service();
        } else {
            log::warn!("enable_dnd: failed to write CloudStore blob");
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (app, state);
}

#[tauri::command]
pub fn disable_dnd(app: AppHandle, state: State<'_, DndState>) {
    #[cfg(target_os = "windows")]
    {
        let prev = state.0.lock().unwrap().take();
        if let Some(blob) = prev {
            let refreshed = dnd_impl::refresh_filetime(&blob);
            if dnd_impl::write_blob(&refreshed) {
                dnd_impl::kick_wpn_user_service();
                if let Some(p) = dnd_backup_path(&app) {
                    let _ = std::fs::remove_file(p);
                }
            } else {
                log::warn!("disable_dnd: failed to restore CloudStore blob");
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (app, state);
}
