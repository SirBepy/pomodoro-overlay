// __VAPID_PUBLIC_KEY__ is replaced at deploy time (Task 8).
const VAPID_PUBLIC_KEY = "__VAPID_PUBLIC_KEY__";

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function setStatus(s) { document.getElementById("status").textContent = s; }

async function enable() {
  const reg = await navigator.serviceWorker.register("sw.js");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { setStatus("Notifications blocked"); return; }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  showPairing(btoa(JSON.stringify(sub.toJSON())));
}

function showPairing(code) {
  document.getElementById("enable").hidden = true;
  const pairing = document.getElementById("pairing");
  pairing.hidden = false;
  document.getElementById("code").textContent = code;
  document.getElementById("copy").onclick = () => navigator.clipboard.writeText(code);
}

// ---- Live view: render from last pushed state (stored by the SW) ----
let latest = null;
function render() {
  if (!latest) return;
  document.getElementById("live").hidden = false;
  document.getElementById("phase").textContent = latest.phase;
  const now = Date.now();
  let remaining;
  if (latest.running && latest.etaEpochMs > 0) {
    remaining = Math.max(0, Math.round((latest.etaEpochMs - now) / 1000));
    const eta = new Date(latest.etaEpochMs);
    document.getElementById("eta").textContent =
      "Ends ~" + eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    remaining = latest.remainingSec || 0;
    document.getElementById("eta").textContent = "Paused";
  }
  const m = String(Math.floor(remaining / 60)).padStart(2, "0");
  const s = String(remaining % 60).padStart(2, "0");
  document.getElementById("count").textContent = `${m}:${s}`;
  const ageSec = Math.round((now - (latest.updatedAtMs || now)) / 1000);
  document.getElementById("stale").textContent =
    ageSec > 90 ? `updated ${Math.round(ageSec / 60)}m ago` : "";
}
setInterval(render, 1000);

navigator.serviceWorker.addEventListener("message", (e) => {
  if (e.data && e.data.type === "state") { latest = e.data.data; render(); }
});

async function loadCachedState() {
  try {
    const cache = await caches.open("pomodoro-state");
    const res = await cache.match("state");
    if (res) { latest = await res.json(); render(); }
  } catch (e) { /* no cached state yet */ }
}

document.getElementById("enable").onclick = () => enable().catch((e) => setStatus(String(e)));
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(loadCachedState);
}
