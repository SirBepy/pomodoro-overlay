// @ts-nocheck
let editMode = false;
let editBuffer = ["0","0","0","0"];
let editSnapshot = 0;
let editDirty = false;
let editCount = 0;

export function isEditMode() {
  return editMode;
}

/**
 * Place a typed digit into the 4-slot MMSS buffer.
 *
 * LTR (default): fill left-to-right - "1"->10:00, "12"->12:00, "123"->12:30,
 * "1234"->12:34. Once all four slots are filled, further digits roll the window
 * left (drop the oldest) so a mistype can be corrected by typing over it.
 *
 * RTL (legacy): digits shift in from the right like a calculator - "1"->00:01,
 * "12"->00:12, "1234"->12:34.
 *
 * Pure: takes the current buffer + typed-digit count, returns the next pair.
 */
export function pushDigit(buffer, count, digit, ltr) {
  if (ltr && count < 4) {
    const next = [...buffer];
    next[count] = digit;
    return { buffer: next, count: count + 1 };
  }
  return { buffer: [...buffer.slice(1), digit], count };
}

export function renderEditMode() {
  document.querySelector(".timer").textContent =
    `${editBuffer[0]}${editBuffer[1]}:${editBuffer[2]}${editBuffer[3]}`;
}

export function enterEditMode(getRemainingSec) {
  if (editMode) return;
  editMode = true;
  editDirty = false;
  editCount = 0;
  const remainingSec = getRemainingSec();
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

export function exitEditMode(confirm, setRemainingSec, render) {
  if (!editMode) return;
  editMode = false;
  const timerEl = document.querySelector(".timer");
  timerEl.classList.remove("timer-editing");
  if (confirm) {
    const mm = parseInt(editBuffer[0] + editBuffer[1], 10);
    const ss = parseInt(editBuffer[2] + editBuffer[3], 10);
    setRemainingSec(Math.min(Math.max(mm * 60 + ss, 1), 5999));
  } else {
    setRemainingSec(editSnapshot);
  }
  render();
}

export function setupTimerEdit({ timerIsEditable, getRemainingSec, setRemainingSec, render, ltrEntry }) {
  const timerEl = document.querySelector(".timer");
  timerEl.setAttribute("tabindex", "0");

  timerEl.addEventListener("click", () => {
    if (timerIsEditable()) enterEditMode(getRemainingSec);
  });

  timerEl.addEventListener("keydown", (e) => {
    if (!editMode) return;
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      if (!editDirty) {
        editDirty = true;
        editBuffer = ["0","0","0","0"];
        editCount = 0;
      }
      const ltr = ltrEntry ? ltrEntry() : true;
      const res = pushDigit(editBuffer, editCount, e.key, ltr);
      editBuffer = res.buffer;
      editCount = res.count;
      renderEditMode();
    } else if (e.key === "Enter") {
      e.preventDefault();
      exitEditMode(true, setRemainingSec, render);
    } else if (e.key === "Escape") {
      e.preventDefault();
      exitEditMode(false, setRemainingSec, render);
    }
  });

  timerEl.addEventListener("blur", () => {
    if (editMode) exitEditMode(true, setRemainingSec, render);
  });
}
