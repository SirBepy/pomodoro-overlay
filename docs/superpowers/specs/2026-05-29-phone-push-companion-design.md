# Phone Push Notifications + Live-View Companion PWA

**Date:** 2026-05-29
**Status:** Approved design, pending spec review
**Source todo:** `.for_bepy/ai_todos/04-phone-notifications-and-companion-pwa.md`

## Goal

When a pomodoro phase ends on the Windows desktop overlay, push a notification to
Joe's Android phone. Additionally, let Joe open a small installed PWA on his phone
that shows the **current phase, live countdown, and projected finish time**.

Constraints: **$0, no paid server, no inbound attack surface on the PC, Android only.**

## Non-goals

- iOS support (explicitly out of scope; do not spend effort on iOS Web Push quirks).
- A continuous high-frequency state stream (push only on discrete state changes).
- Queuing/delivering notifications while the PC is asleep or offline (best-effort only).
- Any third-party relay that can see the timer data or the push secrets.

## Architecture

### The core trick: PC is the sender, no inbound surface

Phone and PC never talk directly. Both talk to Google's free Web Push endpoint
(FCM under the hood for Android Chrome):

1. The phone's PWA subscribes to push → receives a **subscription** (an endpoint URL
   + a `p256dh` public key + an `auth` secret).
2. The subscription travels to the PC **once** (one-time pairing) and is persisted.
3. On a phase/state change, the desktop app signs a VAPID JWT, encrypts the payload
   with the subscription keys, and makes an **outbound** HTTPS POST to the endpoint.
   Google relays it to the phone. The phone's service worker shows the notification
   and/or updates stored state, even when the PWA is closed.

The PC **never listens** for inbound connections. There is no port, no server, no
endpoint on the PC. This is the load-bearing security property (see Security).

### Components

1. **Companion PWA** (new, static) — hosted free on GitHub Pages over HTTPS
   (required for service workers / push to register).
   - `index.html`, web app manifest, service worker (`sw.js`).
   - "Enable notifications" button → registers SW, requests notification permission,
     subscribes with the embedded VAPID **public** key.
   - Displays a **pairing code** (the subscription, JSON → compact base64url) with a
     "Copy" button and a QR rendering of the same code.
   - **Live view:** renders current phase + a locally-ticking countdown computed from
     the last pushed `etaEpochMs`, plus a projected finish time, plus a
     **"updated Ns ago"** staleness stamp. The page never pulls from the PC; it
     renders from the most recent push payload the SW persisted.
   - Service worker handles `push` events: parse payload → show notification (on
     phase-end events) and/or store latest state for the live view.

2. **VAPID keypair** — generated on the **PC on first run** (so the private key never
   exists off-machine and is unique per install).
   - Public key: needed by the PWA. Embedded at PWA build time. (Public by design.)
   - Private key: stored in PC settings only. Never committed.

3. **Pairing (one-time)** — copy the subscription code from the phone into the
   desktop settings ("Pair phone" field). PC persists it. Survives restarts/reboots.
   Re-pair only needed if the PWA is reinstalled or its data cleared, or the
   subscription expires (see Reliability).

4. **Rust push-sender module** (new, e.g. `src-tauri/src/push.rs`) — exposed as a
   Tauri command `push_state(payload)`. All timer state lives in the frontend
   (`src/main.ts`), so the frontend invokes this command from its existing
   phase/state hooks (`handlePhaseEnd` and the start/pause/skip handlers). The
   command signs VAPID + encrypts + POSTs. **Requires the `web-push` crate**
   (verification gate below).

5. **Settings** (both `schema.ts` AND `settings.rs` struct + `Default`, per project
   rule — otherwise the field resets on restart):
   - `phoneNotifyEnabled: bool` (master toggle, default false).
   - Per-phase toggles: notify on end of Work / Short / Long (default: all on when
     master enabled).
   - `pushSubscription: Option<String>` (the paired subscription; secret, local only).
   - `vapidPrivateKey: String` (generated first run; secret, local only).
   - `vapidPublicKey: String` (generated first run; mirrored for display/QR).

### Data flow

```
[desktop state change] → Tauri command "push_state"
  → push.rs: build payload {phase, running, etaEpochMs, event}
  → if phoneNotifyEnabled && subscription present:
       sign VAPID (private key) + encrypt (subscription keys)
       POST (Urgency: high) → subscription endpoint  [outbound only]
  → Google relays → phone SW `push` event
       → store latest state (live view)
       → if event is a phase-end (and that phase's toggle on): showNotification(...)
```

State is pushed on: **phase-end, start/resume, pause, skip**. All event-driven and
infrequent. The phone computes the countdown locally between pushes from
`etaEpochMs`, so it stays accurate without a stream.

## Reliability (folded-in lifts — the silent-failure killers)

Web Push on Android is mostly reliable (it rides FCM) but has known silent-failure
modes. The design addresses each so failures are **loud**, not silent:

1. **High urgency:** send the `Urgency: high` header so Doze/battery optimization
   doesn't defer the notification.
2. **Subscription expiry:** the endpoint returns **HTTP 404/410** when a subscription
   has been retired (they rotate). On 404/410, clear the stored subscription and
   surface a desktop prompt: "Phone unpaired — re-pair to keep getting alerts."
   This converts the classic "it just silently stopped working" into a visible state.
3. **Test push:** a "Send test push" button in settings POSTs a test notification on
   demand, so the pipe can be verified without waiting for a phase to end.
4. **CI build gate:** add a GitHub Actions step that compiles the `web-push` crate on
   the Windows runner as a gate **before** the release build, so the crypto
   dependency can't silently break the signed auto-update pipeline.
5. **Best-effort, non-blocking:** all send failures are logged and swallowed. The
   desktop timer is never affected by a push failure or by being offline. Offline /
   asleep at the moment of a phase-end = no push for that event (not queued); this is
   accepted (the PC is on while working, which is when notifications matter).
6. **Staleness on the phone:** the live view stamps "updated Ns ago" so a stale
   state (PC offline) is never shown as if it were live.

## Security

The driving requirement: someone obtaining the (public, for GitHub Pages) repo must
gain **nothing** usable against the PC.

- **No inbound surface.** The PC runs no listener/server/port. A repo cloner has
  nothing on the PC to connect to. The repo is a dead end for PC access.
- **No secrets in the repo.** Only the VAPID **public** key ships in the PWA (public
  by design, useless alone). The VAPID **private key** and the **phone subscription**
  live only in local PC settings (appdata), generated on the PC, never committed.
  A `.gitignore` / commit guard ensures no key file is ever staged.
- **Both secrets required to push.** Sending to the phone needs the subscription AND
  the VAPID private key. Neither is in the repo → a repo cloner cannot notify the
  phone, see the timer, or reach the PC.
- **Public PWA is harmless.** Anyone can open the GitHub Pages page, but subscribing
  only registers *their* phone, which the PC has never stored → nothing flows to
  them. State only goes to subscriptions the PC holds (just Joe's).
- **Payload is end-to-end encrypted.** Web Push encrypts the payload with the phone's
  keys; Google relays ciphertext it cannot read. The relay sees nothing.

## Dependencies (asking gate)

- **`web-push` Rust crate** (or equivalent vetted crate). New dependency. **Must be
  verified legit on crates.io and asked-for before adding**, per CLAUDE.md. It pulls
  a crypto backend (ring/openssl) — the CI build gate above exists to catch breakage.
- PWA hosting: GitHub Pages via the existing `/github-pages-init` skill. No new
  paid service.
- QR rendering in the PWA: a tiny vendored/CDN QR lib (asking gate if a package).

## What only Joe can do (physical phone steps)

1. Install the PWA on Android + grant notification permission.
2. One-time: copy the pairing code from phone → desktop settings.

Everything else (PWA build/deploy, VAPID generation, Rust sender, settings, CI gate)
is built by Claude.

## Acceptance criteria

- Ending an enabled phase on the desktop shows a notification on Joe's Android within
  a few seconds (PC awake + online).
- Opening the PWA shows current phase, a live local countdown, projected finish, and
  a "updated Ns ago" stamp.
- "Send test push" delivers a notification on demand.
- An expired subscription produces a visible "re-pair" prompt, not silent failure.
- Desktop timer behaves identically when offline (push fails silently, timer unaffected).
- No secrets/subscriptions/private keys committed to the repo.
- The `web-push` build is gated in CI on the Windows runner before release.
- New settings fields persist across restart (present in both `schema.ts` and
  `settings.rs` struct + `Default`).

## Product-readiness note (future)

Joe may later promote this as a proper product. The serverless "each PC sends to its
own phone" model scales to many users at **$0 marginal push-infra cost** (no central
FCM bill), which is a real advantage over a server-backed competitor. The one part
that would need a glow-up for mass-market is **pairing UX**: the one-time copy-paste
code is fine for a power user but too clunky for a general audience. A future
productization would replace it with QR-scan pairing or an optional account-based
relay. Out of scope now; noted so the current design isn't mistaken for the final
product surface.

## Open questions / risks

- Subscription code size: the base64url subscription is a long string. Windows Phone
  Link shared clipboard makes paste trivial; QR is the fallback. Acceptable for a
  one-time step.
- Service-worker update/caching on GitHub Pages can serve stale SW code — the SW must
  use a cache-busting/`skipWaiting` update strategy so PWA updates land.
