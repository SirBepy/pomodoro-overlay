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
    pub auto_collapse: bool,
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
    pub fullscreen_on_focus_end: bool,
    pub keep_awake_during_fullscreen: bool,
    pub pause_music_on_break: String,
    pub dnd_on_focus: bool,
    pub click_through_modifier: String,
    pub keybind_pause: Option<String>,
    pub keybind_skip: Option<String>,
    pub keybind_show_hide: Option<String>,
    pub idle_gap_cap_minutes: u32,
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
            // Default to the window's minimum size (see set_min_size in lib.rs).
            width: 200,
            height: 100,
            idle_opacity: 0.3,
            auto_collapse: true,
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
            fullscreen_on_focus_end: false,
            keep_awake_during_fullscreen: true,
            pause_music_on_break: "never".to_string(),
            dnd_on_focus: true,
            click_through_modifier: "alt".to_string(),
            keybind_pause: None,
            keybind_skip: None,
            keybind_show_hide: None,
            idle_gap_cap_minutes: 240,
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
            }
        }
    }

    settings
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
