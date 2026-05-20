export interface AppBarButton {
  icon: string;
  action: () => void;
  title?: string;
}

export interface AppBarOptions {
  title: string;
  leading?: AppBarButton;
  trailing?: AppBarButton;
}

export function mountAppBar(el: HTMLElement, opts: AppBarOptions): void {
  const btn = (id: string, b: AppBarButton) =>
    `<button class="ctx-app-bar-btn" id="${id}"${b.title ? ` title="${b.title}"` : ""}>
      <i class="ph ph-${b.icon}"></i>
    </button>`;
  const spacer = `<span class="ctx-app-bar-spacer"></span>`;

  el.innerHTML = `
    <div class="ctx-header">
      ${opts.leading ? btn("app-bar-lead", opts.leading) : spacer}
      <span class="ctx-title">${opts.title}</span>
      ${opts.trailing ? btn("app-bar-trail", opts.trailing) : spacer}
    </div>
  `;

  if (opts.leading) {
    el.querySelector<HTMLButtonElement>("#app-bar-lead")!
      .addEventListener("click", opts.leading.action);
  }
  if (opts.trailing) {
    el.querySelector<HTMLButtonElement>("#app-bar-trail")!
      .addEventListener("click", opts.trailing.action);
  }
}
