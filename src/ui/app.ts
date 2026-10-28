// The app shell: title bar, screen switching, modals, toasts, saves and settings.
import { t } from '../sim/strings';
import { companyDay, currentGoal, dpAvailable, newGame, type GameState } from '../sim/game';
import { fmtDate } from '../sim/calendar';
import { AUTOSAVE, SLOTS, deserialise, readSave, serialise, slotInfo, writeSave } from '../sim/save';
import { $, esc, money, stars, el } from './dom';
import { applySettings, saveSettings, reducedMotion, type Settings } from './settings';
import { sound } from './audio';
import { Tutorial } from './tutorial';

export type ScreenId = 'chartroom' | 'drydock' | 'company';

export interface Screen { el: HTMLElement; render(): void; destroy?(): void }
export type ScreenFactory = (app: App) => Screen;

export interface ModalButton { label: string; primary?: boolean; action?: () => void | boolean; disabled?: boolean }
export interface ModalOpts { title: string; sub?: string; body: string | HTMLElement; buttons?: ModalButton[]; wide?: boolean; onClose?: () => void }

/** Screen-local selections that aren't part of the save. */
export interface UiState { bpId: string | null; deck: number; }

export class App {
  state: GameState;
  settings: Settings;
  screen: ScreenId = 'chartroom';
  ui: UiState = { bpId: null, deck: 2 };
  tutorial: Tutorial;
  private root: HTMLElement;
  private current: Screen | null = null;
  private factories: Record<ScreenId, ScreenFactory>;
  private onExit: () => void;

  constructor(root: HTMLElement, state: GameState, settings: Settings, factories: Record<ScreenId, ScreenFactory>, onExit: () => void) {
    this.root = root;
    this.state = state;
    this.settings = settings;
    this.factories = factories;
    this.onExit = onExit;
    this.tutorial = new Tutorial(this);
    root.innerHTML = '';
    root.appendChild(el('<header class="titlebar" id="titlebar"></header>'));
    root.appendChild(el('<div class="tutbar" id="tutbar" hidden></div>'));
    root.appendChild(el('<main id="screen"></main>'));
    root.appendChild(el('<div class="toasts" id="toasts" aria-live="polite"></div>'));
    document.addEventListener('keydown', this.onKey);
    this.go(state.unlocked.drydock && state.tutorial.off ? 'chartroom' : 'chartroom');
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    this.current?.destroy?.();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const m = $('.modal');
      if (m) { e.preventDefault(); (m as HTMLElement & { close?: () => void }).close?.(); }
    }
  };

  reduced(): boolean {
    return reducedMotion(this.settings);
  }

  canOpen(s: ScreenId): boolean {
    return s !== 'drydock' || this.state.unlocked.drydock;
  }

  go(s: ScreenId) {
    if (!this.canOpen(s)) { this.toast(t('ui.drydockLocked')); return; }
    this.current?.destroy?.();
    this.screen = s;
    const host = $('#screen', this.root)!;
    host.innerHTML = '';
    this.current = this.factories[s](this);
    host.appendChild(this.current.el);
    this.renderAll();
    window.scrollTo({ top: 0 });
  }

  /** Save after every change, then redraw. Pass render:false when the screen redrew itself. */
  commit(opts: { render?: boolean } = {}) {
    writeSave(AUTOSAVE, this.state);
    this.tutorial.check();
    if (opts.render === false) { this.renderTop(); this.tutorial.render(); return; }
    this.renderAll();
  }

  renderAll() {
    this.renderTop();
    this.current?.render();
    this.tutorial.render();
  }

  renderTop() {
    const s = this.state;
    const goal = currentGoal(s);
    const tab = (id: ScreenId, extra = '') => '<button type="button" data-go="' + id + '"' + (this.screen === id ? ' aria-current="page"' : '') +
      (this.canOpen(id) ? '' : ' disabled title="' + esc(t('ui.drydockLocked')) + '"') + ' data-tut="nav-' + id + '">' + esc(t('screen.' + id)) + extra + '</button>';
    const dp = dpAvailable(s);
    $('#titlebar', this.root)!.innerHTML = '<div class="row">' +
      '<span class="brand">' + esc(t('game.title')) + '</span>' +
      '<nav class="tabs" aria-label="' + esc(t('ui.screens')) + '">' + tab('chartroom') + tab('drydock', this.canOpen('drydock') ? '' : ' 🔒') +
      tab('company', dp > 0 ? ' <span class="badge" style="background:var(--accent)" title="' + esc(t('company.dpBadge', { n: dp })) + '">' + dp + '</span>' : '') + '</nav>' +
      '<div class="stats">' +
      '<span class="stat"><span class="label">' + esc(t('ui.cash')) + '</span><b>' + (s.mode === 'sandbox' ? '∞' : money(s.cash)) + '</b></span>' +
      '<span class="stat"><span class="label">' + esc(t('ui.reputation')) + '</span><b>' + s.rep.toFixed(1) + '</b><span class="stars" aria-hidden="true">' + stars(s.rep) + '</span></span>' +
      '<span class="stat"><span class="label">' + esc(t('ui.date')) + '</span><b>' + esc(fmtDate(companyDay(s))) + '</b></span>' +
      (goal ? '<span class="stat goal"><span class="label">' + esc(t('ui.goal')) + '</span><span><b>' + esc(t('milestone.' + goal + '.name')) + ':</b> ' + esc(t('milestone.' + goal + '.goal')) + '</span></span>'
        : '<span class="stat goal"><span class="label">' + esc(t('ui.goal')) + '</span><span>' + esc(t('ui.chapterDone')) + '</span></span>') +
      '<button type="button" class="btn sm" data-menu>' + esc(t('ui.menu')) + '</button>' +
      '</div></div>';
    const bar = $('#titlebar', this.root)!;
    bar.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(b => b.onclick = () => { sound.click(this.settings); this.go(b.dataset.go as ScreenId); });
    bar.querySelector<HTMLButtonElement>('[data-menu]')!.onclick = () => this.openMenu();
  }

  toast(msg: string, kind: 'ok' | '' = '') {
    const box = $('#toasts', this.root);
    if (!box) return;
    const n = el('<div class="toast ' + kind + '">' + esc(msg) + '</div>');
    box.appendChild(n);
    setTimeout(() => n.remove(), 4200);
  }

  modal(o: ModalOpts): () => void {
    const wrap = el('<div class="modal" role="presentation"><div class="card' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="mTitle">' +
      '<header><h3 id="mTitle">' + esc(o.title) + '</h3>' + (o.sub ? '<span class="sub2">' + esc(o.sub) + '</span>' : '') + '</header>' +
      '<div class="body"></div><footer></footer></div></div>') as HTMLElement & { close?: () => void };
    const body = wrap.querySelector('.body')!;
    if (typeof o.body === 'string') body.innerHTML = o.body; else body.appendChild(o.body);
    const prevFocus = document.activeElement as HTMLElement | null;
    const close = () => { wrap.remove(); o.onClose?.(); prevFocus?.focus?.(); };
    wrap.close = close;
    const foot = wrap.querySelector('footer')!;
    const buttons = o.buttons ?? [{ label: t('ui.close'), primary: true }];
    for (const b of buttons) {
      const btn = el('<button type="button" class="btn' + (b.primary ? ' primary' : '') + '">' + esc(b.label) + '</button>') as HTMLButtonElement;
      btn.disabled = !!b.disabled;
      btn.onclick = () => { const r = b.action?.(); if (r !== false) close(); };
      foot.appendChild(btn);
    }
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    (foot.querySelector('.btn.primary') as HTMLElement | null ?? foot.querySelector('.btn') as HTMLElement | null)?.focus();
    return close;
  }

  // ---------- menu: saves and settings ----------

  openMenu() {
    const body = el('<div class="body" style="padding:0;gap:.9rem"></div>');
    const draw = () => {
      const st = this.settings;
      body.innerHTML =
        '<div><div class="label" style="margin-bottom:.4rem">' + esc(t('menu.saves')) + '</div><div class="slots">' +
        SLOTS.map((k, i) => {
          const info = slotInfo(k);
          const desc = info.savedAt ? t('menu.slotInfo', { date: new Date(info.savedAt).toLocaleString(), n: info.voyages }) : t('menu.slotEmpty');
          return '<div class="slot"><span><b>' + esc(t('menu.slot', { n: i + 1 })) + '</b> <span class="sub2">' + esc(desc) + '</span></span>' +
            '<button type="button" class="btn sm" data-save="' + k + '">' + esc(t('menu.save')) + '</button>' +
            '<button type="button" class="btn sm" data-load="' + k + '"' + (info.savedAt ? '' : ' disabled') + '>' + esc(t('menu.load')) + '</button></div>';
        }).join('') + '</div>' +
        '<p class="hint" style="margin-top:.4rem">' + esc(t('menu.autosave')) + '</p>' +
        '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem"><button type="button" class="btn sm" data-export>' + esc(t('menu.export')) + '</button>' +
        '<label class="btn sm" style="display:inline-block">' + esc(t('menu.import')) + '<input type="file" accept=".json,application/json" data-import class="sr"></label>' +
        '<button type="button" class="btn sm" data-new>' + esc(t('menu.newGame')) + '</button></div></div>' +
        '<hr class="r"><div><div class="label" style="margin-bottom:.4rem">' + esc(t('menu.settings')) + '</div><div class="settings">' +
        '<span>' + esc(t('menu.theme')) + '</span><div class="seg">' + (['auto', 'light', 'dark'] as const).map(v => '<button type="button" data-theme="' + v + '" aria-pressed="' + (st.theme === v) + '">' + esc(t('menu.theme.' + v)) + '</button>').join('') + '</div>' +
        '<label for="tscale">' + esc(t('menu.textSize')) + '</label><span style="display:flex;gap:.5rem;align-items:center"><input id="tscale" type="range" min="90" max="150" step="10" value="' + Math.round(st.textScale * 100) + '"><span class="mono">' + Math.round(st.textScale * 100) + '%</span></span>' +
        '<span>' + esc(t('menu.motion')) + '</span><div class="seg">' + (['auto', 'reduce'] as const).map(v => '<button type="button" data-motion="' + v + '" aria-pressed="' + (st.motion === v) + '">' + esc(t('menu.motion.' + v)) + '</button>').join('') + '</div>' +
        '<span>' + esc(t('menu.voyages')) + '</span><div class="seg">' + ([1, 2, 4] as const).map(v => '<button type="button" data-speed="' + v + '" aria-pressed="' + (!st.instant && st.speed === v) + '">' + v + '×</button>').join('') +
        '<button type="button" data-instant aria-pressed="' + st.instant + '">' + esc(t('menu.instant')) + '</button></div>' +
        '<label for="vfx">' + esc(t('menu.effects')) + '</label><input id="vfx" type="range" min="0" max="100" value="' + Math.round(st.effects * 100) + '">' +
        '<label for="vamb">' + esc(t('menu.ambience')) + '</label><input id="vamb" type="range" min="0" max="100" value="' + Math.round(st.ambience * 100) + '">' +
        '</div></div>' +
        (this.state.tutorial.off ? '' : '<hr class="r"><button type="button" class="btn sm" data-skiptut>' + esc(t('tutorial.skip')) + '</button>');
      const set = (fn: (s: Settings) => void) => { fn(this.settings); saveSettings(this.settings); applySettings(this.settings); sound.setAmbience(this.settings); draw(); };
      body.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b => b.onclick = () => {
        if (writeSave(b.dataset.save!, this.state)) this.toast(t('menu.saved'), 'ok'); else this.toast(t('menu.storageOff'));
        draw();
      });
      body.querySelectorAll<HTMLButtonElement>('[data-load]').forEach(b => b.onclick = () => {
        const g = readSave(b.dataset.load!);
        if (!g) { this.toast(t('menu.loadFailed')); return; }
        this.replaceState(g); closeMenu();
      });
      body.querySelector<HTMLButtonElement>('[data-export]')!.onclick = () => {
        const blob = new Blob([serialise(this.state)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'cruise-line-manager-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      body.querySelector<HTMLInputElement>('[data-import]')!.onchange = async e => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        const g = deserialise(await f.text());
        if (!g) { this.toast(t('menu.loadFailed')); return; }
        this.replaceState(g); closeMenu();
      };
      body.querySelector<HTMLButtonElement>('[data-new]')!.onclick = () => { closeMenu(); this.onExit(); };
      body.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(b => b.onclick = () => set(s => { s.theme = b.dataset.theme as Settings['theme']; }));
      body.querySelectorAll<HTMLButtonElement>('[data-motion]').forEach(b => b.onclick = () => set(s => { s.motion = b.dataset.motion as Settings['motion']; }));
      body.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b => b.onclick = () => set(s => { s.instant = false; s.speed = Number(b.dataset.speed) as Settings['speed']; }));
      body.querySelector<HTMLButtonElement>('[data-instant]')!.onclick = () => set(s => { s.instant = !s.instant; });
      body.querySelector<HTMLInputElement>('#tscale')!.onchange = e => set(s => { s.textScale = Number((e.target as HTMLInputElement).value) / 100; });
      body.querySelector<HTMLInputElement>('#vfx')!.onchange = e => set(s => { s.effects = Number((e.target as HTMLInputElement).value) / 100; });
      body.querySelector<HTMLInputElement>('#vamb')!.onchange = e => set(s => { s.ambience = Number((e.target as HTMLInputElement).value) / 100; });
      const sk = body.querySelector<HTMLButtonElement>('[data-skiptut]');
      if (sk) sk.onclick = () => { this.tutorial.skip(); closeMenu(); };
    };
    draw();
    const closeMenu = this.modal({ title: t('ui.menu'), body, buttons: [{ label: t('ui.close'), primary: true }], wide: true });
  }

  replaceState(g: GameState) {
    this.state = g;
    this.ui = { bpId: null, deck: 2 };
    writeSave(AUTOSAVE, g);
    this.go('chartroom');
    this.toast(t('menu.loaded'), 'ok');
  }

  newGame(mode: 'campaign' | 'sandbox') {
    this.replaceState(newGame(mode));
  }
}
