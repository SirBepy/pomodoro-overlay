use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Re-registers global hotkeys for pause and skip.
///
/// Pass old_* = the shortcuts previously registered (to unregister them).
/// Pass new_* = the shortcuts to register now (None = no binding).
/// Silent on failure: if another app holds the combo, we log and move on.
pub fn register_hotkeys(
    app: &AppHandle,
    old_pause: Option<&str>,
    old_skip: Option<&str>,
    new_pause: Option<&str>,
    new_skip: Option<&str>,
) {
    let gs = app.global_shortcut();

    // Unregister old shortcuts. Guard against double-unregister if both were the same combo.
    if let Some(s) = old_pause {
        let _ = gs.unregister(s);
    }
    if let Some(s) = old_skip {
        if old_pause != Some(s) {
            let _ = gs.unregister(s);
        }
    }

    // Register pause
    if let Some(s) = new_pause {
        let handle = app.clone();
        if let Err(e) = gs.on_shortcut(s, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = handle.emit("hotkey-pause", ());
            }
        }) {
            log::warn!("hotkeys: register pause '{}' failed: {}", s, e);
        }
    }

    // Register skip. If the same combo was just registered for pause, skip this to avoid error.
    if let Some(s) = new_skip {
        if new_pause != Some(s) {
            let handle = app.clone();
            if let Err(e) = gs.on_shortcut(s, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = handle.emit("hotkey-skip", ());
                }
            }) {
                log::warn!("hotkeys: register skip '{}' failed: {}", s, e);
            }
        }
    }
}
