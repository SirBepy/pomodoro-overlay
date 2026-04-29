use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Settings {
    pub work_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub sessions_before_long_break: u32,
    pub corner: String,
    pub size: String,
    pub hide_until_one_minute: bool,
    pub auto_collapse: bool,
    pub sound_enabled: bool,
    pub sound_path: Option<String>,
    pub volume: f32,
    pub autostart: bool,
    pub always_on_top: bool,
    pub auto_advance: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            sessions_before_long_break: 4,
            corner: "br".to_string(),
            size: "m".to_string(),
            hide_until_one_minute: false,
            auto_collapse: true,
            sound_enabled: true,
            sound_path: None,
            volume: 0.7,
            autostart: false,
            always_on_top: true,
            auto_advance: true,
        }
    }
}

impl Settings {
    pub fn pill_size(&self) -> (u32, u32) {
        match self.size.as_str() {
            "s" => (220, 64),
            "l" => (340, 96),
            _ => (280, 80),
        }
    }

    pub fn expanded_size(&self) -> (u32, u32) {
        match self.size.as_str() {
            "s" => (280, 360),
            "l" => (380, 480),
            _ => (320, 420),
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn config_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_config_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(_) => return Settings::default(),
    };
    if !path.exists() {
        return Settings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok())
        .unwrap_or_default()
}

pub fn persist(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = config_path(app).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}
