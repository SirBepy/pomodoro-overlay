// @ts-nocheck
let editMode = false;
let editBuffer = ["0","0","0","0"];
let editSnapshot = 0;
let editDirty = false;

export function isEditMode() {
  return editMode;
}

export function renderEditMode() {
  document.querySelector(".timer").textContent =
    `${editBuffer[0]}${editBuffer[1]}:${editBuffer[2]}${editBuffer[3]}`;
}

export function enterEditMode(getRemainingSec) {
  if (editMode) return;
  editMode = true;
  editDirty = false;
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

export function setupTimerEdit({ timerIsEditable, getRemainingSec, setRemainingSec, render }) {
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
      }
      editBuffer = [...editBuffer.slice(1), e.key];
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
