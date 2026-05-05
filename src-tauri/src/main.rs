#![windows_subsystem = "windows"]

mod settings;

use settings::{Settings, SettingsState};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;

// Always defined so State<PausedSessionsState> compiles on all platforms.
// SMTC calls inside the commands are gated by #[cfg(target_os = "windows")].
struct PausedSessionsState(std::sync::Mutex<Vec<String>>);

// Stores the pre-existing CloudStore quiet-hours blob so we can restore it
// byte-for-byte (FILETIME refreshed) when DND ends.
struct DndState(std::sync::Mutex<Option<Vec<u8>>>);

#[cfg(target_os = "windows")]
mod dnd_impl {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_BINARY,
    };

    // Focus Assist (Quiet Hours) active-profile blob lives here.
    const KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\Cache\\DefaultAccount\\$$windows.data.notifications.quiethourssettings\\Current";
    const VALUE_NAME: &str = "Data";
    const PROFILE_ALARMS_ONLY: &str = "Microsoft.QuietHoursProfile.AlarmsOnly";

    // Blob layout (observed):
    //   [0..4]   version header (02 00 00 00)
    //   [4..12]  FILETIME (must be refreshed on every write)
    //   [12..16] padding (00 00 00 00)
    //   [16..23] fixed (43 42 01 00 C2 0A 01)
    //   [23..25] field prefix (D2 14)
    //   [25]     UTF-16 char count of profile string
    //   [26..]   UTF-16LE profile string ("Microsoft.QuietHoursProfile.<X>")
    //   tail     CA <count> 00 00  (count typically duplicated)
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

    /// Replaces the profile string in `original` with "AlarmsOnly" and refreshes the FILETIME.
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

        // If trailing is `CA <old_count> 00 00`, mirror the new count too.
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

    /// WpnUserService caches the active quiet-hours profile in memory; without
    /// a kick, registry edits are not picked up until logoff. Restarting the
    /// per-user service (WpnUserService_<hash>) is the documented workaround.
    /// Hidden powershell shell-out keeps this contained to ~one call per timer.
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

#[tauri::command]
fn get_settings(state: State<SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
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
fn set_window_size(app: AppHandle, expanded: bool) -> Result<(), String> {
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
fn open_settings_window(app: AppHandle) -> Result<(), String> {
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
fn show_main_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(t) = app.tray_by_id("main-tray") {
        let icon = app
            .default_window_icon()
            .cloned()
            .unwrap_or_else(|| Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap());
        let _ = t.set_icon(Some(icon));
    }
}

#[tauri::command]
async fn pick_sound_file(app: AppHandle) -> Result<Option<String>, String> {
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
fn start_resize(app: AppHandle, direction: String) -> Result<(), String> {
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
fn save_window_size(app: AppHandle, state: State<'_, SettingsState>) -> Result<(), String> {
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
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_corner_position(app: AppHandle) -> Result<(i32, i32), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let s = app.state::<SettingsState>();
    let settings = s.0.lock().unwrap().clone();
    let (w, h) = settings.expanded_size();
    compute_corner_position(&win, &settings, w, h).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_fullscreen(app: AppHandle, fullscreen: bool) -> Result<(), String> {
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
fn is_cursor_over_window(app: AppHandle) -> Result<bool, String> {
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
async fn media_pause_if_playing(state: State<'_, PausedSessionsState>) -> Result<bool, String> {
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
async fn media_resume(state: State<'_, PausedSessionsState>) -> Result<(), String> {
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
fn enable_dnd(state: State<'_, DndState>) {
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
        if dnd_impl::write_blob(&new_blob) {
            *guard = Some(original);
            dnd_impl::kick_wpn_user_service();
        } else {
            log::warn!("enable_dnd: failed to write CloudStore blob");
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = state;
}

#[tauri::command]
fn disable_dnd(state: State<'_, DndState>) {
    #[cfg(target_os = "windows")]
    {
        let prev = state.0.lock().unwrap().take();
        if let Some(blob) = prev {
            let refreshed = dnd_impl::refresh_filetime(&blob);
            if dnd_impl::write_blob(&refreshed) {
                dnd_impl::kick_wpn_user_service();
            } else {
                log::warn!("disable_dnd: failed to restore CloudStore blob");
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = state;
}

fn compute_corner_position(
    win: &WebviewWindow,
    settings: &Settings,
    w: u32,
    h: u32,
) -> Result<(i32, i32), Box<dyn std::error::Error>> {
    let monitor = win
        .current_monitor()?
        .or(win.primary_monitor()?)
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let margin = (16.0 * scale) as i32;
    let mw = work.size.width as i32;
    let mh = work.size.height as i32;
    let mx = work.position.x;
    let my = work.position.y;
    Ok(match settings.corner.as_str() {
        "tl" => (mx + margin, my + margin),
        "tr" => (mx + mw - w as i32 - margin, my + margin),
        "bl" => (mx + margin, my + mh - h as i32 - margin),
        _ => (mx + mw - w as i32 - margin, my + mh - h as i32 - margin),
    })
}

fn resize_and_anchor(
    win: &WebviewWindow,
    settings: &Settings,
    w: u32,
    h: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    let (x, y) = compute_corner_position(win, settings, w, h)?;
    win.set_size(PhysicalSize::new(w, h))?;
    win.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

fn apply_autostart(app: &AppHandle, enabled: bool) {
    let mgr = app.autolaunch();
    if enabled {
        let _ = mgr.enable();
    } else {
        let _ = mgr.disable();
    }
}

fn dimmed_icon(icon: &Image) -> Image<'static> {
    let mut rgba = icon.rgba().to_vec();
    for i in (3..rgba.len()).step_by(4) {
        rgba[i] = rgba[i] / 2;
    }
    Image::new_owned(rgba, icon.width(), icon.height())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &settings_item, &sep, &quit])?;

    let icon: Image = match app.default_window_icon() {
        Some(i) => i.clone(),
        None => Image::from_bytes(include_bytes!("../icons/32x32.png"))?,
    };

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Pomodoro Overlay")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                if let Some(t) = app.tray_by_id("main-tray") {
                    let icon = app.default_window_icon()
                        .cloned()
                        .unwrap_or_else(|| Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap());
                    let _ = t.set_icon(Some(icon));
                }
            }
            "hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
                if let Some(t) = app.tray_by_id("main-tray") {
                    let base = app.default_window_icon()
                        .cloned()
                        .unwrap_or_else(|| Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap());
                    let _ = t.set_icon(Some(dimmed_icon(&base)));
                }
            }
            "settings" => {
                let _ = open_settings_window(app.clone());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let visible = w.is_visible().unwrap_or(false);
                    if visible {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    if let Some(t) = app.tray_by_id("main-tray") {
                        let base = app.default_window_icon()
                            .cloned()
                            .unwrap_or_else(|| Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap());
                        let icon = if visible { dimmed_icon(&base) } else { base };
                        let _ = t.set_icon(Some(icon));
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_kit_updater::plugin())
        .plugin(tauri_kit_settings::with_logging())
        .plugin(tauri_kit_settings::with_kit_commands())
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = settings::load(&handle);
            log::info!("app started; version={}", env!("CARGO_PKG_VERSION"));
            apply_autostart(&handle, settings.autostart);
            if let Some(win) = handle.get_webview_window("main") {
                let (w, h) = settings.expanded_size();
                let _ = resize_and_anchor(&win, &settings, w, h);
                let _ = win.set_always_on_top(settings.always_on_top);
                let _ = win.set_min_size(Some(PhysicalSize::new(200u32, 120u32)));
                let _ = win.show();
            }
            handle.manage(SettingsState(Mutex::new(settings)));
            handle.manage(PausedSessionsState(std::sync::Mutex::new(Vec::new())));
            handle.manage(DndState(std::sync::Mutex::new(None)));
            if let Err(e) = build_tray(&handle) {
                eprintln!("failed to build tray: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            set_window_size,
            open_settings_window,
            show_main_window,
            pick_sound_file,
            quit_app,
            get_corner_position,
            set_window_position,
            is_cursor_over_window,
            start_resize,
            save_window_size,
            set_window_fullscreen,
            media_pause_if_playing,
            media_resume,
            enable_dnd,
            disable_dnd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
