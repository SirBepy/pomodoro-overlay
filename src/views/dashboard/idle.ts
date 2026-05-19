function fmtMs(ms: number): string {
  const m = Math.round(ms / 60000);
  return `${m} min`;
}

export function renderIdle(root: HTMLElement, todayIdleMs: number, sevenDayAvgIdleMs: number, capMinutes: number) {
  root.innerHTML = `
    <div class="card idle-card">
      <div class="idle-row">
        <div>
          <div class="card-label">IDLE TODAY</div>
          <div class="big">${fmtMs(todayIdleMs)}</div>
        </div>
        <div>
          <div class="card-label">7-DAY AVG</div>
          <div class="big">${fmtMs(sevenDayAvgIdleMs)}</div>
        </div>
      </div>
      <div class="card-footer">Gaps over ${Math.round(capMinutes / 60)}h are excluded (configurable in Settings > System).</div>
    </div>
  `;
}
