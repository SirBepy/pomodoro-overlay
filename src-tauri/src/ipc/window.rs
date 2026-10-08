use crate::settings::{self, SettingsState};
use crate::state::FullscreenState;
use crate::{compute_corner_position, resize_and_anchor};
use tauri::{
    image::Image, AppHandle, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[cfg(target_os = "windows")]
fn win32_hwnd(win: &WebviewWindow) -> Result<*mut std::ffi::c_void, String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = win.window_handle().map_err(|e| e.to_string())?;
    match handle.as_raw() {
        RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as *mut std::ffi::c_void),
        _ => Err("not a Win32 window".into()),
    }
}

/// Hides the main window even when tao's cached visible flag is stale.
/// The fullscreen break shows via raw ShowWindow, which tao never records, so
/// its flag can still read hidden while the window is on screen; win.hide()
/// then diffs to nothing and never sends SW_HIDE.
pub(crate) fn hide_main(win: &WebviewWindow) {
    let _ = win.hide();
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        if let Ok(hwnd) = win32_hwnd(win) {
            unsafe {
                ShowWindow(hwnd, SW_HIDE);
            }
        }
    }
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
    // Suppression gates the window only; the tray refresh below still runs.
    let target = match crate::bridge::compact_suppressed(&app) {
        true => None,
        false => app.get_webview_window("main"),
    };
    if let Some(w) = target {
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
pub fn start_resize(app: AppHandle, direction: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            PostMessageW, WM_NCLBUTTONDOWN, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTTOPLEFT, HTTOPRIGHT,
        };

        let win = app
            .get_webview_window("main")
            .ok_or_else(|| "no main window".to_string())?;
        let hwnd = win32_hwnd(&win)?;

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
    // Guard: never persist a fullscreen/maximized size as the saved corner size.
    // The frontend resize debounce that calls this can fire AFTER a rapid phase
    // skip already cleared its `isOverlayFullscreen` flag, so a stale invocation
    // may read the monitor-sized (break-mode) window. If the window currently
    // spans ~the whole work area it is not a real corner size; drop the save so
    // the small corner size survives and break mode can still return to it.
    if let Some(monitor) = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten())
    {
        let work = monitor.work_area();
        if size.width as f64 >= work.size.width as f64 * 0.9
            || size.height as f64 >= work.size.height as f64 * 0.9
        {
            log::info!(
                "save_window_size: ignoring fullscreen-sized save {}x{}",
                size.width,
                size.height
            );
            return Ok(());
        }
    }
    let settings = {
        let mut s = state.0.lock().unwrap();
        s.width = size.width;
        s.height = size.height;
        s.clone()
    };
    settings::persist(&app, &settings)
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
    if let Some(fs) = app.try_state::<FullscreenState>() {
        if let Ok(mut g) = fs.0.lock() {
            *g = fullscreen;
        }
    }
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
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SW_SHOWNOACTIVATE,
            };
            let hwnd = win32_hwnd(&win)?;
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
        // Suppressed, the compact surface is the host's, so this returns to hidden.
        if crate::bridge::compact_suppressed(&app) {
            hide_main(&win);
        }
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
pub fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    win.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())
}
