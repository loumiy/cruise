// Boot: title screen, then the game. Every screen opens in a working state.
import './styles.css';
import { t } from './sim/strings';
import { newGame, type GameState } from './sim/game';
import { AUTOSAVE, SLOTS, readSave, slotInfo, writeSave, deserialise } from './sim/save';
import { fmtDate } from './sim/calendar';
import { App } from './ui/app';
import { chartroom } from './ui/chartroom';
import { drydock } from './ui/drydock';
import { company } from './ui/company';
import { applySettings, loadSettings } from './ui/settings';
import { sound } from './ui/audio';
import { esc, el, money } from './ui/dom';

const root = document.getElementById('app')!;
const settings = loadSettings();
applySettings(settings);
document.documentElement.setAttribute('data-tint', 'north');
let app: App | null = null;

function start(state: GameState) {
  app?.destroy();
  writeSave(AUTOSAVE, state);
  app = new App(root, state, settings, { chartroom, drydock, company }, titleScreen);
}

function titleScreen() {
  app?.destroy();
  app = null;
  const auto = readSave(AUTOSAVE);
  const card = el('<div class="title"><div class="card"><header><div><div class="label">' + esc(t('title.kicker')) + '</div><h1>' + esc(t('game.title')) + '</h1></div></header>' +
    '<div class="body"><p class="hint" style="font-size:.95rem">' + esc(t('title.pitch')) + '</p><div class="modes"></div>' +
    '<div class="slots" id="slots"></div><label class="btn sm" style="align-self:flex-start">' + esc(t('menu.import')) + '<input type="file" accept=".json,application/json" class="sr" id="imp"></label></div></div></div>');
  const modes = card.querySelector('.modes')!;
  const add = (label: string, desc: string, fn: (() => void) | null) => {
    const b = el('<button type="button" class="mode"' + (fn ? '' : ' disabled') + '><b>' + esc(label) + '</b><span>' + esc(desc) + '</span></button>') as HTMLButtonElement;
    if (fn) b.onclick = () => { sound.resume(); sound.setAmbience(settings); fn(); };
    modes.appendChild(b);
  };
  if (auto) add(t('title.continue'), t('title.continueDesc', { company: auto.company, date: fmtDate(Math.min(...auto.ships.map(s => s.day))), cash: auto.mode === 'sandbox' ? '∞' : money(auto.cash) }), () => start(auto));
  add(t('title.campaign'), t('title.campaignDesc'), () => start(newGame('campaign')));
  add(t('title.sandbox'), t('title.sandboxDesc'), () => start(newGame('sandbox')));
  add(t('title.fleet'), t('title.fleetDesc'), null);
  const slots = card.querySelector('#slots')!;
  SLOTS.forEach((k, i) => {
    const info = slotInfo(k);
    if (!info.savedAt) return;
    const row = el('<div class="slot"><span><b>' + esc(t('menu.slot', { n: i + 1 })) + '</b> <span class="sub2">' + esc(t('menu.slotInfo', { date: new Date(info.savedAt).toLocaleString(), n: info.voyages })) + '</span></span><span></span><button type="button" class="btn sm">' + esc(t('menu.load')) + '</button></div>');
    row.querySelector('button')!.addEventListener('click', () => { const g = readSave(k); if (g) start(g); });
    slots.appendChild(row);
  });
  card.querySelector<HTMLInputElement>('#imp')!.onchange = async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const g = deserialise(await f.text());
    if (g) start(g);
  };
  root.innerHTML = '';
  root.appendChild(card);
  (card.querySelector('.mode') as HTMLElement | null)?.focus();
}

titleScreen();
