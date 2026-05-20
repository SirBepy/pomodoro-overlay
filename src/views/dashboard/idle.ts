import { fmtMinutes } from "./fmt";

export function renderIdle(root: HTMLElement, todayIdleMs: number, sevenDayAvgIdleMs: number, capMinutes: number) {
  root.innerHTML = `
    <div class="card idle-card">
      <div class="idle-row">
        <div>
          <div class="card-label">IDLE TODAY</div>
          <div class="big">${fmtMinutes(todayIdleMs)}</div>
        </div>
        <div>
          <div class="card-label">7-DAY AVG</div>
          <div class="big">${fmtMinutes(sevenDayAvgIdleMs)}</div>
        </div>
      </div>
      <div class="card-footer">Gaps over ${Math.round(capMinutes / 60)}h are excluded (configurable in Settings > System).</div>
    </div>
  `;
}
