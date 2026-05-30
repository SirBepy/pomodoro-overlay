use crate::push::{self, PushPayload, SendOutcome};
use crate::settings::{self, Settings, SettingsState};
use crate::state::PausedSessionsState;
use crate::{apply_autostart, compute_corner_position, resize_and_anchor};
use tauri::{
    image::Image, AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl,
    WebviewWindowBuilder,
};

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
    let (old_pause, old_skip, old_show_hide, old_meeting) = {
        let s = state.0.lock().unwrap();
        (
            s.keybind_pause.clone(),
            s.keybind_skip.clone(),
            s.keybind_show_hide.clone(),
            s.keybind_meeting_toggle.clone(),
        )
    };
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
    if let Some(win) = app.get_webview_window("main") {
        let _ = tauri_kit_window::exclude_from_capture(&win, settings.meeting_hide_from_capture);
    }
    tauri_kit_meeting::set_apps(
        &app,
        settings
            .meeting_apps
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
    );
    crate::hotkeys::register_hotkeys(
        &app,
        old_pause.as_deref(),
        old_skip.as_deref(),
        old_show_hide.as_deref(),
        old_meeting.as_deref(),
        settings.keybind_pause.as_deref(),
        settings.keybind_skip.as_deref(),
        settings.keybind_show_hide.as_deref(),
        settings.keybind_meeting_toggle.as_deref(),
    );
    Ok(())
}

#[tauri::command]
pub fn set_window_size(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let s = app.state::<SettingsState>();
    let settings = s.0.lock().unwrap().clone();
    let (w, h) = settings.expanded_size();
    resize_and_anchor(&win, &settings, w, h).map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(settings.always_on_top);
    Ok(())
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle, route: Option<String>) -> Result<(), String> {
    let hash = route.unwrap_or_else(|| "dashboard".into());
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.eval(&format!("window.location.hash = '{hash}'"));
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url = format!("settings.html#{hash}");
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url.into()))
        .title("Pomodoro Overlay")
        .inner_size(440.0, 600.0)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        // Show without stealing keyboard focus: this fires on phase transitions
        // (incl. the fullscreen break) and grabbing focus would capture the user's
        // next keystroke (e.g. Space pausing the timer mid-typing). The overlay is
        // always-on-top so it's visible regardless; clicks still focus it.
        let _ = w.show();
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
        #[cfg(target_os = "windows")]
        {
            // Show + size + topmost WITHOUT activating, so going fullscreen never
            // steals keyboard focus from whatever the user is typing in. Tauri's
            // set_size/set_position activate the window (focus theft -> a focused
            // button captures Space -> pauses the timer).
            use raw_window_handle::{HasWindowHandle, RawWindowHandle};
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SW_SHOWNOACTIVATE,
            };
            let handle = win.window_handle().map_err(|e| e.to_string())?;
            let hwnd = match handle.as_raw() {
                RawWindowHandle::Win32(h) => h.hwnd.get() as *mut std::ffi::c_void,
                _ => return Err("not a Win32 window".into()),
            };
            unsafe {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    work.position.x,
                    work.position.y,
                    work.size.width as i32,
                    work.size.height as i32,
                    SWP_NOACTIVATE,
                );
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            win.set_size(tauri::PhysicalSize::new(work.size.width, work.size.height))
                .map_err(|e| e.to_string())?;
            win.set_position(PhysicalPosition::new(work.position.x, work.position.y))
                .map_err(|e| e.to_string())?;
        }
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
pub fn enable_keep_awake() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        };
        unsafe {
            let prev = SetThreadExecutionState(
                ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED,
            );
            if prev == 0 {
                return Err("SetThreadExecutionState returned 0".into());
            }
        }
        log::info!("keep_awake: enabled");
    }
    Ok(())
}

#[tauri::command]
pub fn disable_keep_awake() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS};
        unsafe {
            let prev = SetThreadExecutionState(ES_CONTINUOUS);
            if prev == 0 {
                return Err("SetThreadExecutionState returned 0".into());
            }
        }
        log::info!("keep_awake: disabled");
    }
    Ok(())
}

#[tauri::command]
pub fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    win.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_modifier_held(modifier: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
        };
        let vk: i32 = match modifier.as_str() {
            "alt" => VK_MENU as i32,
            "ctrl" => VK_CONTROL as i32,
            "shift" => VK_SHIFT as i32,
            _ => return false,
        };
        unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = modifier;
        false
    }
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
pub fn get_vapid_public_key(state: State<SettingsState>) -> String {
    state.0.lock().unwrap().vapid_public_key.clone()
}

#[tauri::command]
pub fn get_pairing_status(state: State<SettingsState>) -> bool {
    state.0.lock().unwrap().push_subscription.is_some()
}

#[tauri::command]
pub fn pair_phone(
    app: AppHandle,
    state: State<'_, SettingsState>,
    code: String,
) -> Result<(), String> {
    // Validate before storing.
    push::parse_subscription(&code)?;
    let settings = {
        let mut s = state.0.lock().unwrap();
        s.push_subscription = Some(code);
        s.clone()
    };
    crate::settings::persist(&app, &settings)?;
    log::info!("phone paired");
    Ok(())
}

/// Build the per-send inputs (private key + subscription) if push is enabled and paired.
fn push_inputs(state: &State<SettingsState>, payload: &PushPayload) -> Option<(String, String)> {
    let s = state.0.lock().unwrap();
    if !s.phone_notify_enabled {
        return None;
    }
    // Per-phase gating applies only to phase-end events.
    if payload.event == "phase-end" {
        let allowed = match payload.ended_phase.as_deref() {
            Some("work") => s.notify_on_work_end,
            Some("short") => s.notify_on_short_end,
            Some("long") => s.notify_on_long_end,
            _ => true,
        };
        if !allowed {
            return None;
        }
    }
    let sub = s.push_subscription.clone()?;
    if s.vapid_private_key.is_empty() {
        return None;
    }
    Some((s.vapid_private_key.clone(), sub))
}

// VAPID `sub` contact claim sent to the push service. Non-personal on purpose.
const VAPID_CONTACT: &str = "mailto:pomodoro-overlay@users.noreply.github.com";

async fn do_send(app: AppHandle, pem: String, sub: String, payload: PushPayload) {
    match push::send_push(&pem, &sub, &payload, VAPID_CONTACT).await {
        SendOutcome::Sent => {}
        SendOutcome::SubscriptionGone => {
            log::warn!("push subscription gone; clearing + prompting re-pair");
            if let Some(state) = app.try_state::<SettingsState>() {
                let settings = {
                    let mut s = state.0.lock().unwrap();
                    s.push_subscription = None;
                    s.clone()
                };
                let _ = crate::settings::persist(&app, &settings);
            }
            let _ = app.emit("push-subscription-gone", ());
        }
        SendOutcome::Failed(e) => log::warn!("push send failed (ignored): {e}"),
    }
}

#[tauri::command]
pub fn push_state(app: AppHandle, state: State<SettingsState>, payload: PushPayload) {
    if let Some((pem, sub)) = push_inputs(&state, &payload) {
        tauri::async_runtime::spawn(do_send(app, pem, sub, payload));
    }
}

#[tauri::command]
pub fn send_test_push(app: AppHandle, state: State<SettingsState>) -> Result<(), String> {
    let (pem, sub) = {
        let s = state.0.lock().unwrap();
        let sub = s.push_subscription.clone().ok_or("phone not paired")?;
        if s.vapid_private_key.is_empty() {
            return Err("no VAPID key".into());
        }
        (s.vapid_private_key.clone(), sub)
    };
    let payload = PushPayload {
        phase: "other".into(),
        running: false,
        eta_epoch_ms: 0,
        remaining_sec: 0,
        event: "test".into(),
        ended_phase: None,
        updated_at_ms: 0,
        work_sessions_completed: 0,
    };
    tauri::async_runtime::spawn(do_send(app, pem, sub, payload));
    Ok(())
}
