const { invoke } = window.__TAURI__.core;
const { emit } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

const fields = [
  ["work_minutes", "number"],
  ["short_break_minutes", "number"],
  ["long_break_minutes", "number"],
  ["sessions_before_long_break", "number"],
  ["corner", "select"],
  ["size", "select"],
  ["always_on_top", "checkbox"],
  ["idle_opacity", "number"],
  ["auto_collapse", "checkbox"],
  ["sound_enabled", "checkbox"],
  ["volume", "number"],
  ["auto_advance", "checkbox"],
  ["autostart", "checkbox"],
  ["return_to_corner_seconds", "integer"],
];

let soundPath = null;
let original = null;

function loadInto(s) {
  original = s;
  soundPath = s.sound_path;
  fields.forEach(([key, type]) => {
    const el = document.getElementById(key);
    if (!el) return;
    if (type === "checkbox") el.checked = !!s[key];
    else el.value = s[key];
  });
  document.getElementById("sound-path-display").textContent =
    soundPath || "Default tone";
}

function readForm() {
  const out = { ...original };
  fields.forEach(([key, type]) => {
    const el = document.getElementById(key);
    if (!el) return;
    if (type === "checkbox") out[key] = el.checked;
    else if (type === "number") out[key] = parseFloat(el.value);
    else if (type === "integer")
      out[key] = Math.round(parseFloat(el.value) || 0);
    else out[key] = el.value;
  });
  out.sound_path = soundPath;
  return out;
}

document.getElementById("pick-sound").addEventListener("click", async () => {
  try {
    const p = await invoke("pick_sound_file");
    if (p) {
      soundPath = p;
      document.getElementById("sound-path-display").textContent = p;
    }
  } catch (e) {
    console.warn("pick_sound_file failed", e);
  }
});

document.getElementById("reset-sound").addEventListener("click", () => {
  soundPath = null;
  document.getElementById("sound-path-display").textContent = "Default tone";
});

document.getElementById("save").addEventListener("click", async () => {
  const s = readForm();
  await invoke("save_settings", { settings: s });
  await emit("settings-updated");
});

document.getElementById("close").addEventListener("click", async () => {
  await getCurrentWindow().close();
});

(async () => {
  const s = await invoke("get_settings");
  loadInto(s);
})();
