//! Widget bridge: newline-delimited JSON over a loopback TCP socket so an
//! external local app (taskbar widget host) can read live timer state and
//! send commands. No HTTP/WS - just plain TCP, since the consumer is a small
//! trusted local process.
use crate::state::{FullscreenState, HostSuppressionState};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use uuid::Uuid;

const DISCOVERY_FILENAME: &str = "widget-bridge.json";

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TimerStateSnapshot {
    pub phase: String,
    pub running: bool,
    pub anchor_ms: i64,
    pub anchor_remaining_sec: i64,
    pub reported_at_ms: i64,
    pub work_sessions_completed: u32,
}

/// Wraps a watch channel so every connected client can subscribe independently
/// and get the latest snapshot broadcast on change (pattern: SettingsState in
/// settings.rs, but a watch channel instead of a Mutex since clients need to
/// be woken on update, not just read on demand).
pub struct TimerBridgeState(pub watch::Sender<Option<TimerStateSnapshot>>);

#[tauri::command]
pub fn report_timer_state(state: tauri::State<TimerBridgeState>, snapshot: TimerStateSnapshot) {
    let _ = state.0.send(Some(snapshot));
}

pub fn new_state() -> TimerBridgeState {
    TimerBridgeState(watch::channel(None).0)
}

/// Two v4 uuids concatenated (64 hex chars) - simplest source of 32+ random
/// hex chars without a new crate (uuid is already a dep).
pub fn generate_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn state_line(s: &TimerStateSnapshot) -> String {
    let mut v = serde_json::to_value(s).unwrap_or_else(|_| json!({}));
    if let Some(obj) = v.as_object_mut() {
        obj.insert("type".into(), json!("state"));
    }
    v.to_string()
}

fn write_discovery_file(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let body = json!({ "port": port, "token": token }).to_string();
    std::fs::write(dir.join(DISCOVERY_FILENAME), body).map_err(|e| e.to_string())
}

/// Binds an OS-assigned loopback port, writes the discovery file, then accepts
/// clients forever. Spawned once from lib.rs setup via tauri::async_runtime::spawn.
pub async fn run_server(app: AppHandle, tx: watch::Sender<Option<TimerStateSnapshot>>, token: String) {
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            log::warn!("widget-bridge: bind failed: {e}");
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(e) => {
            log::warn!("widget-bridge: local_addr failed: {e}");
            return;
        }
    };
    if let Err(e) = write_discovery_file(&app, port, &token) {
        log::warn!("widget-bridge: discovery file write failed: {e}");
    }
    log::info!("widget-bridge: listening on 127.0.0.1:{port}");

    loop {
        let (socket, _) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                log::warn!("widget-bridge: accept failed: {e}");
                continue;
            }
        };
        let app = app.clone();
        let rx = tx.subscribe();
        let token = token.clone();
        tauri::async_runtime::spawn(handle_client(socket, app, rx, token));
    }
}

// No `tokio::select!` here (its "macros" feature isn't in the resolved tree and
// would pull in the tokio-macros crate). Read and write run as two independent
// spawned tasks per client instead - the read side never writes back anyway
// (commands get no response; the state push loop is the only writer).
async fn handle_client(
    socket: TcpStream,
    app: AppHandle,
    mut rx: watch::Receiver<Option<TimerStateSnapshot>>,
    token: String,
) {
    let (reader, mut writer) = socket.into_split();
    let mut lines = BufReader::new(reader).lines();

    // First line must be {"auth": token}; anything else and we close.
    let Ok(Some(first)) = lines.next_line().await else { return };
    let authed = serde_json::from_str::<serde_json::Value>(&first)
        .ok()
        .and_then(|v| v.get("auth").and_then(|a| a.as_str()).map(str::to_string))
        .is_some_and(|t| t == token);
    if !authed {
        return;
    }

    tauri::async_runtime::spawn(async move {
        // Bind the clone before the `if let` - the watch::Ref temporary from
        // `.borrow()` otherwise lives across the whole if-let block (matching
        // `match` scoping rules) and its !Send guard poisons the spawned future.
        let initial = rx.borrow().clone();
        if let Some(snap) = initial {
            if writer.write_all(format!("{}\n", state_line(&snap)).as_bytes()).await.is_err() {
                return;
            }
        }
        loop {
            if rx.changed().await.is_err() {
                return;
            }
            let Some(snap) = rx.borrow().clone() else { continue };
            if writer.write_all(format!("{}\n", state_line(&snap)).as_bytes()).await.is_err() {
                return;
            }
        }
    });

    loop {
        match lines.next_line().await {
            Ok(Some(l)) => dispatch_command(&app, &l),
            _ => break,
        }
    }
    // One mechanism covers the host quitting, crashing and being killed alike,
    // so suppression can never outlive the connection that asked for it.
    set_compact_suppression(&app, false);
}

fn dispatch_command(app: &AppHandle, line: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return };
    let Some(cmd) = v.get("cmd").and_then(|c| c.as_str()) else { return };
    // Handled here, not forwarded: every show/hide site is Rust-side.
    // `suppress_fullscreen` is ignored outright, nothing may hide the break view.
    if cmd == "host_overlay" {
        let on = v.get("suppress_compact").and_then(|s| s.as_bool()).unwrap_or(false);
        set_compact_suppression(app, on);
        return;
    }
    let phase = v.get("phase").and_then(|p| p.as_str());
    let _ = app.emit("bridge-command", json!({ "action": cmd, "phase": phase }));
}

/// True while a connected widget host owns the compact surface. Every site that
/// would show the corner window checks this; the fullscreen path never does.
pub(crate) fn compact_suppressed(app: &AppHandle) -> bool {
    app.try_state::<HostSuppressionState>()
        .and_then(|s| s.0.lock().ok().map(|g| g.is_some()))
        .unwrap_or(false)
}

fn is_fullscreen(app: &AppHandle) -> bool {
    app.try_state::<FullscreenState>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

/// Applies the host's `suppress_compact`. Idempotent: the host resends the same
/// value on each of its own settings saves, so this is a state, not an event.
pub(crate) fn set_compact_suppression(app: &AppHandle, on: bool) {
    // Resolved before the suppression lock is taken, so the two are never held
    // at once and no lock order exists to get wrong.
    let fullscreen = is_fullscreen(app);
    let Some(win) = app.get_webview_window("main") else { return };
    let Some(state) = app.try_state::<HostSuppressionState>() else { return };
    let Ok(mut guard) = state.0.lock() else { return };
    match (on, guard.is_some()) {
        (true, false) => {
            *guard = Some(win.is_visible().unwrap_or(true));
            // Deliberately not toggle_main_visibility's path: that dims the tray
            // icon, and being hosted elsewhere is not the user hiding the app.
            if !fullscreen {
                crate::ipc::window::hide_main(&win);
            }
        }
        (false, true) => {
            if guard.take().unwrap_or(true) && !fullscreen {
                let _ = win.show();
            }
        }
        _ => {}
    }
}
