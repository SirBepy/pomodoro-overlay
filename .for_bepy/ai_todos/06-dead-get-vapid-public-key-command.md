# Dead Tauri command `get_vapid_public_key` — wire it up or remove it

## Goal

Resolve a dead command introduced in the phone-push feature: `get_vapid_public_key` is defined and registered but never invoked from the frontend (confirmed via Grep across `src/`: 0 references). Either give it a real use or delete it.

## Context

- Defined in `src-tauri/src/ipc/commands.rs` and registered in `src-tauri/src/lib.rs`'s `generate_handler!`. The plan originally intended it for displaying the key / a QR in settings, but the QR was dropped and the PWA gets the VAPID public key via a build-time-injected repo variable (`VAPID_PUBLIC_KEY`) in `.github/workflows/pages.yml`, not via this command. So nothing calls `invoke("get_vapid_public_key")`.
- Found during the 2026-05-29 `/close` code-health pass.
- There is genuine latent value: getting the key currently requires a PowerShell one-liner against `%APPDATA%\com.sirbepy.pomodoro-overlay\settings.json`. A settings affordance would be friendlier.

## Approach

Pick one:
- **Wire it up (preferred):** add a small "VAPID public key" row in the new Settings > Phone section with a copy-to-clipboard button that calls `invoke("get_vapid_public_key")`. This replaces the manual settings.json one-liner when re-deploying the PWA / setting the repo variable. Reuse the `phone-pairing-field.ts` custom-field pattern.
- **Remove it:** delete the command from `commands.rs` + the `generate_handler!` registration in `lib.rs` if the copy-key affordance isn't wanted.

## Acceptance

- `get_vapid_public_key` is either invoked from the frontend (copy-key button works in the running app) or fully removed (command + registration), with `cargo build` + `npm run build` green. No dead registered command remains.
