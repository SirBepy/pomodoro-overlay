use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_kit_settings::KitSettings;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct Settings {
    pub work_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub sessions_before_long_break: u32,
    pub corner: String,
    pub width: u32,
    pub height: u32,
    pub idle_opacity: f32,
    pub sound_enabled: bool,
    pub sound_path: Option<String>,
    pub volume: f32,
    pub autostart: bool,
    pub always_on_top: bool,
    pub auto_start_work: bool,
    pub auto_start_break: bool,
    pub return_to_corner_seconds: u32,
    pub fade_when: String,
    pub reset_on_restart: bool,
    pub editable_when_paused: bool,
    pub ltr_time_entry: bool,
    pub fullscreen_on_break: bool,
    pub keep_awake_during_fullscreen: bool,
    pub pause_music: String,
    pub dnd_on_focus: bool,
    pub click_through_modifier: String,
    pub keybind_pause: Option<String>,
    pub keybind_skip: Option<String>,
    pub keybind_show_hide: Option<String>,
    pub keybind_snooze: Option<String>,
    pub idle_gap_cap_minutes: u32,
    pub stats_retention_days: u32,
    pub meeting_detection_enabled: bool,
    pub hide_from_capture: bool,
    pub meeting_apps: String,
    pub meeting_browsers: String,
    pub keybind_meeting_toggle: Option<String>,
    pub meeting_end_action: String,
    pub meeting_break_fullscreen: bool,
    pub overlay_form: String,
    pub bar_monitor: String,
    pub bar_edge: String,
    pub bar_size: String,
    /// Logical px the user dragged the bar to; 0 = use the `bar_size` preset.
    pub bar_thickness: u32,
    pub hide_when_widget_hosted: bool,
    #[serde(flatten)]
    pub kit: KitSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            sessions_before_long_break: 4,
            corner: "tl".to_string(),
            // Default to the box's minimum size (setup::MIN_BOX_SIZE).
            width: 200,
            height: 160,
            idle_opacity: 0.3,
            sound_enabled: true,
            sound_path: None,
            volume: 0.7,
            autostart: false,
            always_on_top: true,
            auto_start_work: true,
            auto_start_break: true,
            return_to_corner_seconds: 3,
            fade_when: "running".to_string(),
            reset_on_restart: false,
            editable_when_paused: false,
            ltr_time_entry: true,
            fullscreen_on_break: false,
            keep_awake_during_fullscreen: true,
            pause_music: "never".to_string(),
            dnd_on_focus: true,
            click_through_modifier: "alt".to_string(),
            keybind_pause: Some("Alt+Shift+2".to_string()),
            keybind_skip: Some("Alt+Shift+1".to_string()),
            keybind_show_hide: Some("Alt+Shift+4".to_string()),
            keybind_snooze: Some("Alt+Shift+3".to_string()),
            idle_gap_cap_minutes: 240,
            stats_retention_days: 30,
            meeting_detection_enabled: true,
            hide_from_capture: true,
            meeting_apps: tauri_kit_meeting::default_meeting_apps().join(", "),
            meeting_browsers: tauri_kit_meeting::default_browser_apps().join(", "),
            keybind_meeting_toggle: None,
            meeting_end_action: "break".to_string(),
            meeting_break_fullscreen: false,
            overlay_form: "box".to_string(),
            bar_monitor: "secondary".to_string(),
            bar_edge: "top".to_string(),
            bar_size: "medium".to_string(),
            bar_thickness: 0,
            hide_when_widget_hosted: true,
            kit: KitSettings::default(),
        }
    }
}

impl Settings {
    pub fn expanded_size(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

pub struct SettingsState(pub Mutex<Settings>);

const SETTINGS_FILENAME: &str = "settings.json";

pub fn load(app: &AppHandle) -> Settings {
    let mut settings = tauri_kit_settings::load_for::<_, Settings>(app, SETTINGS_FILENAME)
        .unwrap_or_default();
    log::info!("settings loaded; work={}m break={}m", settings.work_minutes, settings.short_break_minutes);

    if let Ok(path) = tauri_kit_settings::paths::settings_path(app, SETTINGS_FILENAME) {
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(raw) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                let has_new_keys =
                    raw.get("auto_start_work").is_some() || raw.get("auto_start_break").is_some();
                if !has_new_keys {
                    if let Some(legacy) = raw.get("auto_advance").and_then(|v| v.as_bool()) {
                        settings.auto_start_work = legacy;
                        settings.auto_start_break = legacy;
                    }
                }
                migrate_renamed_keys(&mut settings, &raw);
            }
        }
    }

    settings
}

/// Carries values stored under a key's old name into the renamed field. The new
/// key wins when both exist, and the old key is gone from disk on the next save
/// because the struct no longer has it.
fn migrate_renamed_keys(settings: &mut Settings, raw: &serde_json::Value) {
    if raw.get("hide_from_capture").is_none() {
        if let Some(v) = raw.get("meeting_hide_from_capture").and_then(|v| v.as_bool()) {
            settings.hide_from_capture = v;
        }
    }
    if raw.get("fullscreen_on_break").is_none() {
        if let Some(v) = raw.get("fullscreen_on_focus_end").and_then(|v| v.as_bool()) {
            settings.fullscreen_on_break = v;
        }
    }
    if raw.get("pause_music").is_none() {
        if let Some(v) = raw.get("pause_music_on_break").and_then(|v| v.as_str()) {
            settings.pause_music = v.to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hide_from_capture_carries_old_key() {
        let mut s = Settings::default();
        migrate_renamed_keys(&mut s, &json!({ "meeting_hide_from_capture": false }));
        assert!(!s.hide_from_capture);
    }

    #[test]
    fn fullscreen_on_break_carries_old_key() {
        let mut s = Settings::default();
        migrate_renamed_keys(&mut s, &json!({ "fullscreen_on_focus_end": true }));
        assert!(s.fullscreen_on_break);
    }

    #[test]
    fn pause_music_carries_old_key() {
        let mut s = Settings::default();
        migrate_renamed_keys(&mut s, &json!({ "pause_music_on_break": "on_break" }));
        assert_eq!(s.pause_music, "on_break");
    }

    #[test]
    fn new_key_present_beats_old_key() {
        let mut s = Settings::default();
        s.pause_music = "never".into();
        migrate_renamed_keys(
            &mut s,
            &json!({ "pause_music": "never", "pause_music_on_break": "on_break" }),
        );
        assert_eq!(s.pause_music, "never");
    }

    #[test]
    fn no_old_keys_leaves_defaults() {
        let mut s = Settings::default();
        migrate_renamed_keys(&mut s, &json!({}));
        assert!(s.hide_from_capture);
        assert!(!s.fullscreen_on_break);
        assert_eq!(s.pause_music, "never");
    }

    #[test]
    fn meeting_break_fullscreen_defaults_off() {
        assert!(!Settings::default().meeting_break_fullscreen);
    }
}

pub fn persist(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let result = tauri_kit_settings::save_for(app, SETTINGS_FILENAME, settings).map_err(|e| e.to_string());
    if result.is_ok() {
        log::info!("settings persisted to disk");
    } else {
        log::warn!("settings persist failed: {:?}", result);
    }
    result
}
