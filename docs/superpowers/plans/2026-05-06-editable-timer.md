# Editable Timer While Paused Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a setting that lets users click the timer while paused to type a new time using calculator-style digit-shift input.

**Architecture:** A new `editable_when_paused` toggle in schema.ts gates the feature. In `app.js`, three new module-level variables track edit state; `setupTimerEdit()` wires click/keydown/blur handlers onto the `.timer` element; `render()` is updated to toggle the editable cursor class and skip overwriting the display while editing. No Rust changes needed.

**Tech Stack:** Vanilla JS (lit-html-free, plain DOM), CSS, TypeScript schema definition.

---

## File Map

- Modify: `src/settings/schema.ts` — add `editable_when_paused` toggle field
- Modify: `src/style.css` — add `.timer-editable` and `.timer-editing` rules
- Modify: `src/app.js` — edit state vars, `timerIsEditable()`, `enterEditMode()`, `exitEditMode()`, `renderEditMode()`, `setupTimerEdit()`, wire into `render()` and `setupControls()`

---

### Task 1: Add `editable_when_paused` setting to schema

**Files:**
- Modify: `src/settings/schema.ts`

- [ ] **Step 1: Add toggle field to Times section**

In `src/settings/schema.ts`, add one entry after `reset_on_restart`:

```ts
{ key: "reset_on_restart", kind: "toggle", label: "Reset progress on restart" },
{ key: "editable_when_paused", kind: "toggle", label: "Edit timer while paused" },
```

Full updated Times fields array for reference:

```ts
fields: [
  { key: "work_minutes", kind: "integer", label: "Pomodoro", min: 1, max: 180 },
  { key: "short_break_minutes", kind: "integer", label: "Short break", min: 1, max: 60 },
  { key: "long_break_minutes", kind: "integer", label: "Long break", min: 1, max: 120 },
  { key: "sessions_before_long_break", kind: "integer", label: "Sessions before long break", min: 1, max: 10 },
  { key: "auto_start_work", kind: "toggle", label: "Auto-start work phase" },
  { key: "auto_start_break", kind: "toggle", label: "Auto-start break phase" },
  { key: "reset_on_restart", kind: "toggle", label: "Reset progress on restart" },
  { key: "editable_when_paused", kind: "toggle", label: "Edit timer while paused" },
],
```

- [ ] **Step 2: Verify settings page builds**

```powershell
cd src-tauri
cargo tauri dev
```

Open settings window. Confirm "Edit timer while paused" toggle appears under Times section. Close dev server.

- [ ] **Step 3: Invoke /commit skill**

Run `/commit` and follow its instructions. Message should be: `feat: add editable_when_paused setting to schema`

---

### Task 2: Add CSS classes for edit affordance

**Files:**
- Modify: `src/style.css`

- [ ] **Step 1: Remove pointer-events block from timer-editable and add both rules**

In `src/style.css`, after the closing `}` of the `.timer` block (after line 150), add:

```css
.timer.timer-editable {
  pointer-events: auto;
  cursor: text;
}

.timer.timer-editing {
  pointer-events: auto;
  cursor: text;
  opacity: 0.75;
  outline: none;
}
```

Note: `.timer` currently has `pointer-events: none`. The new classes override it to `auto` only when the feature is active, so normal pointer behavior is unchanged when the toggle is off.

- [ ] **Step 2: Invoke /commit skill**

Run `/commit` and follow its instructions. Message: `feat: add timer-editable and timer-editing CSS classes`

---

### Task 3: Implement edit mode in app.js

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add edit state variables after existing module-level vars**

After `let musicPausedByApp = false;` (around line 31), add:

```js
let editMode = false;
let editBuffer = ["0","0","0","0"];
let editSnapshot = 0;
```

- [ ] **Step 2: Add timerIsEditable helper after the fmt function**

After the `fmt` function (after line 88), add:

```js
function timerIsEditable() {
  return !!(settings?.editable_when_paused && !running && phase !== PHASE_SNOOZE);
}
```

- [ ] **Step 3: Add renderEditMode, enterEditMode, exitEditMode after timerIsEditable**

```js
function renderEditMode() {
  document.querySelector(".timer").textContent =
    `${editBuffer[0]}${editBuffer[1]}:${editBuffer[2]}${editBuffer[3]}`;
}

function enterEditMode() {
  if (editMode) return;
  editMode = true;
  editSnapshot = remainingSec;
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  editBuffer = [
    String(Math.floor(m / 10)),
    String(m % 10),
    String(Math.floor(s / 10)),
    String(s % 10),
  ];
  renderEditMode();
  const timerEl = document.querySelector(".timer");
  timerEl.classList.remove("timer-editable");
  timerEl.classList.add("timer-editing");
  timerEl.focus();
}

function exitEditMode(confirm) {
  if (!editMode) return;
  editMode = false;
  const timerEl = document.querySelector(".timer");
  timerEl.classList.remove("timer-editing");
  if (confirm) {
    const mm = parseInt(editBuffer[0] + editBuffer[1], 10);
    const ss = parseInt(editBuffer[2] + editBuffer[3], 10);
    remainingSec = Math.min(Math.max(mm * 60 + ss, 1), 5999);
  } else {
    remainingSec = editSnapshot;
  }
  render();
}
```

- [ ] **Step 4: Update render() to manage timer-editable class and skip text update during edit**

Replace the existing `render` function (lines 116-123):

```js
function render() {
  const timerEl = document.querySelector(".timer");
  if (!editMode) {
    timerEl.textContent = fmt(remainingSec);
  }
  timerEl.classList.toggle("timer-editable", timerIsEditable() && !editMode);
  $("play").textContent = running ? "PAUSE" : "START";
  $("skip").classList.toggle("visible", running);
  renderSnoozeButton();
  applyVisibility();
  saveState();
}
```

- [ ] **Step 5: Add setupTimerEdit function after setupControls**

After the closing `}` of `setupControls` (after line 254), add:

```js
function setupTimerEdit() {
  const timerEl = document.querySelector(".timer");
  timerEl.setAttribute("tabindex", "0");

  timerEl.addEventListener("click", () => {
    if (timerIsEditable()) enterEditMode();
  });

  timerEl.addEventListener("keydown", (e) => {
    if (!editMode) return;
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      editBuffer = [...editBuffer.slice(1), e.key];
      renderEditMode();
    } else if (e.key === "Enter") {
      e.preventDefault();
      exitEditMode(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      exitEditMode(false);
    }
  });

  timerEl.addEventListener("blur", () => {
    if (editMode) exitEditMode(true);
  });
}
```

- [ ] **Step 6: Wire setupTimerEdit into setupControls**

In `setupControls`, add a call to `setupTimerEdit()` at the end, before the closing `}`:

```js
function setupControls() {
  $("play").addEventListener("click", () =>
    running ? pauseTimer() : startTimer().catch(() => {}),
  );
  $("skip").addEventListener("click", () => handlePhaseEnd().catch(() => {}));
  $("snooze").addEventListener("click", () => startSnooze());
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => setPhase(b.dataset.phase));
  });
  [$("play"), $("skip"), $("snooze"), ...document.querySelectorAll(".tab-btn")].forEach(addButtonSounds);
  setupHoverOpacity();
  setupResizeHandles();
  setupTimerEdit();
}
```

- [ ] **Step 7: Exit edit mode on settings-updated event**

In the `settings-updated` listener inside `init()` (around line 375), add `exitEditMode` call at the top before fetching new settings:

```js
await listen("settings-updated", async () => {
  if (editMode) exitEditMode(true);
  const wasRunning = running;
  settings = await invoke("get_settings");
  if (!wasRunning) remainingSec = phaseDuration(phase);
  if (settings.return_to_corner_seconds === 0 && returnCornerTimer) {
    clearTimeout(returnCornerTimer);
    returnCornerTimer = null;
  }
  renderSnoozeButton();
  render();
});
```

- [ ] **Step 8: Invoke /commit skill**

Run `/commit` and follow its instructions. Message: `feat: implement editable timer while paused`

---

### Task 4: Manual verification

- [ ] **Step 1: Launch dev build**

```powershell
cd src-tauri
cargo tauri dev
```

- [ ] **Step 2: Verify toggle off (default)**

With "Edit timer while paused" OFF: click the timer while paused. Nothing happens. Cursor stays default.

- [ ] **Step 3: Enable setting and verify cursor**

Open settings, enable "Edit timer while paused". While paused, hover over timer. Cursor changes to text cursor.

- [ ] **Step 4: Verify digit-shift input**

Click timer. Type `1`, `3`, `0`, `5`. Display should show `01:30` after first two digits and `13:05` after all four.

- [ ] **Step 5: Verify Enter confirms**

After typing digits, press Enter. Timer displays the new time. Start timer and confirm it counts down from the new value.

- [ ] **Step 6: Verify Escape cancels**

Click timer, type some digits, press Escape. Timer reverts to value before editing.

- [ ] **Step 7: Verify click-away confirms**

Click timer, type digits, click somewhere else on the overlay. Timer updates to typed value.

- [ ] **Step 8: Verify clamping**

Type `0`, `0`, `0`, `0` → Enter. Timer should show `00:01` (clamped to 1 sec minimum).

- [ ] **Step 9: Verify no edit while running**

Start the timer. Confirm cursor over timer is default (not text). Clicking timer does nothing.

- [ ] **Step 10: Verify no orphan processes**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'vite|tauri' }
```

Kill any orphans with `Stop-Process -Id <PID> -Force` before reporting done.
