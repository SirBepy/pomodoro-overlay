use super::bar_geometry::is_side_edge;
use crate::settings::{self, Settings, SettingsState};
use crate::{apply_autostart, resize_and_anchor};
use tauri::{AppHandle, Manager, State};

/// The settings window has no thickness field and saves the whole object it
/// loaded, so its copy of `bar_thickness` is stale after a hand resize: keep the
/// live one. Picking a different size preset replaces a hand-dragged thickness,
/// or the select would appear to do nothing; so does moving between a top/bottom
/// and a left/right bar, whose thickness ranges differ.
fn carry_bar_thickness(current: &Settings, incoming: &mut Settings) {
    let same_shape = current.bar_size == incoming.bar_size
        && is_side_edge(&current.bar_edge) == is_side_edge(&incoming.bar_edge);
    incoming.bar_thickness = if same_shape { current.bar_thickness } else { 0 };
}

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
    let mut settings = settings;
    {
        let mut s = state.0.lock().unwrap();
        carry_bar_thickness(&s, &mut settings);
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
        let _ = tauri_kit_window::exclude_from_capture(&win, settings.hide_from_capture);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn with(size: &str, edge: &str, thickness: u32) -> Settings {
        Settings {
            bar_size: size.into(),
            bar_edge: edge.into(),
            bar_thickness: thickness,
            ..Settings::default()
        }
    }

    #[test]
    fn a_stale_settings_window_cannot_overwrite_a_dragged_thickness() {
        let mut incoming = with("medium", "top", 0);
        carry_bar_thickness(&with("medium", "top", 80), &mut incoming);
        assert_eq!(incoming.bar_thickness, 80);
    }

    #[test]
    fn picking_another_size_preset_drops_the_dragged_thickness() {
        let mut incoming = with("large", "top", 80);
        carry_bar_thickness(&with("medium", "top", 80), &mut incoming);
        assert_eq!(incoming.bar_thickness, 0);
    }

    #[test]
    fn switching_between_top_and_side_drops_it_but_top_to_bottom_keeps_it() {
        let mut to_side = with("medium", "left", 80);
        carry_bar_thickness(&with("medium", "top", 80), &mut to_side);
        assert_eq!(to_side.bar_thickness, 0);

        let mut to_bottom = with("medium", "bottom", 0);
        carry_bar_thickness(&with("medium", "top", 80), &mut to_bottom);
        assert_eq!(to_bottom.bar_thickness, 80);
    }
}
