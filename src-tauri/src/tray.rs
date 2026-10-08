use crate::bridge;
use crate::ipc;
use crate::ipc::window::open_settings_window;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

fn dimmed_icon(icon: &Image) -> Image<'static> {
    let mut rgba = icon.rgba().to_vec();
    for i in (3..rgba.len()).step_by(4) {
        rgba[i] = rgba[i] / 2;
    }
    Image::new_owned(rgba, icon.width(), icon.height())
}

/// Toggle the main overlay window between shown and hidden.
///
/// Emits `main-window-hidden` / `main-window-shown` so the frontend can run its
/// side effects (keep-awake, etc.), and dims the tray icon while hidden. Shared
/// by the tray left-click and the show/hide global hotkey so both behave alike.
pub fn toggle_main_visibility(app: &AppHandle) {
    // Dead while a widget host owns the compact surface, so the tray icon also
    // never dims into looking like the app is off while it is really running.
    if bridge::compact_suppressed(app) {
        return;
    }
    let Some(w) = app.get_webview_window("main") else { return };
    let visible = w.is_visible().unwrap_or(false);
    if visible {
        ipc::window::hide_main(&w);
        let _ = app.emit("main-window-hidden", ());
    } else {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("main-window-shown", ());
    }
    if let Some(t) = app.tray_by_id("main-tray") {
        let base = app
            .default_window_icon()
            .cloned()
            .unwrap_or_else(|| Image::from_bytes(include_bytes!("../icons/32x32.png")).unwrap());
        let icon = if visible { dimmed_icon(&base) } else { base };
        let _ = t.set_icon(Some(icon));
    }
}

pub(crate) fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&dashboard_item, &quit],
    )?;

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
            "dashboard" => {
                let _ = open_settings_window(app.clone(), Some("dashboard".into()));
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
                toggle_main_visibility(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
