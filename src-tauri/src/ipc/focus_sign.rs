//! "Working, do not disturb" sign: the single `main` window resized to an edge bar
//! or a corner box on a chosen monitor. Window geometry and show/hide live here;
//! the look and the on/off decision are the frontend's (shared/focus-sign.ts).
use crate::settings::{self, Settings, SettingsState};
use crate::state::{SavedGeometry, SignSavedGeometry, SignState};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// Floor for a top/bottom bar, in physical px, so tiny work areas stay legible.
const MIN_BAR_THICKNESS: u32 = 64;
/// Box inset from the work-area corner, logical px.
const BOX_INSET: f64 = 14.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Sign rect inside a monitor's work area (never the taskbar).
/// Bar top/bottom: full width, thickness a share of the work-area height.
/// Bar left/right: full height, narrow (sized for the horizontal time text).
/// Box: a card inset from the chosen corner. `scale` converts the logical px
/// sizes. Unknown values fall back to bar / top / tl / medium.
pub fn sign_rect(work: Rect, scale: f64, form: &str, edge: &str, corner: &str, size: &str) -> Rect {
    let px = |logical: f64| (logical * scale).round() as u32;
    if form == "box" {
        let (w, h) = match size {
            "small" => (px(240.0), px(140.0)),
            "large" => (px(380.0), px(224.0)),
            _ => (px(300.0), px(176.0)),
        };
        let (w, h) = (w.min(work.w), h.min(work.h));
        let inset = px(BOX_INSET) as i32;
        let left = work.x + inset;
        let right = work.x + work.w as i32 - w as i32 - inset;
        let top = work.y + inset;
        let bottom = work.y + work.h as i32 - h as i32 - inset;
        let (x, y) = match corner {
            "tr" => (right, top),
            "bl" => (left, bottom),
            "br" => (right, bottom),
            _ => (left, top),
        };
        return Rect { x, y, w, h };
    }
    let pct = match size {
        "small" => 10,
        "large" => 18,
        _ => 14,
    };
    let thick = (work.h * pct / 100).max(MIN_BAR_THICKNESS);
    let side_w = match size {
        "small" => px(112.0),
        "large" => px(148.0),
        _ => px(128.0),
    }
    .min(work.w);
    match edge {
        "bottom" => Rect { x: work.x, y: work.y + work.h as i32 - thick as i32, w: work.w, h: thick },
        "left" => Rect { x: work.x, y: work.y, w: side_w, h: work.h },
        "right" => Rect { x: work.x + work.w as i32 - side_w as i32, y: work.y, w: side_w, h: work.h },
        _ => Rect { x: work.x, y: work.y, w: work.w, h: thick },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapTarget {
    Edge(&'static str),
    Corner(&'static str),
}

/// Where a dropped sign settles. Bar: the nearest edge, each distance normalised
/// by the work-area side it is measured along so a wide monitor does not favour
/// top/bottom. Box: the quadrant of the drop point.
pub fn snap_target(form: &str, drop: (f64, f64), work: Rect) -> SnapTarget {
    let (w, h) = (work.w as f64, work.h as f64);
    let (dx, dy) = (drop.0 - work.x as f64, drop.1 - work.y as f64);
    if form == "box" {
        return SnapTarget::Corner(match (dx < w / 2.0, dy < h / 2.0) {
            (true, true) => "tl",
            (false, true) => "tr",
            (true, false) => "bl",
            (false, false) => "br",
        });
    }
    let candidates = [
        ("left", dx / w),
        ("right", (w - dx) / w),
        ("top", dy / h),
        ("bottom", (h - dy) / h),
    ];
    let nearest = candidates
        .iter()
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|c| c.0)
        .unwrap_or("top");
    SnapTarget::Edge(nearest)
}

type MonitorKey = (i32, i32);

/// Picks the monitor (by top-left position) the sign lands on. Resolved at every
/// sign start so an unplugged monitor cannot strand it. `secondary` is the first
/// monitor that is not the primary; with none it falls back to the overlay's.
pub fn resolve_monitor(
    mode: &str,
    monitors: &[MonitorKey],
    primary: Option<MonitorKey>,
    current: Option<MonitorKey>,
) -> Option<MonitorKey> {
    let picked = match mode {
        "primary" => primary.or(current),
        "secondary" => monitors
            .iter()
            .copied()
            .find(|m| Some(*m) != primary)
            .or(current),
        _ => current.or(primary),
    };
    picked.or_else(|| monitors.first().copied())
}

fn monitor_key(m: &tauri::Monitor) -> MonitorKey {
    (m.position().x, m.position().y)
}

pub(crate) fn sign_active(app: &AppHandle) -> bool {
    app.try_state::<SignState>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn set_no_activate(win: &WebviewWindow, on: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    if let Ok(hwnd) = super::window::win32_hwnd(win) {
        unsafe {
            let cur = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let flag = WS_EX_NOACTIVATE as isize;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, if on { cur | flag } else { cur & !flag });
        }
    }
}

/// Show + place + topmost without activating: Tauri's set_size/set_position
/// activate the window, which would steal focus from whatever is being typed in.
fn place_no_activate(win: &WebviewWindow, r: Rect, show: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SW_SHOWNOACTIVATE,
        };
        let hwnd = super::window::win32_hwnd(win)?;
        unsafe {
            if show {
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
            SetWindowPos(hwnd, HWND_TOPMOST, r.x, r.y, r.w as i32, r.h as i32, SWP_NOACTIVATE);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = show;
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
/// call. `overlay_monitor` is where the corner window sat before the sign.
fn target_work(
    win: &WebviewWindow,
    settings: &Settings,
    overlay_monitor: Option<MonitorKey>,
) -> Result<(Rect, f64), String> {
    let monitors = win.available_monitors().map_err(|e| e.to_string())?;
    let keys: Vec<MonitorKey> = monitors.iter().map(monitor_key).collect();
    let primary = win.primary_monitor().ok().flatten().map(|m| monitor_key(&m));
    let target = resolve_monitor(&settings.focus_sign_monitor, &keys, primary, overlay_monitor);
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
    // leave stale saved geometry, a lifted min size or NOACTIVATE behind: exit
    // only restores when the sign was marked active.
    if result.is_err() && !sign_active(app) {
        restore_geometry(app, win);
    }
    result
}

fn try_enter(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    let settings = app.state::<SettingsState>().0.lock().unwrap().clone();

    // Saved once per sign: a settings change or a snap re-enters while the window
    // already sits on the sign, and re-saving then would record the sign as the corner.
    let overlay_monitor = {
        let state = app.state::<SignSavedGeometry>();
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
                // Hidden by host suppression is not the user hiding it; the host's
                // own saved visibility decides whether it comes back.
                visible: win.is_visible().unwrap_or(true) || crate::bridge::compact_suppressed(app),
                placed: (pos.x, pos.y),
            });
        }
        saved.as_ref().and_then(|s| s.monitor)
    };

    let (work, scale) = target_work(win, &settings, overlay_monitor)?;
    let rect = sign_rect(
        work,
        scale,
        &settings.focus_sign_form,
        &settings.focus_sign_edge,
        &settings.focus_sign_corner,
        &settings.focus_sign_size,
    );

    // The corner window's 200x100 floor would clamp a narrow side bar.
    let _ = win.set_min_size(None::<tauri::PhysicalSize<u32>>);
    #[cfg(target_os = "windows")]
    set_no_activate(win, true);
    place_no_activate(win, rect, true)?;
    if let Some(s) = app.state::<SignSavedGeometry>().0.lock().unwrap().as_mut() {
        s.placed = (rect.x, rect.y);
    }
    *app.state::<SignState>().0.lock().unwrap() = true;
    Ok(())
}

/// Takes the pre-sign geometry and puts the window back at it, so the corner
/// anchor that follows resolves against the monitor the overlay came from and
/// not the sign's.
fn restore_geometry(app: &AppHandle, win: &WebviewWindow) -> Option<SavedGeometry> {
    #[cfg(target_os = "windows")]
    set_no_activate(win, false);
    let (mw, mh) = crate::setup::MIN_WINDOW_SIZE;
    let _ = win.set_min_size(Some(tauri::PhysicalSize::new(mw, mh)));
    let saved = app.state::<SignSavedGeometry>().0.lock().unwrap().take();
    if let Some(s) = &saved {
        let _ = place_no_activate(win, Rect { x: s.x, y: s.y, w: s.w, h: s.h }, false);
    }
    saved
}

fn exit(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    // Flag first: resize_and_anchor ignores the window while the sign is up.
    let was_active = std::mem::replace(&mut *app.state::<SignState>().0.lock().unwrap(), false);
    if !was_active {
        return Ok(());
    }
    let saved = restore_geometry(app, win);
    let settings = app.state::<SettingsState>().0.lock().unwrap().clone();
    let (w, h) = settings.expanded_size();
    crate::resize_and_anchor(win, &settings, w, h).map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(settings.always_on_top);
    // Suppressed, the compact surface is the host's, so this returns to hidden
    // (same as leaving the fullscreen break). Also hidden if the user had hidden it.
    if crate::bridge::compact_suppressed(app) || saved.is_some_and(|s| !s.visible) {
        super::window::hide_main(win);
    }
    Ok(())
}

/// Called by the fullscreen break when the sign is up: drops sign state and moves
/// the window back to the corner's monitor in one step, so fullscreen opens on
/// the overlay's monitor with no corner flash in between.
pub(crate) fn hand_off_to_fullscreen(app: &AppHandle, win: &WebviewWindow) {
    let was_active = std::mem::replace(&mut *app.state::<SignState>().0.lock().unwrap(), false);
    if was_active {
        restore_geometry(app, win);
    }
}

#[tauri::command]
pub fn set_focus_sign(app: AppHandle, active: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    if active {
        enter(&app, &win)
    } else {
        exit(&app, &win)
    }
}

/// Polled by the frontend after the sign window moves (the user dragged it with
/// the click-through modifier held). Waits for the mouse button to come up, then
/// snaps to the nearest edge/corner, persists it and re-places the sign.
/// Returns "dragging" (poll again), "idle" (nothing was dragged) or "snapped".
#[tauri::command]
pub fn snap_focus_sign(app: AppHandle) -> Result<String, String> {
    if !sign_active(&app) {
        return Ok("idle".into());
    }
    if left_button_down() {
        return Ok("dragging".into());
    }
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let (placed, overlay_monitor) = match app.state::<SignSavedGeometry>().0.lock().unwrap().as_ref() {
        Some(s) => (s.placed, s.monitor),
        None => return Ok("idle".into()),
    };
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    // Moves the sign itself caused (placement, DPI change) are not drags.
    if (pos.x, pos.y) == placed {
        return Ok("idle".into());
    }
    let settings = app.state::<SettingsState>().0.lock().unwrap().clone();
    let (work, _) = target_work(&win, &settings, overlay_monitor)?;
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let target = snap_target(&settings.focus_sign_form, (cursor.x, cursor.y), work);
    let updated = {
        let state = app.state::<SettingsState>();
        let mut s = state.0.lock().unwrap();
        match target {
            SnapTarget::Edge(e) => s.focus_sign_edge = e.to_string(),
            SnapTarget::Corner(c) => s.focus_sign_corner = c.to_string(),
        }
        s.clone()
    };
    enter(&app, &win)?;
    settings::persist(&app, &updated)?;
    let _ = app.emit("settings-updated", ());
    Ok("snapped".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect { x: 100, y: 50, w: 1920, h: 1000 };
    const SIZES: [&str; 3] = ["small", "medium", "large"];

    fn bar(edge: &str, size: &str) -> Rect {
        sign_rect(WORK, 1.0, "bar", edge, "tl", size)
    }

    #[test]
    fn top_and_bottom_span_full_width_with_a_share_of_the_height() {
        for (size, thick) in [("small", 100), ("medium", 140), ("large", 180)] {
            assert_eq!(bar("top", size), Rect { x: 100, y: 50, w: 1920, h: thick }, "top {size}");
            assert_eq!(
                bar("bottom", size),
                Rect { x: 100, y: 50 + 1000 - thick as i32, w: 1920, h: thick },
                "bottom {size}"
            );
        }
    }

    #[test]
    fn side_bars_span_full_height_and_stay_narrow() {
        for (size, w) in [("small", 112), ("medium", 128), ("large", 148)] {
            assert_eq!(bar("left", size), Rect { x: 100, y: 50, w, h: 1000 }, "left {size}");
            assert_eq!(
                bar("right", size),
                Rect { x: 100 + 1920 - w as i32, y: 50, w, h: 1000 },
                "right {size}"
            );
        }
    }

    #[test]
    fn side_bar_width_follows_the_display_scale() {
        let r = sign_rect(WORK, 1.5, "bar", "left", "tl", "medium");
        assert_eq!(r.w, 192);
    }

    #[test]
    fn box_sits_inset_in_each_corner_at_each_size() {
        for (size, bw, bh) in [("small", 240, 140), ("medium", 300, 176), ("large", 380, 224)] {
            let at = |corner: &str| sign_rect(WORK, 1.0, "box", "top", corner, size);
            assert_eq!(at("tl"), Rect { x: 114, y: 64, w: bw, h: bh }, "tl {size}");
            assert_eq!(at("tr"), Rect { x: 100 + 1920 - bw as i32 - 14, y: 64, w: bw, h: bh }, "tr {size}");
            assert_eq!(at("bl"), Rect { x: 114, y: 50 + 1000 - bh as i32 - 14, w: bw, h: bh }, "bl {size}");
            assert_eq!(
                at("br"),
                Rect { x: 100 + 1920 - bw as i32 - 14, y: 50 + 1000 - bh as i32 - 14, w: bw, h: bh },
                "br {size}"
            );
        }
    }

    #[test]
    fn box_ignores_the_edge_and_bar_ignores_the_corner() {
        for size in SIZES {
            assert_eq!(
                sign_rect(WORK, 1.0, "box", "left", "br", size),
                sign_rect(WORK, 1.0, "box", "top", "br", size)
            );
            assert_eq!(
                sign_rect(WORK, 1.0, "bar", "left", "br", size),
                sign_rect(WORK, 1.0, "bar", "left", "tl", size)
            );
        }
    }

    #[test]
    fn top_bar_never_drops_below_the_floor() {
        let short = Rect { x: 0, y: 0, w: 1280, h: 400 };
        assert_eq!(sign_rect(short, 1.0, "bar", "top", "tl", "small").h, MIN_BAR_THICKNESS);
    }

    #[test]
    fn unknown_values_fall_back_to_top_bar_medium() {
        assert_eq!(
            sign_rect(WORK, 1.0, "blob", "diagonal", "zz", "huge"),
            sign_rect(WORK, 1.0, "bar", "top", "tl", "medium")
        );
    }

    #[test]
    fn bar_drop_snaps_to_the_nearest_edge() {
        let snap = |p: (f64, f64)| snap_target("bar", p, WORK);
        assert_eq!(snap((1000.0, 60.0)), SnapTarget::Edge("top"));
        assert_eq!(snap((1000.0, 1040.0)), SnapTarget::Edge("bottom"));
        assert_eq!(snap((105.0, 500.0)), SnapTarget::Edge("left"));
        assert_eq!(snap((2015.0, 500.0)), SnapTarget::Edge("right"));
    }

    #[test]
    fn bar_snap_normalises_distance_by_each_side() {
        // 300px from the left is 15.6% of the width, 200px from the top is 20% of
        // the height: left is nearer even though its pixel distance is larger.
        assert_eq!(snap_target("bar", (400.0, 250.0), WORK), SnapTarget::Edge("left"));
    }

    #[test]
    fn box_drop_snaps_to_the_quadrant() {
        let snap = |p: (f64, f64)| snap_target("box", p, WORK);
        assert_eq!(snap((200.0, 100.0)), SnapTarget::Corner("tl"));
        assert_eq!(snap((1900.0, 100.0)), SnapTarget::Corner("tr"));
        assert_eq!(snap((200.0, 1000.0)), SnapTarget::Corner("bl"));
        assert_eq!(snap((1900.0, 1000.0)), SnapTarget::Corner("br"));
    }

    const PRIMARY: MonitorKey = (0, 0);
    const SECOND: MonitorKey = (1920, 0);

    #[test]
    fn overlay_mode_uses_the_corner_monitor() {
        let got = resolve_monitor("overlay", &[PRIMARY, SECOND], Some(PRIMARY), Some(SECOND));
        assert_eq!(got, Some(SECOND));
    }

    #[test]
    fn primary_mode_uses_the_primary_even_when_overlay_is_elsewhere() {
        let got = resolve_monitor("primary", &[PRIMARY, SECOND], Some(PRIMARY), Some(SECOND));
        assert_eq!(got, Some(PRIMARY));
    }

    #[test]
    fn secondary_mode_skips_the_primary_wherever_it_sits_in_the_list() {
        for list in [[SECOND, PRIMARY], [PRIMARY, SECOND]] {
            let got = resolve_monitor("secondary", &list, Some(PRIMARY), Some(PRIMARY));
            assert_eq!(got, Some(SECOND), "{list:?}");
        }
    }

    #[test]
    fn secondary_with_one_monitor_falls_back_to_overlay() {
        let got = resolve_monitor("secondary", &[PRIMARY], Some(PRIMARY), Some(PRIMARY));
        assert_eq!(got, Some(PRIMARY));
    }

    #[test]
    fn no_candidates_at_all_falls_back_to_the_first_monitor() {
        assert_eq!(resolve_monitor("overlay", &[SECOND], None, None), Some(SECOND));
        assert_eq!(resolve_monitor("overlay", &[], None, None), None);
    }
}
