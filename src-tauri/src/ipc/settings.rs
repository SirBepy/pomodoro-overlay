use crate::settings::{self, Settings, SettingsState};
use crate::{apply_autostart, resize_and_anchor};
use tauri::{AppHandle, Manager, State};

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
    let (old_pause, old_skip, old_show_hide, old_meeting, old_snooze) = {
        let s = state.0.lock().unwrap();
        (
            s.keybind_pause.clone(),
            s.keybind_skip.clone(),
            s.keybind_show_hide.clone(),
            s.keybind_meeting_toggle.clone(),
            s.keybind_snooze.clone(),
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
    // hide_when_widget_hosted may have flipped while a host is connected.
    crate::bridge::reconcile_suppression(&app);
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
    tauri_kit_meeting::set_browsers(
        &app,
        settings
            .meeting_browsers
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
        old_snooze.as_deref(),
        settings.keybind_pause.as_deref(),
        settings.keybind_skip.as_deref(),
        settings.keybind_show_hide.as_deref(),
        settings.keybind_meeting_toggle.as_deref(),
        settings.keybind_snooze.as_deref(),
    );
    Ok(())
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
