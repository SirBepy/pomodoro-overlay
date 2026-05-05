#![windows_subsystem = "windows"]

mod commands;
mod settings;

use commands::{
    disable_dnd, enable_dnd, get_corner_position, get_settings, is_cursor_over_window,
    media_pause_if_playing, media_resume, open_settings_window, pick_sound_file, quit_app,
    save_settings, save_window_size, set_window_fullscreen, set_window_position, set_window_size,
    show_main_window, start_resize,
};
use settings::{Settings, SettingsState};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt;

pub(crate) struct PausedSessionsState(pub(crate) std::sync::Mutex<Vec<String>>);
pub(crate) struct DndState(pub(crate) std::sync::Mutex<Option<Vec<u8>>>);

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
            #[cfg(target_os = "windows")]
            {
                if let Some(p) = app.path().app_local_data_dir().ok().map(|d| d.join("dnd_backup.bin")) {
                    if p.exists() {
                        match std::fs::read(&p) {
                            Ok(blob) if !blob.is_empty() => {
                                if commands::recover_dnd_backup(&blob) {
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
