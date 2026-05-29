# Phone notifications + companion PWA for the pomodoro timer

## Goal

Let Joe get notified on his phone when break time (or a phase) finishes, and ideally view the live timer from his phone: what's running, how much time is left, and when it'll be done. Likely shape: a small companion PWA he can install on his phone that shows live timer state and receives push notifications.

## Context

- The app is a local Windows desktop overlay (Tauri 2 + vite, lit-html). All timer state lives in `src/main.ts` (phase, remainingSec, running, intervalStartMs). There is no backend - everything is local/in-memory + localStorage.
- Phase transitions fire in `handlePhaseEnd` (`src/main.ts`); that's the natural hook for "break finished" / "phase finished" events to publish outward.
- To reach a phone, timer state and/or events must leave the machine. Two distinct asks:
  1. **Notifications** (event push): "break is over" -> phone notification. Lower effort.
  2. **Live view** (state mirror): phone shows current phase + countdown + ETA. Higher effort (needs continuous state sync).
- Constraints from CLAUDE.md: never install packages/tooling without asking; verify any third-party service is legit before suggesting; prefer in-memory, justify any persistence; this repo deploys via GitHub Actions on a package.json version bump.
- Project has a `/pwa` skill and `/github-pages-init` skill available, which may help scaffold/host a PWA.

## Approach

This is a research-then-build task; start by deciding the transport, then build. Sketch of options to evaluate (don't pre-commit):

- **Notifications-only, simplest:** desktop POSTs to a topic-based push service on phase end; phone gets a push. Candidates to vet: `ntfy.sh` (free, topic-based, has an Android/iOS app + web), Pushover (paid, polished), or Web Push to an installed PWA. ntfy is likely the fastest path - desktop just HTTP POSTs `https://ntfy.sh/<secret-topic>` from `handlePhaseEnd` (Rust `reqwest` is already a dep in the kit/other projects; pomodoro would need an HTTP call - check deps before adding). VERIFY ntfy is safe/legit before relying on it.
- **Companion PWA (live view + notifications):** a static PWA (host on GitHub Pages via `/github-pages-init`) that:
  - Receives live timer state. Needs a sync channel: a tiny cloud relay (e.g., a free realtime KV / a websocket relay / Firebase) that the desktop publishes state to and the PWA subscribes to. Evaluate the cheapest no-backend option.
  - Renders remaining time + ETA (compute end time = now + remainingSec, display countdown locally so it stays smooth without constant pushes).
  - Uses Web Push (service worker + push subscription) for the "break done" notification, OR piggybacks on ntfy.
- Decide: do notifications first (high value, low effort), then layer the live-view PWA if Joe still wants it.
- Privacy: timer state is innocuous, but a push topic/relay should use an unguessable id so it isn't world-readable.

Rejected/with caveats: a fully self-hosted backend is overkill for one user; prefer a free hosted relay or topic-push. Continuous high-frequency state push is wasteful - push only on phase change + let the phone compute the countdown from an ETA timestamp.

## Acceptance

- When a break (or configured phase) ends on the desktop, Joe's phone shows a notification within a few seconds.
- (Stretch) Joe can open a PWA on his phone and see the current phase, time remaining, and projected finish time, updating live.
- No secrets/topics committed to the repo; any service used is verified legit first; no packages added without asking Joe.
- Desktop behavior unchanged when offline (notification push fails silently, timer keeps working).
