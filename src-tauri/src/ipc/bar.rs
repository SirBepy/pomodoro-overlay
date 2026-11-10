//! The overlay's bar form: the single `main` window resized to an edge strip on a
//! chosen monitor. Window geometry lives here; the look, the on/off decision and
//! the phase-driven content are the frontend's (shared/overlay-bar.ts).
use crate::settings::{self, Settings, SettingsState};
use super::bar_geometry::{
    bar_rect, bar_thickness, is_side_edge, resolve_monitor, snap_target, thickness_from_extent,
    MonitorKey, Rect, SIDE_THICKNESS_RANGE, THICKNESS_RANGE,
};
use crate::state::{BarSavedGeometry, BarState, SavedGeometry};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewWindow};

fn monitor_key(m: &tauri::Monitor) -> MonitorKey {
    (m.position().x, m.position().y)
}

pub(crate) fn bar_active(app: &AppHandle) -> bool {
    app.try_state::<BarState>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

/// Place + topmost without activating (Tauri's set_size/set_position activate the
/// window, which would steal focus from whatever is being typed in). Never shows
/// a hidden window: the bar is visible exactly when the box would be. Clicking the
/// bar still activates it, so click-to-edit time can take keystrokes like the box.
///
/// Placing the window on a monitor with a different scale than it came from makes
/// Windows send WM_DPICHANGED, and tao answers by rescaling the window by the DPI
/// ratio, so the size just set comes out e.g. 1.5x too big (the "huge bar" on a
/// 150% secondary monitor). The window is already on the right monitor by the
/// second call, where no DPI change happens and the size sticks.
fn place_no_activate(win: &WebviewWindow, r: Rect) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE,
        };
        let hwnd = super::window::win32_hwnd(win)?;
        for _ in 0..3 {
            unsafe {
                SetWindowPos(hwnd, HWND_TOPMOST, r.x, r.y, r.w as i32, r.h as i32, SWP_NOACTIVATE);
            }
            match win.outer_size() {
                Ok(s) if (s.width, s.height) != (r.w, r.h) => continue,
                _ => return Ok(()),
            }
        }
        log::warn!("bar placement: window size never settled on {}x{}", r.w, r.h);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        win.set_size(tauri::PhysicalSize::new(r.w, r.h)).map_err(|e| e.to_string())?;
        win.set_position(tauri::PhysicalPosition::new(r.x, r.y)).map_err(|e| e.to_string())
    }
}

fn left_button_down() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        unsafe { (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0 }
    }
    #[cfg(not(target_os = "windows"))]
    false
}

/// Work area (and scale) of the monitor the settings pick, re-resolved on every
/// call. `overlay_monitor` is where the box sat before the bar.
fn target_work(
    win: &WebviewWindow,
    settings: &Settings,
    overlay_monitor: Option<MonitorKey>,
) -> Result<(Rect, f64), String> {
    let monitors = win.available_monitors().map_err(|e| e.to_string())?;
    let keys: Vec<MonitorKey> = monitors.iter().map(monitor_key).collect();
    let primary = win.primary_monitor().ok().flatten().map(|m| monitor_key(&m));
    let target = resolve_monitor(&settings.bar_monitor, &keys, primary, overlay_monitor);
    let monitor = monitors
        .iter()
        .find(|m| Some(monitor_key(m)) == target)
        .ok_or_else(|| "no monitor".to_string())?;
    let work = monitor.work_area();
    let rect = Rect { x: work.position.x, y: work.position.y, w: work.size.width, h: work.size.height };
    Ok((rect, monitor.scale_factor()))
}

fn enter(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    let result = try_enter(app, win);
    // A failed first placement (e.g. a monitor unplugged mid-resolve) must not
    // leave stale saved geometry or a lifted min size behind: exit
    // only restores when the bar was marked active.
    if result.is_err() && !bar_active(app) {
        restore_geometry(app, win);
    }
    result
}

fn try_enter(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    let settings = app.state::<SettingsState>().0.lock().unwrap().clone();

    // Saved once per bar: a settings change or a snap re-enters while the window
    // already is the bar, and re-saving then would record the bar as the box.
    let overlay_monitor = {
        let state = app.state::<BarSavedGeometry>();
        let mut saved = state.0.lock().unwrap();
        if saved.is_none() {
            let pos = win.outer_position().map_err(|e| e.to_string())?;
            let size = win.outer_size().map_err(|e| e.to_string())?;
            *saved = Some(SavedGeometry {
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
                monitor: win.current_monitor().ok().flatten().map(|m| monitor_key(&m)),
                placed: (pos.x, pos.y),
            });
        }
        saved.as_ref().and_then(|s| s.monitor)
    };

    let (work, scale) = target_work(win, &settings, overlay_monitor)?;
    let rect = bar_rect(work, scale, &settings.bar_edge, &settings.bar_size, settings.bar_thickness);

    // The box's minimum size would clamp a narrow side bar, and the previous
    // bar's limits (another edge) would clamp this one.
    let _ = win.set_min_size(None::<tauri::PhysicalSize<u32>>);
    let _ = win.set_max_size(None::<tauri::PhysicalSize<u32>>);
    place_no_activate(win, rect)?;
    limit_thickness(win, &settings.bar_edge, rect, scale);
    if let Some(s) = app.state::<BarSavedGeometry>().0.lock().unwrap().as_mut() {
        s.placed = (rect.x, rect.y);
    }
    *app.state::<BarState>().0.lock().unwrap() = true;
    Ok(())
}

/// Pins the bar to its edge so a hand resize can only change its thickness, and
/// only within the allowed range. The length axis is locked to the work area
/// (1 px of slack for the logical/physical rounding).
fn limit_thickness(win: &WebviewWindow, edge: &str, rect: Rect, scale: f64) {
    let (len_w, len_h) = (rect.w as f64 / scale, rect.h as f64 / scale);
    let ((min_w, min_h), (max_w, max_h)) = if is_side_edge(edge) {
        let (lo, hi) = SIDE_THICKNESS_RANGE;
        ((lo as f64, len_h.floor() - 1.0), (hi as f64, len_h.ceil() + 1.0))
    } else {
        let (lo, hi) = THICKNESS_RANGE;
        ((len_w.floor() - 1.0, lo as f64), (len_w.ceil() + 1.0, hi as f64))
    };
    let _ = win.set_min_size(Some(LogicalSize::new(min_w, min_h)));
    let _ = win.set_max_size(Some(LogicalSize::new(max_w, max_h)));
}

/// Persists the thickness the user dragged the bar to (the frontend calls this
/// after a resize settles), then re-places the bar at the clamped value. A resize
/// that matches the current thickness (including our own placement) is ignored.
pub(crate) fn save_thickness(app: &AppHandle) -> Result<(), String> {
    if !bar_active(app) {
        return Ok(());
    }
    // Re-placing the window mid-drag would fight the OS resize loop: wait for the
    // button, then look at where the drag ended. One waiter at a time.
    if left_button_down() {
        if !WAITING_FOR_RELEASE.swap(true, Ordering::SeqCst) {
            let app = app.clone();
            std::thread::spawn(move || {
                while left_button_down() {
                    std::thread::sleep(Duration::from_millis(80));
                }
                WAITING_FOR_RELEASE.store(false, Ordering::SeqCst);
                let _ = save_thickness(&app);
            });
        }
        return Ok(());
    }
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let Some(dragged) = dragged_thickness(app, &win)? else {
        return Ok(());
    };
    // The window may have just been handed to the fullscreen break or the box, and
    // its size then says nothing about the bar.
    if !bar_active(app) {
        return Ok(());
    }
    let updated = {
        let state = app.state::<SettingsState>();
        let mut s = state.0.lock().unwrap();
        s.bar_thickness = dragged;
        s.clone()
    };
    settings::persist(app, &updated)?;
    // The waiter thread gets here after a delay: a switch to the box or the
    // fullscreen hand-off in between must not be undone by re-entering the bar.
    if bar_active(app) {
        enter(app, &win)?;
    }
    let _ = app.emit("settings-updated", ());
    Ok(())
}

static WAITING_FOR_RELEASE: AtomicBool = AtomicBool::new(false);

/// The thickness the window has now when it differs from the one placed (by more
/// than rounding), i.e. the user dragged an edge. None for our own placement.
fn dragged_thickness(app: &AppHandle, win: &WebviewWindow) -> Result<Option<u32>, String> {
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let s = app.state::<SettingsState>().0.lock().unwrap().clone();
    let extent = if is_side_edge(&s.bar_edge) { size.width } else { size.height };
    let dragged = thickness_from_extent(&s.bar_edge, extent, scale);
    let current = bar_thickness(&s.bar_edge, &s.bar_size, s.bar_thickness);
    Ok((dragged.abs_diff(current) > 1).then_some(dragged))
}

/// Takes the pre-bar geometry and puts the window back at it, so the corner
/// anchor that follows resolves against the monitor the overlay came from and
/// not the bar's.
fn restore_geometry(app: &AppHandle, win: &WebviewWindow) -> Option<SavedGeometry> {
    crate::setup::apply_box_min_size(win);
    let saved = app.state::<BarSavedGeometry>().0.lock().unwrap().take();
    if let Some(s) = &saved {
        let _ = place_no_activate(win, Rect { x: s.x, y: s.y, w: s.w, h: s.h });
    }
    saved
}

fn exit(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    // Flag first: resize_and_anchor ignores the window while the bar is up.
    let was_active = std::mem::replace(&mut *app.state::<BarState>().0.lock().unwrap(), false);
    if !was_active {
        return Ok(());
    }
    restore_geometry(app, win);
    let settings = app.state::<SettingsState>().0.lock().unwrap().clone();
    let (w, h) = settings.expanded_size();
    crate::resize_and_anchor(win, &settings, w, h).map_err(|e| e.to_string())?;
    // The bar was placed topmost behind tao's back; toggling on first makes the
    // set below a real change even when always_on_top is off.
    let _ = win.set_always_on_top(true);
    let _ = win.set_always_on_top(settings.always_on_top);
    // Placing never changes visibility, so a window hidden by the tray or the
    // widget host is still hidden here and stays that way.
    Ok(())
}

/// Called by the fullscreen break when the bar is up: drops bar state and moves
/// the window back to the box's monitor in one step, so fullscreen opens on the
/// overlay's monitor with no flash in between.
pub(crate) fn hand_off_to_fullscreen(app: &AppHandle, win: &WebviewWindow) {
    let was_active = std::mem::replace(&mut *app.state::<BarState>().0.lock().unwrap(), false);
    if was_active {
        restore_geometry(app, win);
    }
}

/// Puts the bar back after the fullscreen break when the form is "bar", in the
/// same command as the box restore so the box is not left on screen between.
pub(crate) fn return_from_fullscreen(app: &AppHandle, win: &WebviewWindow) {
    let bar_form = app.state::<SettingsState>().0.lock().unwrap().overlay_form == "bar";
    if bar_form {
        let _ = enter(app, win);
    }
}

#[tauri::command]
pub fn set_overlay_bar(app: AppHandle, active: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    if active {
        enter(&app, &win)
    } else {
        exit(&app, &win)
    }
}

/// Polled by the frontend after the bar window moves (the user dragged it).
/// Waits for the mouse button to come up, then snaps to the nearest edge,
/// persists it and re-places the bar. Returns "dragging" (poll again), "idle"
/// (nothing was dragged) or "snapped".
#[tauri::command]
pub fn snap_overlay_bar(app: AppHandle) -> Result<String, String> {
    if !bar_active(&app) {
        return Ok("idle".into());
    }
    if left_button_down() {
        return Ok("dragging".into());
    }
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let (placed, overlay_monitor) = match app.state::<BarSavedGeometry>().0.lock().unwrap().as_ref() {
        Some(s) => (s.placed, s.monitor),
        None => return Ok("idle".into()),
    };
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    // Moves the bar itself caused (placement, DPI change) are not drags.
    if (pos.x, pos.y) == placed {
        return Ok("idle".into());
    }
    // Dragging the inner edge of a bottom/right bar also moves the window; that is
    // a thickness change, not a move to a new edge.
    if dragged_thickness(&app, &win)?.is_some() {
        save_thickness(&app)?;
        return Ok("idle".into());
    }
    let settings = app.state::<SettingsState>().0.lock().unwrap().clone();
    let (work, _) = target_work(&win, &settings, overlay_monitor)?;
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let edge = snap_target((cursor.x, cursor.y), work);
    let updated = {
        let state = app.state::<SettingsState>();
        let mut s = state.0.lock().unwrap();
        // A top/bottom thickness means nothing on a side bar (other range).
        if is_side_edge(&s.bar_edge) != is_side_edge(edge) {
            s.bar_thickness = 0;
        }
        s.bar_edge = edge.to_string();
        s.clone()
    };
    enter(&app, &win)?;
    settings::persist(&app, &updated)?;
    let _ = app.emit("settings-updated", ());
    Ok("snapped".into())
}
