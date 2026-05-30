# Control the timer from the phone (start / pause / skip remotely)

## Goal

Let Joe drive the desktop pomodoro timer FROM the companion PWA on his phone: start, pause, and skip the current phase remotely, not just view it. This was raised at the end of the 2026-05-29 phone-push session; the decision (build vs defer) was interrupted by `/close` and never made. Joe was ambivalent ("maybe too big / unnecessary").

## Context

- Current architecture is deliberately **one-way: PC talks out, never listens in**. The PC sends VAPID-signed Web Push to the phone (outbound only, no inbound listener, no server). This is the security property Joe explicitly valued ("get my repo and you still can't reach my PC"). See [[reference_pure_rust_web_push]].
- Remote control fundamentally requires a **phone -> PC** channel, which breaks that property. Two options, both with real cost:
  1. Inbound listener on the PC — breaks the no-inbound guarantee + needs the phone to reach the PC (tunnel/LAN). Rejected in discussion.
  2. PC holds an **outbound** long-lived subscription to a relay (e.g. `ntfy.sh/<unguessable-topic>/sse`); the phone POSTs commands to the topic; the PC executes them. Keeps "no inbound port" technically true but **reintroduces a third-party relay** (the very "server" the project avoided) + a persistent always-on connection with reconnect logic. The relay sees the (innocuous) commands.
- Claude's recommendation at session end was **defer**: a pomodoro is used while sitting at the PC, so remote start/pause/skip is low-frequency; the high-value away-from-desk needs (break-over notification + live countdown) are already shipped. Joe even noted the live view feels redundant when he's at the desk.

## Approach

Do NOT build without an explicit decision from Joe (it's an architecture change, needs `/brainstorming` first). If approved, the likely shape:
- Add `ntfy` (or equivalent) as the command transport. PC subscribes outbound to a secret command topic on startup (SSE/long-poll) with reconnect/backoff; verify the crate's safety per the Packages rule before adding.
- Map incoming commands {start, pause, skip} to the existing `startTimer` / `pauseTimer` / `handlePhaseEnd` paths via a Tauri command/event into `src/main.ts`.
- PWA gains start/pause/skip buttons that POST to the command topic.
- Decide auth: unguessable topic id at minimum; consider an HMAC/shared-secret on commands so the topic alone can't drive the timer.
- Honestly document the security tradeoff (no longer strictly outbound-only / no-third-party).

## Acceptance

- A decision is recorded (build or defer). If defer, this todo is closed with that note.
- If built: tapping start/pause/skip in the PWA changes the desktop timer within a couple seconds; PC reconnects to the relay after a network drop; commands are not driveable by someone who doesn't hold the secret; the security tradeoff is written into the spec; no packages added without a passing safety check.
