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
    settings::persist(&app, &settings)?;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(settings.always_on_top);
        let (w, h) = settings.pill_size();
        let _ = resize_and_anchor(&win, &settings, w, h);
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
    let (w, h) = if expanded {
        settings.expanded_size()
    } else {
        settings.pill_size()
    };
    resize_and_anchor(&win, &settings, w, h).map_err(|e| e.to_string())
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
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn resize_and_anchor(
    win: &WebviewWindow,
    settings: &Settings,
    w: u32,
    h: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    let monitor = win
        .current_monitor()?
        .or(win.primary_monitor()?)
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let pos = monitor.position();
    let margin = (16.0 * scale) as i32;
    let mw = size.width as i32;
    let mh = size.height as i32;
    let mx = pos.x;
    let my = pos.y;
    let (x, y) = match settings.corner.as_str() {
        "tl" => (mx + margin, my + margin),
        "tr" => (mx + mw - w as i32 - margin, my + margin),
        "bl" => (mx + margin, my + mh - h as i32 - margin),
        _ => (mx + mw - w as i32 - margin, my + mh - h as i32 - margin),
    };
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
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
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
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
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
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = settings::load(&handle);
            apply_autostart(&handle, settings.autostart);
            if let Some(win) = handle.get_webview_window("main") {
                let _ = win.set_always_on_top(settings.always_on_top);
                let (w, h) = settings.pill_size();
                let _ = resize_and_anchor(&win, &settings, w, h);
                let _ = win.show();
            }
            handle.manage(SettingsState(Mutex::new(settings)));
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
            notify,
            pick_sound_file,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
