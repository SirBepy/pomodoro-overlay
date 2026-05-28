# Meeting Detection + Screenshare-Hide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when the user is in a meeting (camera/mic in use or a known meeting app playing audio) and have the pomodoro overlay block fullscreen breaks, mute notification sounds, switch to the count-up "Other" phase, and stay hidden from screen-share — with the detection capability living in the shared `tauri_kit` so other apps can reuse it.

**Architecture:** Two new `tauri_kit` crates — `tauri_kit_meeting` (polls Windows signals on a background thread, emits raw `meeting://changed` edges + a query command) and `tauri_kit_window` (a `SetWindowDisplayAffinity` screenshare-hide helper). Pomodoro owns ALL policy: a pure TS state machine applies the stay-until-manual latch + hotkey override on top of the kit's raw edges, then gates fullscreen/sound and forces the Other phase. Screenshare-hide is driven from Rust by a settings bool.

**Tech Stack:** Rust + `windows` crate 0.58 (WASAPI audio sessions, registry, `SetWindowDisplayAffinity`), Tauri 2.x plugin API, `tauri-plugin-global-shortcut`, lit-html/TS frontend, vitest, cargo test.

---

## Repos & key facts

- Kit source repo: `C:\Users\tecno\Desktop\Projects\sirbepy_tauri_kit` — a cargo workspace. It is checked out inside pomodoro as a git submodule at `src-tauri/../vendor/tauri_kit` (i.e. `C:\Users\tecno\Desktop\Projects\pomodoro-overlay\vendor\tauri_kit`). **Make all kit edits in the submodule checkout under pomodoro's `vendor/tauri_kit`**, build/test there, then commit+push the submodule BEFORE the pomodoro parent commit that bumps the pointer (CI fails with "not our ref" otherwise).
- Existing kit crate pattern: `tauri_kit_<name>`, exposes `pub fn plugin() -> TauriPlugin<R>` (see `tauri/updater/src/lib.rs`) or command-registering plugins via `tauri::plugin::Builder::new("<name>")...build()` (see `tauri/settings/src/commands.rs`).
- Frontend kit modules are plain TS imported by relative path (e.g. main.ts imports `../vendor/tauri_kit/frontend/updater/auto-check`). No build step.
- Pomodoro already depends on `tauri-plugin-global-shortcut` and `windows` 0.58. Detection events use `listen` (covered by `core:event:default` — no capability change). Screenshare-hide is invoked from Rust, not JS — also no capability change.
- Windows commands per Bash call: ONE command, no `&&`/`;`/`|`. Use `git -C <path>`. Never `cd`.
- Verify TS: `npm run build` (pomodoro root). Verify kit Rust: `cargo check` / `cargo test` inside `vendor/tauri_kit`. Verify pomodoro Rust: `cargo check` inside `src-tauri`. Frontend unit tests: `npx vitest run <file>` (pomodoro root) / inside kit.
- **Commits:** This repo uses auto-commit. Subagents must NOT commit — stage only; the main agent runs `/commit`. The commit steps below say "stage" for that reason; the main agent commits after each task's report-back.

## File Structure

### New — kit crate `tauri_kit_window` (`vendor/tauri_kit/tauri/window/`)
- `Cargo.toml` — crate manifest.
- `src/lib.rs` — `exclude_from_capture(window, bool)` + a `set_window_capture_excluded` Tauri command + `with_window_commands()` plugin.

### New — kit crate `tauri_kit_meeting` (`vendor/tauri_kit/tauri/meeting/`)
- `Cargo.toml` — crate manifest.
- `src/lib.rs` — public API: `MeetingConfig`, `MeetingState`, `plugin(config)`, query command.
- `src/signal.rs` — `SignalSource` trait + pure `compute_in_meeting` combine logic + `process_name_matches`.
- `src/windows_source.rs` — `WindowsSignalSource` implementing `SignalSource` via registry (cam/mic) + WASAPI (audio). `#[cfg(windows)]`.
- `src/watcher.rs` — background poll thread + edge detection + event emission.

### New — kit frontend (`vendor/tauri_kit/frontend/meeting/`)
- `subscribe.ts` — `onMeetingChanged(cb)` wrapper over `listen("meeting://changed")`.
- `subscribe.test.ts` — vitest.

### Modified — pomodoro Rust (`src-tauri/`)
- `Cargo.toml` — add kit path deps + `windows` features.
- `src/settings.rs` — 4 new fields + Default.
- `src/lib.rs` — register meeting plugin, apply screenshare-hide on boot, register meeting hotkey.
- `src/hotkeys.rs` — add meeting-toggle binding.
- `src/ipc/commands.rs` — `save_settings` re-applies screenshare-hide + re-registers meeting hotkey.

### New + Modified — pomodoro frontend (`src/`)
- `src/views/timer/meeting-mode.ts` — NEW pure policy state machine.
- `src/views/timer/meeting-mode.test.ts` — NEW vitest.
- `src/main.ts` — wire the state machine, gate fullscreen + sound.
- `src/views/settings/schema.ts` — new "Meeting mode" section.

---

## Task 1: Scaffold `tauri_kit_window` crate

**Files:**
- Create: `vendor/tauri_kit/tauri/window/Cargo.toml`
- Create: `vendor/tauri_kit/tauri/window/src/lib.rs`
- Modify: `vendor/tauri_kit/Cargo.toml` (add workspace member)

- [ ] **Step 1: Add the workspace member**

In `vendor/tauri_kit/Cargo.toml`, change the `members` list to include the two new crates:

```toml
[workspace]
resolver = "2"
members = [
  "tauri/settings",
  "tauri/updater",
  "tauri/window",
  "tauri/meeting",
]
```

- [ ] **Step 2: Create `vendor/tauri_kit/tauri/window/Cargo.toml`**

```toml
[package]
name = "tauri_kit_window"
version = "0.0.1"
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
tauri = { version = "2.0" }
log = "0.4"
raw-window-handle = "0.6"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
] }
```

- [ ] **Step 3: Create `vendor/tauri_kit/tauri/window/src/lib.rs`**

```rust
//! Window capture-exclusion helper. `exclude_from_capture(&window, true)` makes a
//! window invisible to screen capture / screen-share (SetWindowDisplayAffinity with
//! WDA_EXCLUDEFROMCAPTURE) while it stays visible to the local user. Win10 2004+.

use tauri::{Runtime, WebviewWindow};

/// Toggle whether `window` is excluded from screen capture.
/// No-op (Ok) on non-Windows.
pub fn exclude_from_capture<R: Runtime>(
    window: &WebviewWindow<R>,
    excluded: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        };

        let handle = window.window_handle().map_err(|e| e.to_string())?;
        let hwnd = match handle.as_raw() {
            RawWindowHandle::Win32(h) => HWND(h.hwnd.get() as *mut core::ffi::c_void),
            _ => return Err("not a Win32 window".into()),
        };
        let affinity = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        unsafe {
            SetWindowDisplayAffinity(hwnd, affinity).map_err(|e| e.to_string())?;
        }
        log::info!("window: capture-excluded={excluded}");
    }
    #[cfg(not(windows))]
    {
        let _ = (window, excluded);
    }
    Ok(())
}

/// Tauri command wrapper so JS consumers can toggle it. Pomodoro drives this from
/// Rust instead, but other apps may want the command.
#[tauri::command]
pub fn set_window_capture_excluded<R: Runtime>(
    window: WebviewWindow<R>,
    excluded: bool,
) -> Result<(), String> {
    exclude_from_capture(&window, excluded)
}

/// Plugin that registers `set_window_capture_excluded`.
pub fn with_window_commands<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("kit-window")
        .invoke_handler(tauri::generate_handler![set_window_capture_excluded])
        .build()
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check -p tauri_kit_window --manifest-path vendor/tauri_kit/Cargo.toml`
Expected: `Finished` with no errors. If `SetWindowDisplayAffinity`'s return type differs in this `windows` version (it returns `windows::core::Result<()>` in 0.58), the `.map_err` handles it; if it returns `BOOL`, replace the `unsafe` block with `if SetWindowDisplayAffinity(hwnd, affinity).as_bool() { Ok(()) } else { Err("SetWindowDisplayAffinity failed".into()) }?;`.

- [ ] **Step 5: Stage (do NOT commit — main agent commits)**

```
git -C vendor/tauri_kit add Cargo.toml tauri/window/Cargo.toml tauri/window/src/lib.rs
```

---

## Task 2: Scaffold `tauri_kit_meeting` crate + pure combine logic (TDD)

**Files:**
- Create: `vendor/tauri_kit/tauri/meeting/Cargo.toml`
- Create: `vendor/tauri_kit/tauri/meeting/src/signal.rs`
- Create: `vendor/tauri_kit/tauri/meeting/src/lib.rs` (minimal, expanded in Task 4)

- [ ] **Step 1: Create `vendor/tauri_kit/tauri/meeting/Cargo.toml`**

```toml
[package]
name = "tauri_kit_meeting"
version = "0.0.1"
edition.workspace = true
license.workspace = true
authors.workspace = true

[dependencies]
tauri = { version = "2.0" }
serde = { version = "1", features = ["derive"] }
log = "0.4"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_System_Com",
    "Win32_System_Registry",
    "Win32_Media_Audio",
    "Win32_System_Diagnostics_ToolHelp",
] }
```

- [ ] **Step 2: Write the failing test** in `vendor/tauri_kit/tauri/meeting/src/signal.rs`

```rust
//! Pure detection logic + the SignalSource abstraction (no OS calls here).

use serde::Serialize;

/// Snapshot of the three raw signals at one poll.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Sources {
    pub camera: bool,
    pub mic: bool,
    pub audio: bool,
}

/// Reads the three raw signals. Implemented by the OS layer; faked in tests.
pub trait SignalSource: Send {
    fn camera_in_use(&self) -> bool;
    fn mic_in_use(&self) -> bool;
    /// True if any process whose name matches `allow` has an active audio render session.
    fn meeting_app_audio_active(&self, allow: &[String]) -> bool;
}

/// Combine the three raw signals into a single "in meeting" boolean.
pub fn compute_in_meeting(s: Sources) -> bool {
    s.camera || s.mic || s.audio
}

/// Case-insensitive match of a process image name against the allow list.
/// `proc_name` is e.g. "Teams.exe"; `allow` entries may be "teams.exe" or "Teams.exe".
pub fn process_name_matches(proc_name: &str, allow: &[String]) -> bool {
    allow.iter().any(|a| a.eq_ignore_ascii_case(proc_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_meeting_when_any_signal_true() {
        assert!(!compute_in_meeting(Sources::default()));
        assert!(compute_in_meeting(Sources { camera: true, ..Default::default() }));
        assert!(compute_in_meeting(Sources { mic: true, ..Default::default() }));
        assert!(compute_in_meeting(Sources { audio: true, ..Default::default() }));
    }

    #[test]
    fn process_match_is_case_insensitive() {
        let allow = vec!["Teams.exe".to_string(), "zoom.exe".to_string()];
        assert!(process_name_matches("teams.exe", &allow));
        assert!(process_name_matches("ZOOM.EXE", &allow));
        assert!(!process_name_matches("chrome.exe", &allow));
    }
}
```

- [ ] **Step 3: Create minimal `vendor/tauri_kit/tauri/meeting/src/lib.rs`** (so the crate builds)

```rust
//! Meeting detection: polls Windows for camera/mic use and meeting-app audio,
//! emits raw `meeting://changed` edges, and exposes a query command.
//! Consumers apply their own latch/override policy on top of the raw edges.

pub mod signal;

pub use signal::{Sources, SignalSource};
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `cargo test -p tauri_kit_meeting --manifest-path vendor/tauri_kit/Cargo.toml`
Expected: PASS (2 tests).

- [ ] **Step 5: Stage**

```
git -C vendor/tauri_kit add tauri/meeting/Cargo.toml tauri/meeting/src/signal.rs tauri/meeting/src/lib.rs
```

---

## Task 3: Windows signal source (registry cam/mic + WASAPI audio)

**Files:**
- Create: `vendor/tauri_kit/tauri/meeting/src/windows_source.rs`
- Modify: `vendor/tauri_kit/tauri/meeting/src/lib.rs` (declare module)

This task is OS FFI — not unit-testable. Verification is `cargo check` plus manual QA later. Write the real code; if a `windows` 0.58 signature differs, the compiler will pinpoint it.

- [ ] **Step 1: Create `vendor/tauri_kit/tauri/meeting/src/windows_source.rs`**

```rust
//! Windows implementation of SignalSource.
//! - camera/mic: read the CapabilityAccessManager ConsentStore in HKCU. Any app
//!   subkey whose `LastUsedTimeStop` == 0 means the device is in use right now.
//!   This is the same data behind the tray privacy icon, so it covers browser calls.
//! - audio: enumerate active audio render sessions, map each PID to a process name,
//!   and match against the meeting-app allow list.

#![cfg(windows)]

use crate::signal::{process_name_matches, SignalSource};
use std::collections::HashMap;

pub struct WindowsSignalSource;

impl SignalSource for WindowsSignalSource {
    fn camera_in_use(&self) -> bool {
        consent_store_in_use("webcam")
    }
    fn mic_in_use(&self) -> bool {
        consent_store_in_use("microphone")
    }
    fn meeting_app_audio_active(&self, allow: &[String]) -> bool {
        if allow.is_empty() {
            return false;
        }
        match active_audio_pids() {
            Ok(pids) if !pids.is_empty() => {
                let names = pid_name_map();
                pids.iter().any(|pid| {
                    names
                        .get(pid)
                        .map(|n| process_name_matches(n, allow))
                        .unwrap_or(false)
                })
            }
            Ok(_) => false,
            Err(e) => {
                log::warn!("meeting: audio session scan failed: {e}");
                false
            }
        }
    }
}

// ---- registry (camera / mic) ----

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Returns true if any app under
/// `...\CapabilityAccessManager\ConsentStore\<device>` (or its `NonPackaged`
/// subtree) currently holds the device (LastUsedTimeStop == 0).
fn consent_store_in_use(device: &str) -> bool {
    let base = format!(
        "Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{device}"
    );
    if any_child_active(&base) {
        return true;
    }
    any_child_active(&format!("{base}\\NonPackaged"))
}

/// Open `parent`, enumerate its immediate subkeys, and return true if any subkey
/// has a `LastUsedTimeStop` value equal to 0.
fn any_child_active(parent: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
    };

    let wparent = to_wide(parent);
    let mut hkey = HKEY::default();
    let opened = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(wparent.as_ptr()), 0, KEY_READ, &mut hkey)
    };
    if opened != ERROR_SUCCESS {
        return false;
    }

    let mut found = false;
    let mut index = 0u32;
    loop {
        let mut name_buf = [0u16; 256];
        let mut name_len = name_buf.len() as u32;
        let rc = unsafe {
            RegEnumKeyExW(
                hkey,
                index,
                windows::core::PWSTR(name_buf.as_mut_ptr()),
                &mut name_len,
                None,
                windows::core::PWSTR::null(),
                None,
                None,
            )
        };
        if rc != ERROR_SUCCESS {
            break;
        }
        let child = String::from_utf16_lossy(&name_buf[..name_len as usize]);
        let full = format!("{parent}\\{child}");
        if last_used_stop_is_zero(&full) {
            found = true;
            break;
        }
        index += 1;
    }
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    found
}

/// Read REG_QWORD `LastUsedTimeStop` under `key_path`; return true iff it equals 0.
fn last_used_stop_is_zero(key_path: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
    };

    let wkey = to_wide(key_path);
    let wname = to_wide("LastUsedTimeStop");
    let mut hkey = HKEY::default();
    let opened = unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(wkey.as_ptr()), 0, KEY_READ, &mut hkey)
    };
    if opened != ERROR_SUCCESS {
        return false;
    }

    let mut data = [0u8; 8];
    let mut size = data.len() as u32;
    let rc = unsafe {
        RegQueryValueExW(
            hkey,
            PCWSTR(wname.as_ptr()),
            None,
            None,
            Some(data.as_mut_ptr()),
            Some(&mut size),
        )
    };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if rc != ERROR_SUCCESS {
        return false;
    }
    u64::from_le_bytes(data) == 0
}

// ---- WASAPI (audio render sessions) ----

/// PIDs that currently have an ACTIVE audio render session on the default endpoint.
fn active_audio_pids() -> Result<Vec<u32>, String> {
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, AudioSessionStateActive, IAudioSessionControl2,
        IAudioSessionEnumerator, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    let mut pids = Vec::new();
    unsafe {
        // Ignore RPC_E_CHANGED_MODE — COM may already be initialized on this thread.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| e.to_string())?;
        let mgr: IAudioSessionManager2 =
            device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        let sessions: IAudioSessionEnumerator =
            mgr.GetSessionEnumerator().map_err(|e| e.to_string())?;
        let count = sessions.GetCount().map_err(|e| e.to_string())?;

        for i in 0..count {
            let ctrl = match sessions.GetSession(i) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if ctrl.GetState().map_err(|e| e.to_string())? != AudioSessionStateActive {
                continue;
            }
            let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Ok(pid) = ctrl2.GetProcessId() {
                if pid != 0 {
                    pids.push(pid);
                }
            }
        }
    }
    Ok(pids)
}

/// Map every running PID to its process image name (e.g. "Teams.exe").
fn pid_name_map() -> HashMap<u32, String> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut map = HashMap::new();
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(s) => s,
            Err(_) => return map,
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
                map.insert(entry.th32ProcessID, name);
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snapshot);
    }
    map
}
```

- [ ] **Step 2: Declare the module** in `vendor/tauri_kit/tauri/meeting/src/lib.rs` — add after `pub mod signal;`:

```rust
#[cfg(windows)]
pub mod windows_source;
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p tauri_kit_meeting --manifest-path vendor/tauri_kit/Cargo.toml`
Expected: `Finished`. Likely signature touch-ups for `windows` 0.58: `RegEnumKeyExW`/`RegQueryValueExW` return `WIN32_ERROR` (compare with `== ERROR_SUCCESS`); `device.Activate` is generic `Activate<T>(CLSCTX, Option<*const PROPVARIANT>)`. Fix any mismatch the compiler reports — do not stub anything out.

- [ ] **Step 4: Stage**

```
git -C vendor/tauri_kit add tauri/meeting/src/windows_source.rs tauri/meeting/src/lib.rs
```

---

## Task 4: Watcher thread + `plugin()` + query command + event emission

**Files:**
- Create: `vendor/tauri_kit/tauri/meeting/src/watcher.rs`
- Modify: `vendor/tauri_kit/tauri/meeting/src/lib.rs`

- [ ] **Step 1: Create `vendor/tauri_kit/tauri/meeting/src/watcher.rs`**

```rust
//! Background poll loop: every `poll_interval`, compute raw in-meeting and emit
//! `meeting://changed` on each transition. Stores latest state for the query
//! command. The app list is read from the shared store each poll, so app-list
//! edits take effect live (via `set_apps`) without rebuilding the plugin.

use crate::signal::{compute_in_meeting, SignalSource, Sources};
use crate::{MeetingState, MeetingStateStore};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub fn spawn<R: Runtime>(
    app: AppHandle<R>,
    poll_interval: Duration,
    source: Box<dyn SignalSource>,
) {
    std::thread::spawn(move || {
        let mut last: Option<bool> = None;
        loop {
            let allow: Vec<String> = app
                .try_state::<MeetingStateStore>()
                .and_then(|s| s.apps.lock().ok().map(|g| g.clone()))
                .unwrap_or_default();

            let sources = Sources {
                camera: source.camera_in_use(),
                mic: source.mic_in_use(),
                audio: source.meeting_app_audio_active(&allow),
            };
            let active = compute_in_meeting(sources);

            // Update the shared store for the query command.
            if let Some(store) = app.try_state::<MeetingStateStore>() {
                store.active.store(active, Ordering::Relaxed);
                store.camera.store(sources.camera, Ordering::Relaxed);
                store.mic.store(sources.mic, Ordering::Relaxed);
                store.audio.store(sources.audio, Ordering::Relaxed);
            }

            if last != Some(active) {
                last = Some(active);
                let _ = app.emit("meeting://changed", MeetingState { active, sources });
                log::info!("meeting: active={active} sources={sources:?}");
            }
            std::thread::sleep(poll_interval);
        }
    });
}
```

- [ ] **Step 2: Replace `vendor/tauri_kit/tauri/meeting/src/lib.rs`** with the full public API:

```rust
//! Meeting detection: polls Windows for camera/mic use and meeting-app audio,
//! emits raw `meeting://changed` edges, and exposes a `kit_meeting_state` query.
//! Consumers apply their own latch/override policy on top of the raw edges.

pub mod signal;
mod watcher;
#[cfg(windows)]
pub mod windows_source;

pub use signal::{SignalSource, Sources};

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime, State};

/// Configuration for the meeting watcher.
#[derive(Clone, Debug)]
pub struct MeetingConfig {
    pub poll_interval: Duration,
    /// Process image names counted as meeting apps for the audio-session check.
    pub audio_app_names: Vec<String>,
}

impl Default for MeetingConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(3),
            audio_app_names: default_meeting_apps(),
        }
    }
}

/// Built-in meeting-app process names.
pub fn default_meeting_apps() -> Vec<String> {
    [
        "Teams.exe",
        "ms-teams.exe",
        "Zoom.exe",
        "CptHost.exe",
        "Discord.exe",
        "slack.exe",
        "Webex.exe",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Payload emitted on `meeting://changed` and returned by the query command.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct MeetingState {
    pub active: bool,
    pub sources: Sources,
}

/// Shared state store, written by the watcher, read by the query command.
/// `apps` is the live meeting-app allow list (the watcher reads it each poll).
pub(crate) struct MeetingStateStore {
    pub active: AtomicBool,
    pub camera: AtomicBool,
    pub mic: AtomicBool,
    pub audio: AtomicBool,
    pub apps: Mutex<Vec<String>>,
}

#[tauri::command]
fn kit_meeting_state(store: State<'_, MeetingStateStore>) -> MeetingState {
    MeetingState {
        active: store.active.load(Ordering::Relaxed),
        sources: Sources {
            camera: store.camera.load(Ordering::Relaxed),
            mic: store.mic.load(Ordering::Relaxed),
            audio: store.audio.load(Ordering::Relaxed),
        },
    }
}

/// Update the live meeting-app allow list. Apps call this on setup and whenever
/// the user edits the list, so edits take effect without restarting the watcher.
pub fn set_apps<R: Runtime>(app: &AppHandle<R>, apps: Vec<String>) {
    if let Some(store) = app.try_state::<MeetingStateStore>() {
        if let Ok(mut g) = store.apps.lock() {
            *g = apps;
        }
    }
}

/// Returns a plugin that, on setup, registers the state store + query command and
/// spawns the background watcher using the platform signal source.
pub fn plugin<R: Runtime>(config: MeetingConfig) -> TauriPlugin<R> {
    tauri::plugin::Builder::new("meeting")
        .invoke_handler(tauri::generate_handler![kit_meeting_state])
        .setup(move |app, _api| {
            app.manage(MeetingStateStore {
                active: AtomicBool::new(false),
                camera: AtomicBool::new(false),
                mic: AtomicBool::new(false),
                audio: AtomicBool::new(false),
                apps: Mutex::new(config.audio_app_names.clone()),
            });

            #[cfg(windows)]
            let source: Box<dyn SignalSource> = Box::new(windows_source::WindowsSignalSource);
            #[cfg(not(windows))]
            let source: Box<dyn SignalSource> = Box::new(NoopSource);

            watcher::spawn(app.clone(), config.poll_interval, source);
            Ok(())
        })
        .build()
}

#[cfg(not(windows))]
struct NoopSource;
#[cfg(not(windows))]
impl SignalSource for NoopSource {
    fn camera_in_use(&self) -> bool { false }
    fn mic_in_use(&self) -> bool { false }
    fn meeting_app_audio_active(&self, _allow: &[String]) -> bool { false }
}
```

- [ ] **Step 3: Verify it compiles and tests still pass**

Run: `cargo test -p tauri_kit_meeting --manifest-path vendor/tauri_kit/Cargo.toml`
Expected: `Finished` + the 2 signal tests PASS. (`app.clone()` requires `AppHandle: Clone` — it is. If `Builder::setup` closure signature complains, the closure is `Fn(&AppHandle<R>, PluginApi) -> Result<...>`.)

- [ ] **Step 4: Stage**

```
git -C vendor/tauri_kit add tauri/meeting/src/watcher.rs tauri/meeting/src/lib.rs
```

---

## Task 5: Kit frontend subscribe helper (TDD)

**Files:**
- Create: `vendor/tauri_kit/frontend/meeting/subscribe.ts`
- Create: `vendor/tauri_kit/frontend/meeting/subscribe.test.ts`

- [ ] **Step 1: Write the failing test** `vendor/tauri_kit/frontend/meeting/subscribe.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const listen = vi.fn();
(globalThis as any).window = { __TAURI__: { event: { listen } } };

import { onMeetingChanged, type MeetingState } from "./subscribe";

describe("onMeetingChanged", () => {
  beforeEach(() => listen.mockReset());

  it("subscribes to meeting://changed and forwards the payload", async () => {
    let handler: (e: { payload: MeetingState }) => void = () => {};
    listen.mockImplementation((_name: string, cb: any) => {
      handler = cb;
      return Promise.resolve(() => {});
    });
    const seen: MeetingState[] = [];
    await onMeetingChanged((s) => seen.push(s));

    expect(listen).toHaveBeenCalledWith("meeting://changed", expect.any(Function));
    handler({ payload: { active: true, sources: { camera: true, mic: false, audio: false } } });
    expect(seen).toEqual([
      { active: true, sources: { camera: true, mic: false, audio: false } },
    ]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run (inside `vendor/tauri_kit`): `npx vitest run frontend/meeting/subscribe.test.ts`
Expected: FAIL — cannot find `./subscribe`.

- [ ] **Step 3: Create `vendor/tauri_kit/frontend/meeting/subscribe.ts`**

```ts
export interface MeetingSources {
  camera: boolean;
  mic: boolean;
  audio: boolean;
}

export interface MeetingState {
  active: boolean;
  sources: MeetingSources;
}

/**
 * Subscribe to raw meeting-detection edges emitted by tauri_kit_meeting.
 * The kit emits only on transitions; it does NOT latch. Returns the unlisten fn.
 */
export async function onMeetingChanged(
  cb: (state: MeetingState) => void,
): Promise<() => void> {
  const { listen } = (window as any).__TAURI__.event;
  return listen("meeting://changed", (e: { payload: MeetingState }) => cb(e.payload));
}
```

- [ ] **Step 4: Run it — verify it passes**

Run (inside `vendor/tauri_kit`): `npx vitest run frontend/meeting/subscribe.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**

```
git -C vendor/tauri_kit add frontend/meeting/subscribe.ts frontend/meeting/subscribe.test.ts
```

**After Task 5: the main agent commits the kit changes and pushes the submodule** (`git -C vendor/tauri_kit push`) before any pomodoro parent commit bumps the pointer.

---

## Task 6: Pomodoro — add dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the kit path deps** — under `[dependencies]`, after the existing `tauri_kit_*` lines (around line 23):

```toml
tauri_kit_meeting = { path = "../vendor/tauri_kit/tauri/meeting" }
tauri_kit_window = { path = "../vendor/tauri_kit/tauri/window" }
```

- [ ] **Step 2: Verify it resolves**

Run (inside `src-tauri`): `cargo check`
Expected: `Finished`. (No `windows`-crate feature changes needed in pomodoro — `Win32_UI_WindowsAndMessaging` is already enabled, and the WASAPI/registry features live in the kit crate.)

- [ ] **Step 3: Stage**

```
git -C . add src-tauri/Cargo.toml src-tauri/Cargo.lock
```

---

## Task 7: Pomodoro — settings fields

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Add fields to the `Settings` struct** — after `pub stats_retention_days: u32,` (line 38), before `#[serde(flatten)] pub kit`:

```rust
    pub meeting_detection_enabled: bool,
    pub meeting_hide_from_capture: bool,
    pub meeting_apps: String,
    pub keybind_meeting_toggle: Option<String>,
```

- [ ] **Step 2: Add defaults to the `Default` impl** — after `stats_retention_days: 30,` (line 76), before `kit: KitSettings::default(),`:

```rust
            meeting_detection_enabled: true,
            meeting_hide_from_capture: true,
            meeting_apps: tauri_kit_meeting::default_meeting_apps().join(", "),
            keybind_meeting_toggle: None,
```

- [ ] **Step 3: Verify it compiles**

Run (inside `src-tauri`): `cargo check`
Expected: `Finished`.

- [ ] **Step 4: Stage**

```
git -C . add src-tauri/src/settings.rs
```

---

## Task 8: Pomodoro — meeting-toggle hotkey in `hotkeys.rs`

**Files:**
- Modify: `src-tauri/src/hotkeys.rs`

- [ ] **Step 1: Add a meeting param** to `register_hotkeys`. Change the signature (line 12-20) to add an old/new pair:

```rust
#[allow(clippy::too_many_arguments)]
pub fn register_hotkeys(
    app: &AppHandle,
    old_pause: Option<&str>,
    old_skip: Option<&str>,
    old_show_hide: Option<&str>,
    old_meeting: Option<&str>,
    new_pause: Option<&str>,
    new_skip: Option<&str>,
    new_show_hide: Option<&str>,
    new_meeting: Option<&str>,
) {
```

- [ ] **Step 2: Add `old_meeting` to the unregister loop** — change the array on line 25:

```rust
    for s in [old_pause, old_skip, old_show_hide, old_meeting].into_iter().flatten() {
```

- [ ] **Step 3: Register the new meeting shortcut** — after the `new_show_hide` block (after line 72), add:

```rust
    if let Some(s) = new_meeting {
        if registered.insert(s) {
            let handle = app.clone();
            if let Err(e) = gs.on_shortcut(s, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = handle.emit("hotkey-meeting-toggle", ());
                }
            }) {
                log::warn!("hotkeys: register meeting '{}' failed: {}", s, e);
            }
        }
    }
```

- [ ] **Step 4: Verify (will fail at callers — expected)** — callers are updated in Tasks 9 & 10. Skip standalone check here; compile after Task 10.

- [ ] **Step 5: Stage**

```
git -C . add src-tauri/src/hotkeys.rs
```

---

## Task 9: Pomodoro — register plugin, screenshare-hide, hotkey on boot (`lib.rs`)

**Files:**
- Modify: `src-tauri/src/lib.rs`

The kit's live `set_apps` helper (added in Task 4) means we register the plugin with `MeetingConfig::default()` and then push the user's configured app list from inside `.setup`. No brittle pre-handle file read.

- [ ] **Step 1: Register the meeting plugin** — in `run()`, after `.plugin(tauri_kit_updater::plugin())` (line 171), add:

```rust
        .plugin(tauri_kit_meeting::plugin(tauri_kit_meeting::MeetingConfig::default()))
```

- [ ] **Step 2: Push the configured app list in `.setup`** — after `let settings = settings::load(&handle);` (line 176), add:

```rust
            tauri_kit_meeting::set_apps(
                &handle,
                settings
                    .meeting_apps
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            );
```

- [ ] **Step 3: Register the meeting hotkey on boot** — update the `register_hotkeys` call (line 179) to pass the new old/new meeting args (old=None on boot):

```rust
            hotkeys::register_hotkeys(
                &handle,
                None, None, None, None,
                settings.keybind_pause.as_deref(),
                settings.keybind_skip.as_deref(),
                settings.keybind_show_hide.as_deref(),
                settings.keybind_meeting_toggle.as_deref(),
            );
```

- [ ] **Step 4: Apply screenshare-hide on boot** — inside the `if let Some(win) = handle.get_webview_window("main")` block, after `let _ = win.show();` (line 185), add:

```rust
                let _ = tauri_kit_window::exclude_from_capture(&win, settings.meeting_hide_from_capture);
```

- [ ] **Step 5: Verify after Task 10** — `hotkeys.rs` and `commands.rs` callers must all be updated before the Rust side compiles cleanly; the full `cargo check` runs at Task 10 Step 5.

- [ ] **Step 6: Stage**

```
git -C . add src-tauri/src/lib.rs
```

---

## Task 10: Pomodoro — `save_settings` re-applies hide + hotkey + app list

**Files:**
- Modify: `src-tauri/src/ipc/commands.rs`

- [ ] **Step 1: Capture old meeting hotkey** — in `save_settings`, extend the old-tuple read (lines 17-20):

```rust
    let (old_pause, old_skip, old_show_hide, old_meeting) = {
        let s = state.0.lock().unwrap();
        (
            s.keybind_pause.clone(),
            s.keybind_skip.clone(),
            s.keybind_show_hide.clone(),
            s.keybind_meeting_toggle.clone(),
        )
    };
```

- [ ] **Step 2: Re-apply screenshare-hide + push app list** — after the `apply_autostart(&app, settings.autostart);` line (line 32), add:

```rust
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
```

- [ ] **Step 3: Pass meeting args to `register_hotkeys`** — replace the call (lines 33-41):

```rust
    crate::hotkeys::register_hotkeys(
        &app,
        old_pause.as_deref(),
        old_skip.as_deref(),
        old_show_hide.as_deref(),
        old_meeting.as_deref(),
        settings.keybind_pause.as_deref(),
        settings.keybind_skip.as_deref(),
        settings.keybind_show_hide.as_deref(),
        settings.keybind_meeting_toggle.as_deref(),
    );
```

- [ ] **Step 4: (No action — `set_apps` on boot was added in Task 9 Step 2.)** The `save_settings` `set_apps` call from Step 2 above handles live edits. Skip.

- [ ] **Step 5: Verify the whole Rust side compiles**

Run (inside `src-tauri`): `cargo check`
Expected: `Finished`, no errors.

- [ ] **Step 6: Stage**

```
git -C . add src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
```

---

## Task 11: Pomodoro — policy state machine (TDD, pure TS)

**Files:**
- Create: `src/views/timer/meeting-mode.ts`
- Create: `src/views/timer/meeting-mode.test.ts`

The state machine takes raw edges + hotkey presses and produces effective active transitions. No DOM, no Tauri — pure and fully testable.

- [ ] **Step 1: Write the failing test** `src/views/timer/meeting-mode.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { MeetingPolicy } from "./meeting-mode";

describe("MeetingPolicy", () => {
  let entered: number;
  let exited: number;
  let p: MeetingPolicy;

  beforeEach(() => {
    entered = 0;
    exited = 0;
    p = new MeetingPolicy({
      onEnter: () => entered++,
      onExit: () => exited++,
      isEnabled: () => true,
    });
  });

  it("enters on a rising raw edge", () => {
    p.onRaw(true);
    expect(entered).toBe(1);
    expect(p.active).toBe(true);
  });

  it("stays active when raw falls (stay-until-manual)", () => {
    p.onRaw(true);
    p.onRaw(false);
    expect(p.active).toBe(true);
    expect(exited).toBe(0);
  });

  it("hotkey while active deactivates and suppresses re-entry until raw clears", () => {
    p.onRaw(true); // active
    p.toggleHotkey(); // force off + arm suppression (raw still true)
    expect(p.active).toBe(false);
    expect(exited).toBe(1);

    p.onRaw(true); // same call still detected -> suppressed, must NOT re-enter
    expect(p.active).toBe(false);
    expect(entered).toBe(1);

    p.onRaw(false); // raw clears -> suppression lifts
    p.onRaw(true); // new meeting -> re-enter
    expect(p.active).toBe(true);
    expect(entered).toBe(2);
  });

  it("hotkey while inactive forces on (covers undetectable calls)", () => {
    p.toggleHotkey();
    expect(p.active).toBe(true);
    expect(entered).toBe(1);
  });

  it("ignores raw edges when detection disabled, but hotkey still works", () => {
    p = new MeetingPolicy({
      onEnter: () => entered++,
      onExit: () => exited++,
      isEnabled: () => false,
    });
    p.onRaw(true);
    expect(p.active).toBe(false);
    expect(entered).toBe(0);
    p.toggleHotkey();
    expect(p.active).toBe(true);
    expect(entered).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run (pomodoro root): `npx vitest run src/views/timer/meeting-mode.test.ts`
Expected: FAIL — cannot find `./meeting-mode`.

- [ ] **Step 3: Create `src/views/timer/meeting-mode.ts`**

```ts
export interface MeetingPolicyHooks {
  onEnter: () => void;
  onExit: () => void;
  /** Whether auto-detection is enabled (master setting). Hotkey works regardless. */
  isEnabled: () => boolean;
}

/**
 * Applies the pomodoro meeting-mode policy on top of the kit's raw edges:
 *  - rising raw edge (and enabled, not suppressed) -> enter
 *  - "stay until manual": falling raw edge does NOT exit
 *  - hotkey toggles: active -> exit + arm suppression; inactive -> force enter
 *  - suppression (armed by a manual force-off while a call is still detected)
 *    lifts only when raw goes false again (edge re-arm), so forcing off mid-call
 *    won't immediately re-trigger.
 */
export class MeetingPolicy {
  active = false;
  private lastRaw = false;
  private suppressed = false;

  constructor(private hooks: MeetingPolicyHooks) {}

  onRaw(raw: boolean): void {
    const rising = raw && !this.lastRaw;
    this.lastRaw = raw;

    if (!raw) {
      // Raw cleared: re-arm auto-detection.
      this.suppressed = false;
      return;
    }
    if (rising && this.hooks.isEnabled() && !this.suppressed && !this.active) {
      this.enter();
    }
  }

  toggleHotkey(): void {
    if (this.active) {
      // Force off. If a call is still detected, suppress until it ends.
      this.suppressed = this.lastRaw;
      this.exit();
    } else {
      this.enter();
    }
  }

  private enter(): void {
    this.active = true;
    this.hooks.onEnter();
  }

  private exit(): void {
    this.active = false;
    this.hooks.onExit();
  }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run (pomodoro root): `npx vitest run src/views/timer/meeting-mode.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Stage**

```
git -C . add src/views/timer/meeting-mode.ts src/views/timer/meeting-mode.test.ts
```

---

## Task 12: Pomodoro — wire the state machine into `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add a module-level meeting flag + imports** — after the imports block (after line 28) and the `const { listen } = ...` (line 31), add an import and a flag near the other `let` state (after line 51):

```ts
import { MeetingPolicy } from "./views/timer/meeting-mode";
import { onMeetingChanged } from "../vendor/tauri_kit/frontend/meeting/subscribe";
```

and with the other module state (near line 51):

```ts
let meetingActive = false;
let meetingPolicy = null;
```

- [ ] **Step 2: Gate the fullscreen break** — in `handlePhaseEnd`, the work-end fullscreen branch (lines 265-267). Change:

```ts
  if (ended === PHASE_WORK && settings.fullscreen_on_focus_end) {
```

to:

```ts
  if (ended === PHASE_WORK && settings.fullscreen_on_focus_end && !meetingActive) {
```

- [ ] **Step 3: Gate the phase-end sound** — in `handlePhaseEnd`, line 233. Change:

```ts
  if (natural) playSound().catch(() => {});
```

to:

```ts
  if (natural && !meetingActive) playSound().catch(() => {});
```

- [ ] **Step 4: Add enter/exit actions + wiring** — inside `init()`, after `setupControls();` (line 375), add:

```ts
  meetingPolicy = new MeetingPolicy({
    isEnabled: () => !!settings?.meeting_detection_enabled,
    onEnter: () => {
      meetingActive = true;
      // Force Other (count-up) phase and start timing.
      if (fsState.isOverlayFullscreen) exitOverlayFullscreen();
      setPhase(PHASE_OTHER);
      if (!running) startTimer().catch(() => {});
    },
    onExit: () => {
      meetingActive = false;
      // Mirror the existing Other -> Work transition.
      pauseTimer("switch");
      setPhase(PHASE_WORK);
    },
  });
  await onMeetingChanged((s) => meetingPolicy.onRaw(s.active));
  await listen("hotkey-meeting-toggle", () => meetingPolicy.toggleHotkey());
```

NOTE: `setPhase` (line 214) is defined above `init`, and `PHASE_OTHER` is in scope. `exitOverlayFullscreen` is already imported (line 12).

- [ ] **Step 5: Verify TS builds**

Run (pomodoro root): `npm run build`
Expected: build succeeds. (`main.ts` is `// @ts-nocheck`, so type errors there won't block; the build still bundles. Watch for genuine import-resolution errors.)

- [ ] **Step 6: Stage**

```
git -C . add src/main.ts
```

---

## Task 13: Pomodoro — "Meeting mode" settings section

**Files:**
- Modify: `src/views/settings/schema.ts`

- [ ] **Step 1: Add the section** — insert a new section object into the `sections` array, after the "Focus mode" section (after its closing `},` at line 213, before the "Sound" section at line 214):

```ts
    {
      title: "Meeting mode",
      groups: [
        {
          title: "Detection",
          fields: [
            {
              key: "meeting_detection_enabled",
              kind: "toggle",
              label: "Auto-detect meetings",
              tooltip:
                "When you're in a call (camera/mic in use, or a known meeting app playing audio), block fullscreen breaks, mute sounds, and switch to the Other timer.",
            },
            {
              key: "meeting_hide_from_capture",
              kind: "toggle",
              label: "Hide overlay from screen share",
              tooltip:
                "Keep the overlay visible to you but invisible to screen capture and screen-share.",
            },
            {
              key: "meeting_apps",
              kind: "text",
              label: "Meeting apps",
              tooltip:
                "Comma-separated process names checked for active audio (covers calls with camera and mic off). Edit to add or remove apps. Takes effect on next launch.",
            },
          ],
        },
        {
          title: "Manual toggle",
          fields: [
            keybindField({ key: "keybind_meeting_toggle", label: "Toggle meeting mode" }),
          ],
        },
      ],
    },
```

- [ ] **Step 2: Confirm the `text` field kind exists in the kit schema**

Run: `npx vitest run` is not needed; instead check the kit schema supports `kind: "text"`. Open `vendor/tauri_kit/frontend/settings/schema.ts` and `renderer.ts`. If there is no `"text"` kind, use the existing string-capable kind instead, or add a minimal text renderer. If unsupported, fall back to representing `meeting_apps` via a small custom field modeled on `keybindField` (a text `<input>` whose `oninput` calls `onChange`). Implement whichever the kit already supports; do NOT leave it unrendered.

- [ ] **Step 3: Verify TS builds**

Run (pomodoro root): `npm run build`
Expected: build succeeds and the settings page compiles.

- [ ] **Step 4: Stage**

```
git -C . add src/views/settings/schema.ts
```

---

## Task 14: Full verification + manual QA handoff

**Files:**
- Modify: `.for_bepy/BEPY_TODOS.md`

- [ ] **Step 1: Run all automated checks**

- Kit Rust: `cargo test --manifest-path vendor/tauri_kit/Cargo.toml` → all pass.
- Pomodoro Rust: `cargo check` (inside `src-tauri`) → Finished.
- Pomodoro TS build: `npm run build` (root) → succeeds.
- Unit tests: `npx vitest run src/views/timer/meeting-mode.test.ts` → 5 pass.

- [ ] **Step 2: Check for orphan node processes** (per process-hygiene)

Run: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vitest' }` (PowerShell). Kill any orphans with `Stop-Process -Id <PID> -Force`.

- [ ] **Step 3: Append manual-QA items to `.for_bepy/BEPY_TODOS.md`** under a `### Visual QA` heading (Tauri webview + WinAPI can't be Playwright-driven):

```markdown
### Visual QA — meeting detection
- Join a Zoom/Teams call: overlay should switch to "Other" + start timing, no fullscreen break, no end sounds.
- Google Meet: join with mic on, then mute — meeting-mode should stay active (stay-until-manual latch).
- Turn camera on/off in a browser call — verify it's detected.
- Press the meeting-toggle hotkey mid-call: mode turns OFF and does NOT immediately re-trigger; ends + a new call re-triggers.
- Press the hotkey with no call active: mode turns ON (covers silent browser calls).
- Start a screen-share (Zoom/Meet "share screen"): overlay must be invisible in the shared view but still visible to you.
- Toggle "Hide overlay from screen share" off in settings: overlay becomes visible in shares again.
- Edit the "Meeting apps" list, relaunch, confirm the new app is detected.
```

- [ ] **Step 4: Stage**

```
git -C . add .for_bepy/BEPY_TODOS.md
```

- [ ] **Step 5: Final commit + submodule push order**

The main agent: commit the kit submodule changes and `git -C vendor/tauri_kit push` FIRST, then commit the pomodoro parent (which stages the bumped submodule pointer via `git add vendor/tauri_kit`) and the app-side files.

---

## Self-Review notes (resolved during planning)

- **Spec coverage:** camera/mic registry (Task 3), WASAPI audio + app list (Task 3), raw-edge event + query (Task 4), screenshare-hide helper (Task 1), stay-until-manual + hotkey toggle + suppression re-arm (Task 11), force-Other-and-start + gate fullscreen + mute sounds (Task 12), settings incl. editable app list + hotkey (Tasks 7, 13), error handling fail-safe (Task 3 returns false on failure), reuse boundary = two standalone kit crates (Tasks 1-5). All covered.
- **App-list liveness:** the kit `MeetingStateStore.apps` Mutex + `set_apps` helper (Task 4) lets the watcher read the allow list every poll. Pomodoro pushes the list on boot (Task 9 Step 2) and on save (Task 10 Step 2). This is live — better than the spec's "read at startup" — and avoids any brittle pre-handle file read.
- **Type consistency:** `MeetingState { active, sources }` and `Sources { camera, mic, audio }` identical across Rust (`lib.rs`, `signal.rs`), the event payload, and TS (`subscribe.ts`). `register_hotkeys` arg order (old_pause, old_skip, old_show_hide, old_meeting, new_pause, new_skip, new_show_hide, new_meeting) consistent across `hotkeys.rs`, `lib.rs`, `commands.rs`.
- **Open risk flagged for implementer:** exact `windows` 0.58 signatures for registry + WASAPI (Task 3 Step 3 note) and the settings `text` field kind (Task 13 Step 2). Both have explicit fallback instructions; neither is a placeholder.
```
