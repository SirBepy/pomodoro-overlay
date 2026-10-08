mod bridge;
mod hotkeys;
mod ipc;
mod settings;
mod setup;
mod state;
mod stats;
mod tray;

use bridge::report_timer_state;
use ipc::dnd::{disable_dnd, enable_dnd};
use ipc::media::{media_pause_if_playing, media_resume};
use ipc::settings::{get_settings, pick_sound_file, save_settings};
use ipc::system::{
    disable_keep_awake, enable_keep_awake, get_version_info, is_modifier_held, quit_app,
};
use ipc::window::{
    get_corner_position, is_cursor_over_window, open_settings_window, save_window_size,
    set_click_through, set_window_fullscreen, set_window_position, set_window_size,
    show_main_window, start_resize,
};
use ipc::stats::{
    append_stats_event, close_open_stats_event, get_stats_range, heartbeat_stats, reset_stats,
};
use settings::{Settings, SettingsState};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;

pub(crate) fn compute_corner_position(
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

pub(crate) fn resize_and_anchor(
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

pub(crate) fn apply_autostart(app: &AppHandle, enabled: bool) {
    let mgr = app.autolaunch();
    if enabled {
        let _ = mgr.enable();
    } else {
        let _ = mgr.disable();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if bridge::compact_suppressed(app) {
                return;
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_kit_updater::plugin())
        .plugin(tauri_kit_meeting::plugin(tauri_kit_meeting::MeetingConfig::default()))
        .plugin(tauri_kit_settings::with_logging())
        .setup(setup::setup)
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_version_info,
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
            enable_keep_awake,
            disable_keep_awake,
            set_click_through,
            is_modifier_held,
            append_stats_event,
            close_open_stats_event,
            get_stats_range,
            reset_stats,
            heartbeat_stats,
            report_timer_state,
            tauri_kit_settings::kit_copy_logs,
            tauri_kit_settings::kit_reset_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                stats::close_open_on_startup(app, now_ms);
                {
                    let settings = app.state::<SettingsState>();
                    let days = settings.0.lock().map(|s| s.stats_retention_days).unwrap_or(30);
                    stats::prune_old_events(app, days, now_ms);
                }
            }
        });
}
