self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const PHASE_LABEL = { work: "Focus", short: "Short break", long: "Long break", other: "Pomodoro" };

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { /* ignore */ }
  event.waitUntil((async () => {
    try {
      const cache = await caches.open("pomodoro-state");
      await cache.put("state", new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      }));
    } catch (e) { /* cache unavailable */ }

    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: "state", data }));

    if (data.event === "phase-end") {
      const ended = PHASE_LABEL[data.endedPhase] || "Phase";
      const next = PHASE_LABEL[data.phase] || "";
      await self.registration.showNotification(`${ended} done`, {
        body: next ? `Now: ${next}` : "Time's up",
        icon: "icon-192.png",
        tag: "pomodoro-phase",
        renotify: true,
      });
    } else if (data.event === "test") {
      await self.registration.showNotification("Test push", {
        body: "Your phone is paired correctly.",
        icon: "icon-192.png",
        tag: "pomodoro-test",
      });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("./index.html"));
});
