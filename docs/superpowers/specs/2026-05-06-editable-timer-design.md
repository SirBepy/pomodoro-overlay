# Editable Timer While Paused

## Overview

Add a setting that, when enabled, lets the user click the timer display while paused to type in a new time using a calculator-style digit-shift input.

## Setting

- Key: `editable_when_paused`
- Kind: `toggle`
- Label: `Edit timer while paused`
- Section: Times (in `schema.ts`)
- Default: `false`

## Edit Mode Trigger

Conditions that must all be true to enter edit mode on click:

- `settings.editable_when_paused === true`
- `running === false`
- `phase !== PHASE_SNOOZE`

The `.timer` element gets `cursor: text` (via a CSS class, e.g. `timer-editable`) whenever these conditions are met. On click, edit mode activates.

## Input Behavior

Calculator-style digit shift:

- Internal state: 4-character buffer `["0","0","0","0"]` representing MMSS
- Initial state when entering edit mode: populated from current `remainingSec` (e.g. 90 sec → `["0","1","3","0"]`)
- On digit keydown (`0-9`): shift buffer left by one, append new digit
  - Example: buffer `["0","1","3","0"]`, press `5` → `["1","3","0","5"]` → displays `13:05`
- Display updates live as digits are typed: `buf[0]buf[1]:buf[2]buf[3]`
- Non-digit keys (except Enter/Escape) are ignored

## Confirmation and Cancellation

- **Confirm:** Enter key or blur (clicking anywhere outside the timer)
  - Parse buffer: `MM = parseInt(buf[0]+buf[1])`, `SS = parseInt(buf[2]+buf[3])`
  - `remainingSec = clamp(MM*60 + SS, 1, 5999)` (1 sec min, 99:59 max)
  - Exit edit mode, call `render()`
- **Cancel:** Escape key
  - Restore `remainingSec` to the snapshot taken when edit mode was entered
  - Exit edit mode, call `render()`

## Edit Mode State

Two new variables in `app.js`:

```js
let editMode = false;
let editBuffer = ["0","0","0","0"];
let editSnapshot = 0; // remainingSec at edit entry, for cancel
```

## Visual Feedback

- CSS class `timer-editable` on `.timer` when conditions are met (not running, setting on, not snooze): `cursor: text`
- CSS class `timer-editing` on `.timer` while in edit mode: e.g. slightly different color or underline to signal active input
- No dedicated input element in DOM

## Interaction with Existing Controls

- Play/skip buttons remain clickable during edit mode; clicking them triggers blur which confirms the edit first (natural blur-confirm flow)
- Phase tab clicks also trigger blur-confirm before switching

## Implementation Scope

Changes limited to:

- `src/settings/schema.ts` - add `editable_when_paused` field
- `src/app.js` - edit mode state, `setupTimerEdit()` function wired in `setupControls()`
- `src/style.css` - `timer-editable` and `timer-editing` cursor/style rules

No Rust/Tauri changes required.

## Acceptance

- Toggle off (default): clicking timer while paused does nothing
- Toggle on, timer running: clicking timer does nothing
- Toggle on, timer paused: click enters edit mode, cursor changes
- Typing digits shifts display live
- Enter or click-away applies new time and timer shows updated value
- Escape reverts to pre-edit time
- Edge: typing `0000` and confirming clamps to `00:01` (1 sec minimum)
- Edge: typing `9999` and confirming clamps to `99:59` (5999 sec)
- Switching phase while in edit mode (blur path) confirms the edit before switching
