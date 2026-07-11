# Refresh CI workflow now that the push/web-push stack is gone

Type: code-health

## Goal

`.github/workflows/ci.yml` still describes itself around the now-removed
phone-push / web-push feature (deleted in this session). The workflow still runs
and passes, but its comments and one step name are misleading.

## Context

The openssl-sys guard was originally justified by the pure-Rust web-push design
("web-push needed OpenSSL, so we picked a pure-Rust stack and guard against
openssl-sys re-entering"). With the whole push module + its crypto deps
(web-push-native, reqwest, p256, jwt-simple, rand_core, base64) removed, that
rationale no longer applies.

Stale references (line numbers will drift):
- Header comment block mentioning "the push stack" / "pure-Rust web-push design".
- Step name: `Verify crate compiles (incl. pure-Rust push crypto)`.

## Approach

Decide per intent:
- If the "no openssl-sys in the tree" invariant is still wanted as a general
  guard: keep the check, just drop the push-specific wording from the comments
  and rename the step to something like `Verify crate compiles (no openssl-sys)`.
- If the guard existed ONLY for push: consider removing the openssl-sys assertion
  and keeping a plain `cargo check` compile gate.

Left out of the removal PR on purpose: ci.yml was outside todo 12's scope and
touching the release/CI guard is higher blast-radius than a cosmetic fix, so it
wants a deliberate call rather than an autopilot guess.

## Acceptance

- ci.yml has no remaining references to push / web-push / VAPID / PWA.
- The workflow still runs on push/PR and passes.
