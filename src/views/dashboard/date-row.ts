import { html, render } from "lit-html";
import { fmtDayShort } from "./fmt";

export interface DateRowProps {
  selectedDay: number;
  isToday: boolean;
  canPrev: boolean;
  canNext: boolean;
  /** `YYYY-MM-DD` bounds and value for the native picker. */
  minDate: string;
  maxDate: string;
  value: string;
  onStep: (dir: -1 | 1) => void;
  onPick: (value: string) => void;
}

export function renderDateRow(root: HTMLElement, p: DateRowProps): void {
  const label = p.isToday ? `Today · ${fmtDayShort(p.selectedDay)}` : fmtDayShort(p.selectedDay);
  render(
    html`
      <div class="dash-datebar">
        <button class="dash-nav" type="button" aria-label="Previous day" ?disabled=${!p.canPrev}
          @click=${() => p.onStep(-1)}><i class="ph ph-caret-left"></i></button>
        <div class="dash-datepill">
          <button class="dash-datepill-btn" type="button" aria-label="Pick a date"
            @click=${(ev: Event) => {
              const input = (ev.currentTarget as HTMLElement).parentElement!.querySelector<HTMLInputElement>("input")!;
              // showPicker is absent in older webviews; focus+click is the fallback.
              if (typeof input.showPicker === "function") input.showPicker();
              else input.click();
            }}><i class="ph ph-calendar-blank"></i>${label}</button>
          <input type="date" tabindex="-1" aria-hidden="true" .value=${p.value} min=${p.minDate} max=${p.maxDate}
            @change=${(ev: Event) => { const v = (ev.target as HTMLInputElement).value; if (v) p.onPick(v); }}>
        </div>
        <button class="dash-nav" type="button" aria-label="Next day" ?disabled=${!p.canNext}
          @click=${() => p.onStep(1)}><i class="ph ph-caret-right"></i></button>
      </div>
    `,
    root,
  );
}
