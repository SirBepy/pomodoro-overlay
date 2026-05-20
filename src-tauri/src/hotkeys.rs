use std::collections::HashSet;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Re-registers global hotkeys for pause, skip, and show/hide.
///
/// Pass old_* = the shortcuts previously registered (to unregister them).
/// Pass new_* = the shortcuts to register now (None = no binding).
/// Duplicate combos are registered once (first binding wins).
/// Silent on failure: if another app holds the combo, we log and move on.
#[allow(clippy::too_many_arguments)]
pub fn register_hotkeys(
    app: &AppHandle,
    old_pause: Option<&str>,
    old_skip: Option<&str>,
    old_show_hide: Option<&str>,
    new_pause: Option<&str>,
    new_skip: Option<&str>,
    new_show_hide: Option<&str>,
) {
    let gs = app.global_shortcut();

    // Unregister previous shortcuts (dedup so a shared combo isn't unregistered twice).
    let mut unregistered: HashSet<&str> = HashSet::new();
    for s in [old_pause, old_skip, old_show_hide].into_iter().flatten() {
        if unregistered.insert(s) {
            let _ = gs.unregister(s);
        }
    }

    // Register new shortcuts. Track registered combos so a duplicate binding
    // doesn't error; the first action listed for a combo wins.
    let mut registered: HashSet<&str> = HashSet::new();

    if let Some(s) = new_pause {
        if registered.insert(s) {
            let handle = app.clone();
            if let Err(e) = gs.on_shortcut(s, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = handle.emit("hotkey-pause", ());
                }
            }) {
                log::warn!("hotkeys: register pause '{}' failed: {}", s, e);
            }
        }
    }

    if let Some(s) = new_skip {
        if registered.insert(s) {
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

    if let Some(s) = new_show_hide {
        if registered.insert(s) {
            let handle = app.clone();
            if let Err(e) = gs.on_shortcut(s, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    crate::toggle_main_visibility(&handle);
                }
            }) {
                log::warn!("hotkeys: register show/hide '{}' failed: {}", s, e);
            }
        }
    }
}
