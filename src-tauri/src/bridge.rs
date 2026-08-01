//! Widget bridge: newline-delimited JSON over a loopback TCP socket so an
//! external local app (taskbar widget host) can read live timer state and
//! send commands. No HTTP/WS - just plain TCP, since the consumer is a small
//! trusted local process.
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
            _ => return,
        }
    }
}

fn dispatch_command(app: &AppHandle, line: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return };
    let Some(cmd) = v.get("cmd").and_then(|c| c.as_str()) else { return };
    let phase = v.get("phase").and_then(|p| p.as_str());
    let _ = app.emit("bridge-command", json!({ "action": cmd, "phase": phase }));
}
