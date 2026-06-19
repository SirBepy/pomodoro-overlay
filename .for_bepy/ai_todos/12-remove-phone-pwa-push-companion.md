# Rip out the entire phone-companion / web-push / PWA feature

## Goal

Remove all code, deps, settings, the companion PWA, and the Pages deploy for the
phone-push companion. We're abandoning the feature (old todos 04 "phone
notifications + companion PWA" and 05 "remote control timer from phone" deleted).
Note: the "remote control from phone" half (05) was never built - there is no
phone->desktop control code, only one-way push. So this is purely removing the
push-notification companion. After removal the app builds/typechecks/tests clean
with zero dangling references.

## Context

Inventory below was produced by a read-only audit on 2026-06-20. Line numbers will
drift - the symbol/file names are the stable anchors. Project rule: a settings key
must be removed from BOTH `src/views/settings/schema.ts` AND
`src-tauri/src/settings.rs` (struct + Default) in lockstep, or it half-resets.

The push path is fire-and-forget and does not feed timer logic, so removing
`pushState` cannot change timer behavior (the timer-state machine in
`src/views/timer/timer-state.ts` only CALLS it; nothing reads its result).

## Approach

### Frontend - delete outright
- `src/views/settings/phone-pairing-field.ts` (exports `phonePairingField()`; calls `get_pairing_status`/`pair_phone`/`send_test_push`/`get_vapid_public_key`; listens `push-subscription-gone`). Used only by schema.ts.
- `src/views/settings/phone-pairing-field.css` (imported only by the above).

### Frontend - partial edits
- `src/views/settings/schema.ts`: drop the `phonePairingField` import and the entire **"Phone"** section/group (the `phone_pairing` field + the toggles `phone_notify_enabled`, `notify_on_work_end`, `notify_on_short_end`, `notify_on_long_end`).
- `src/views/timer/timer-state.ts`: delete the `pushState()` method and ALL 5 call sites (in `start()`, `pause()`, and the 3 branches of `runPhaseEnd()`). Also drop `pushState` mention from the `TimerDeps` usage if any. Re-run `src/views/timer/__tests__/timer-state.test.ts` - it does not assert on pushState, so it should stay green.
- `src/main.ts`: delete the `listen("push-subscription-gone", ...)` handler.

### Rust (`src-tauri/src/`)
- Delete the whole `push/` module: `push/mod.rs` (web-push sender) + `push/vapid.rs` (VAPID keygen).
- `ipc/commands.rs`: delete commands/helpers `get_vapid_public_key`, `get_pairing_status`, `pair_phone`, `push_inputs`, `do_send`, `push_state`, `send_test_push`, and the `use crate::push::{...}` import.
- `lib.rs`: remove `mod push;`, the 6 command names from the `use ipc::commands::{...}` list, the first-run VAPID keygen block (`if settings.vapid_private_key.is_empty() { push::vapid::generate_vapid_keypair() ... }`), and the 5 registrations in the `invoke_handler!` list (`get_vapid_public_key`, `get_pairing_status`, `pair_phone`, `push_state`, `send_test_push`).
- `settings.rs`: delete struct fields `phone_notify_enabled`, `notify_on_work_end`, `notify_on_short_end`, `notify_on_long_end`, `push_subscription`, `vapid_private_key`, `vapid_public_key`; their Default entries; and the `#[cfg(test)] mod tests` block (`settings_roundtrip_includes_push_fields`, `missing_push_fields_fall_back_to_default`).

### Dependencies
- `src-tauri/Cargo.toml`: drop `web-push-native`, `reqwest`, `p256`, `jwt-simple`, `rand_core`, `base64`. AUDIT-CONFIRMED these are push-only (reqwest/base64 not used elsewhere) - but re-grep before deleting in case later work added a user.
- `package.json`: nothing to drop (no web-push JS deps).

### PWA site + deploy
- Delete the `pwa/` dir (index.html, app.js, sw.js, manifest.webmanifest, icon-192.png, icon-512.png).
- Delete `.github/workflows/pages.yml` (the Pages deploy + VAPID injection).

### Stale references / docs
- `docs/superpowers/plans/2026-05-29-phone-push-companion.md` and `docs/superpowers/specs/2026-05-29-phone-push-companion-design.md`: delete (or archive).
- `.for_bepy/BEPY_TODOS.md`: remove the "Phone push companion", "Visual QA - phone push companion", and "VAPID copy-key button" sections.
- Grep for stragglers: `push_state`, `vapid`, `web_push`/`webpush`, `pair`, `subscription`, `service worker`, `notify_phone`, `companion`.

### Manual follow-up for Joe (not Claude-doable)
- GitHub: disable the Pages site (or it 404s), and delete the `VAPID_PUBLIC_KEY` Actions repo variable.

## Acceptance

- `npm run build` clean; `npx vitest run` green (timer-state tests still pass).
- `cargo check` clean inside `src-tauri/` (no unused-dep / missing-symbol errors); `cargo test` green (push test module gone).
- No remaining references to any removed symbol (grep list above returns nothing in `src/` or `src-tauri/src/`).
- schema.ts and settings.rs changed in lockstep - no orphaned key on either side.
- `pwa/` and `.github/workflows/pages.yml` gone; no workflow references `pwa/**`.
- Timer behavior unchanged (pushState removal is side-effect-only).
