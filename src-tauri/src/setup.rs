use crate::settings::{self, SettingsState};
use crate::state::{
    BarSavedGeometry, BarState, DndState, FullscreenState, HostSuppressionState, HostWantsState,
    PausedSessionsState,
};
use crate::stats::{self, StatsState};
use crate::{apply_autostart, bridge, hotkeys, resize_and_anchor, tray};
use std::sync::Mutex;
use tauri::{App, AppHandle, LogicalSize, Manager, WebviewWindow};

/// Smallest box (logical px) where the three phase tabs, the digits and START all
/// fit at once, so none of them has to hide on hover. The bar form lifts it while
/// up (a narrow side bar is below it) and puts it back after.
pub(crate) const MIN_BOX_SIZE: (u32, u32) = (200, 160);

pub(crate) fn apply_box_min_size(win: &WebviewWindow) {
    let _ = win.set_min_size(Some(LogicalSize::new(
        MIN_BOX_SIZE.0 as f64,
        MIN_BOX_SIZE.1 as f64,
    )));
}

/// Raises a stored box size (physical px) to the minimum at this display scale.
/// Sizes saved before the minimum grew would otherwise anchor a corner with a
/// height the OS then refuses to give the window.
pub(crate) fn clamp_box_size(w: u32, h: u32, scale: f64) -> (u32, u32) {
    let floor = |logical: u32| (logical as f64 * scale).round() as u32;
    (w.max(floor(MIN_BOX_SIZE.0)), h.max(floor(MIN_BOX_SIZE.1)))
}

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let settings = settings::load(&handle);
    log::info!("app started; version={}", env!("CARGO_PKG_VERSION"));
    apply_autostart(&handle, settings.autostart);
    tauri_kit_meeting::set_apps(
        &handle,
        settings
            .meeting_apps
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
    );
    tauri_kit_meeting::set_browsers(
        &handle,
        settings
            .meeting_browsers
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
    );
    hotkeys::register_hotkeys(
        &handle,
        None,
        None,
        None,
        None,
        None,
        settings.keybind_pause.as_deref(),
        settings.keybind_skip.as_deref(),
        settings.keybind_show_hide.as_deref(),
        settings.keybind_meeting_toggle.as_deref(),
        settings.keybind_snooze.as_deref(),
    );
    if let Some(win) = handle.get_webview_window("main") {
        let (w, h) = settings.expanded_size();
        let _ = resize_and_anchor(&win, &settings, w, h);
        let _ = win.set_always_on_top(settings.always_on_top);
        apply_box_min_size(&win);
        let _ = win.show();
        let _ = tauri_kit_window::exclude_from_capture(&win, settings.meeting_hide_from_capture);
    }
    handle.manage(SettingsState(Mutex::new(settings)));
    handle.manage(PausedSessionsState(std::sync::Mutex::new(Vec::new())));
    handle.manage(DndState(std::sync::Mutex::new(None)));
    handle.manage(StatsState(std::sync::Mutex::new(stats::load(&handle))));
    handle.manage(HostSuppressionState(std::sync::Mutex::new(None)));
    handle.manage(FullscreenState(std::sync::Mutex::new(false)));
    handle.manage(HostWantsState(std::sync::Mutex::new(false)));
    handle.manage(BarState(std::sync::Mutex::new(false)));
    handle.manage(BarSavedGeometry(std::sync::Mutex::new(None)));

    let bridge_state = bridge::new_state();
    let bridge_tx = bridge_state.0.clone();
    handle.manage(bridge_state);
    tauri::async_runtime::spawn(bridge::run_server(
        handle.clone(),
        bridge_tx,
        bridge::generate_token(),
    ));

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    stats::close_open_on_startup(&handle, now_ms);
    {
        let settings = handle.state::<SettingsState>();
        let days = settings.0.lock().map(|s| s.stats_retention_days).unwrap_or(30);
        stats::prune_old_events(&handle, days, now_ms);
    }
    #[cfg(target_os = "windows")]
    recover_dnd_backup(app);
    if let Err(e) = tray::build_tray(&handle) {
        eprintln!("failed to build tray: {e}");
    }
    #[cfg(debug_assertions)]
    spawn_vite_watcher(handle.clone());
    Ok(())
}

#[cfg(target_os = "windows")]
fn recover_dnd_backup(app: &App) {
    if let Some(p) = app.path().app_local_data_dir().ok().map(|d| d.join("dnd_backup.bin")) {
        if p.exists() {
            match std::fs::read(&p) {
                Ok(blob) if !blob.is_empty() => {
                    if crate::ipc::dnd::recover_dnd_backup(&blob) {
                        log::info!(
                            "dnd: recovered registry from prior session backup"
                        );
                    } else {
                        log::warn!(
                            "dnd: backup recovery failed to write CloudStore blob"
                        );
                    }
                }
                Ok(_) => log::warn!("dnd: backup file empty; skipping"),
                Err(e) => log::warn!("dnd: failed to read backup: {e}"),
            }
            let _ = std::fs::remove_file(&p);
        }
    }
}

#[cfg(debug_assertions)]
fn spawn_vite_watcher(dev_handle: AppHandle) {
    std::thread::spawn(move || {
        // Wait for Vite to finish starting before we begin watching
        std::thread::sleep(std::time::Duration::from_secs(8));
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let vite_up = |timeout_ms: u64| {
                let t = std::time::Duration::from_millis(timeout_ms);
                std::net::TcpStream::connect_timeout(&"127.0.0.1:3001".parse().unwrap(), t).is_ok()
                || std::net::TcpStream::connect_timeout(&"[::1]:3001".parse().unwrap(), t).is_ok()
            };
            let alive = vite_up(500);
            if !alive {
                // Double-check before exiting (Vite may be momentarily restarting)
                std::thread::sleep(std::time::Duration::from_secs(3));
                let still_dead = !vite_up(500);
                if still_dead {
                    dev_handle.exit(0);
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stored_size_below_the_minimum_is_raised_to_it() {
        // The pre-minimum default was 200x100.
        assert_eq!(clamp_box_size(200, 100, 1.0), MIN_BOX_SIZE);
    }

    #[test]
    fn a_larger_stored_size_is_kept() {
        assert_eq!(clamp_box_size(320, 240, 1.0), (320, 240));
    }

    #[test]
    fn the_minimum_scales_with_the_display() {
        assert_eq!(clamp_box_size(10, 10, 1.5), (300, 240));
    }

    #[test]
    fn each_axis_is_clamped_on_its_own() {
        assert_eq!(clamp_box_size(500, 100, 1.0), (500, MIN_BOX_SIZE.1));
        assert_eq!(clamp_box_size(100, 500, 1.0), (MIN_BOX_SIZE.0, 500));
    }
}
