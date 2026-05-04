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
use tauri_plugin_notification::NotificationExt;

// Always defined so State<PausedSessionsState> compiles on all platforms.
// SMTC calls inside the commands are gated by #[cfg(target_os = "windows")].
struct PausedSessionsState(std::sync::Mutex<Vec<String>>);

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
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
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
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

        let ids: Vec<String> = {
            let mut guard = state.0.lock().unwrap();
            std::mem::take(&mut *guard)
        };

        if ids.is_empty() {
            return Ok(());
        }

        tokio::task::spawn_blocking(move || -> Result<(), String> {
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
        .plugin(tauri_plugin_notification::init())
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
            notify,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
