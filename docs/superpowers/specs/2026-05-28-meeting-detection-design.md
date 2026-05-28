# Meeting detection + screenshare-hide — design

Date: 2026-05-28
Status: approved, pending implementation plan
Driving repo: `pomodoro-overlay` (consumes `vendor/tauri_kit` submodule)

## Goal

While in a meeting/call, the pomodoro overlay should never trigger fullscreen
breaks, never play notification sounds, immediately switch to the count-up
"Other" phase and start timing, and stay hidden from screen-share. The
meeting-detection capability must be reusable by other apps (next consumer:
`claude_usage_in_taskbar`), so detection lives in the shared `tauri_kit`, not
in the pomodoro app.

## Scope (this effort)

- Build two new kit crates + frontend module in the `sirbepy_tauri_kit`
  submodule.
- Fully integrate both into `pomodoro-overlay` (behaviors, hotkey, settings).
- `claude_usage_in_taskbar` integration is explicitly **out of scope** — done
  later in its own session. The kit API must be shaped so it can consume it
  with no kit changes.

## Two independent kit additions

These are unrelated functionalities that happen to land in the same effort.

### 1. `tauri_kit_meeting` — detection signal

New workspace member at `tauri/meeting/`, plus a `frontend/meeting/` TS module
(mirrors the existing settings/updater layout). Crate name `tauri_kit_meeting`.

**Rust API**

- `MeetingConfig { poll_interval: Duration (default 3s), audio_app_names: Vec<String> }`
  - Built-in default `audio_app_names`: `Teams.exe`, `ms-teams.exe`, `Zoom.exe`,
    `CptHost.exe`, `Discord.exe`, `slack.exe`, `Webex.exe`.
- `plugin(config: MeetingConfig) -> TauriPlugin<R>`:
  - On setup, spawns one background poll thread.
  - Registers a query command `kit_meeting_state() -> MeetingState`.
- `MeetingState { active: bool, sources: { camera: bool, mic: bool, audio: bool } }`.

**Per-poll computation (Windows)**

`raw_in_meeting = camera_in_use || mic_in_use || meeting_app_audio_active`

- **camera/mic** — read registry
  `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam`
  and `\microphone`, including the `NonPackaged` subtree. Any app subkey whose
  `LastUsedTimeStop == 0` means the device is in use *right now*. This reads the
  same capability manager that drives the Windows tray privacy icon, so it
  catches browser-based calls (Google Meet in `chrome.exe`/`msedge.exe`) while
  the browser holds the mic or camera.
- **audio** — WASAPI: enumerate active audio sessions on the default *render*
  endpoint (`IMMDeviceEnumerator` → `IAudioSessionManager2` →
  `IAudioSessionEnumerator` → `IAudioSessionControl2`), get each session's PID,
  map PID → process name via a ToolHelp snapshot, match against
  `audio_app_names`. Requires `windows` crate features `Win32_Media_Audio`,
  `Win32_System_Com`, `Win32_System_Diagnostics_ToolHelp`,
  `Win32_System_Threading`. COM is initialized on the poll thread.

**Emission**

The kit emits **raw** edges only — it does NOT latch. On each transition of
`raw_in_meeting`, emit a Tauri event `meeting://changed` with payload
`{ active, sources }`. The query command returns the latest raw state. All
latch / override / suppression policy lives in the consuming app.

### 2. `tauri_kit_window` — screenshare-hide helper

New crate `tauri_kit_window` at `tauri/window/`. Standalone; no relation to the
meeting signal.

- `exclude_from_capture<R>(window: &WebviewWindow<R>, excluded: bool) -> Result<()>`
  → `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` when excluded,
  `WDA_NONE` when not. Window stays visible to the user, invisible to screen
  capture/share. Win10 2004+ (fine on the target Win11).
- Plus a Tauri command wrapper so the JS layer can toggle it.

## Pomodoro integration (owns ALL policy)

### Policy state machine (JS, `main.ts`)

Effective `meetingActive` derived from kit raw edges + manual override:

- Raw rising edge (`false→true`) AND not suppressed → **enter** meeting-mode.
- **Stay until manual**: once active, ignore raw falling edges.
- Hotkey toggle:
  - active → **deactivate** + arm suppression.
  - inactive → **force activate** (covers undetected silent browser calls).
- Suppression clears (auto-detect re-armed) only when raw `active` goes `false`
  — edge-triggered, so forcing OFF mid-call won't immediately re-trigger.

### On enter meeting-mode

- `phase = PHASE_OTHER`, start running (existing count-up stopwatch; logs as
  "Other" in stats).
- Set gate flags: block fullscreen, mute phase-end sounds.

### On exit meeting-mode (hotkey off)

- Stop the Other stopwatch, revert to `PHASE_WORK` stopped (mirrors the existing
  `PHASE_OTHER → PHASE_WORK` transition in `main.ts`).

### Behavior gates

- Fullscreen-on-break trigger: skip while `meetingActive`.
- Phase-end sound playback: skip while `meetingActive`.

### Screenshare-hide

- Call `exclude_from_capture(main_window, settings.meeting_hide_from_capture)`
  on boot and whenever the setting toggles. Default **on**.

### Hotkey

- `tauri-plugin-global-shortcut` (already a dep) registers the configured
  toggle shortcut; on press it emits a JS event the policy SM consumes.

### Settings

New "Meeting mode" section. Add to BOTH `schema.ts` AND the Rust settings
struct + `Default` impl (else fields reset on restart):

- `meeting_detection_enabled: bool` — master toggle.
- `meeting_hide_from_capture: bool` (default true) — screenshare-hide.
- `meeting_apps: String` — comma-separated process-name list, pre-filled with
  the kit defaults, fully editable (user can add or remove any entry). Parsed
  into `MeetingConfig.audio_app_names` and passed to the watcher at plugin
  setup; edits take effect on next app restart (consistent with other
  startup-read settings — no live re-read of the list).
- `keybind_meeting_toggle: String` — keybind field for the manual toggle.

## Data flow

```
Win APIs ─poll 3s→ kit watcher ─raw compute→ emit meeting://changed
                                                      │
                                          main.ts policy SM (latch + override)
                                                      │
                                   effective meetingActive ─gates→ phase / fullscreen / sound
hotkey ─global-shortcut→ JS event ─────────────────────┘
settings ─→ Rust config (apps list, poll) + JS (hide toggle → exclude_from_capture)
```

## Error handling

- Registry key missing / access denied → treat signal as not-in-use (fail safe
  to not-in-meeting). Log once.
- WASAPI / COM failure → audio signal `false`, log, never crash the poll thread
  (catch per-poll).
- `meeting_detection_enabled == false` → JS policy SM ignores `meeting://changed`
  events (watcher still runs; it's cheap). Screenshare-hide is independent.
- Hotkey-register conflict → log + surface via the existing keybind error path.

## Testing

- **Kit Rust**: isolate the Win32 calls behind a `SignalSource` trait; unit-test
  the pure **combine** logic (camera/mic/audio booleans + app-name match) with
  fakes. Real registry/WASAPI behavior = manual QA.
- **Pomodoro JS**: vitest the **policy state machine** — rising edge enters,
  stay-until-manual ignores falling edge, hotkey toggle both ways, suppression
  re-arm only after raw clears. Pure logic, highest-value tests.
- **Manual QA → `.for_bepy/BEPY_TODOS.md`**: real camera / Teams / Zoom / Meet
  detection, screenshare-hide visual check, hotkey. Tauri IPC + WinAPI can't be
  Playwright-driven.

## Known gap (by design)

A browser-based call (Google Meet / Teams-web) with mic **and** camera off from
the very start and never toggled is invisible — the browser never acquires a
device, and the process (`chrome.exe`) is indistinguishable from a YouTube tab.
The manual hotkey covers this. In practice the mic or camera is on at join, so
the rising-edge + stay-until-manual latch keeps meeting-mode active for the whole
call even after muting. Native apps (Teams/Zoom/Discord/Slack) are covered even
cold cam+mic-off via the audio-session check.

## Performance / size

One background thread sleeping 3s between checks; each check is a couple of
registry reads (µs) + one WASAPI enumeration (ms). Idle CPU ~0%. No new external
dependency and no bundled binary — only extra `windows`-crate feature flags
(thin FFI bindings, tens of KB). Release profile already strips + LTOs.

## Cross-repo notes

- Kit changes are made in the `sirbepy_tauri_kit` submodule and must be pushed
  **before** the pomodoro parent commit that bumps the submodule pointer, or CI
  fails with "not our ref".
- `windows` crate is already a pomodoro dep at 0.58 — add features, no new dep.
- `tauri-plugin-global-shortcut` is already a pomodoro dep.
