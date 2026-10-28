// Drydock: fill a fixed hull with room blocks, deck by deck, then pass inspection and a sea trial.
import { t, tn } from '../sim/strings';
import { BLOCKS, HULLS, HULL_ORDER } from '../sim/data';
import {
  bpById, report, runTrial, trialStatus, commission, canCommission, commissionCost, refitQuote, canRefit, refit,
  newBlueprint, copyBlueprint, deleteBlueprint, regionOf, isSandbox, type Blueprint,
} from '../sim/game';
import { canPlace, cellsOf, decksFor, fixedBlocks, hullOf, inShape, fuelRange, GM_MIN, STAIR_REACH, SERVICE_SPEED, ICE_BELT_COST, type Placed, type DesignReport } from '../sim/ship';
import { typicalCruise } from '../sim/economy';
import { blockUnlocked } from '../sim/tech';
import { encodeBlueprint, decodeBlueprint } from '../sim/share';
import { turnarounds, portStatus } from '../sim/planner';
import { $, esc, money, kmoney, gauge, ICON, issueRow, el } from './dom';
import { playTrial, drawStill, type TrialAnim } from './trialView';
import { sound } from './audio';
import type { App, Screen } from './app';

const GROUPS = ['Cabins', 'Venues', 'Service', 'Machinery', 'Access and safety'];

interface Tool { type: string; w: number; h: number }
interface Drag { from: 'palette' | 'block'; uid?: string; x: number; y: number; moved: boolean; held?: Placed; orig?: Placed }

export function blockName(type: string): string {
  return t('block.' + type + '.name');
}

export function drydock(app: App): Screen {
  const root = el('<div class="wrap"></div>');
  let tool: Tool | null = null;
  let selected: string | null = null;
  let drag: Drag | null = null;
  let ghost: { c: number; r: number } | null = null;
  let cursor: { c: number; r: number } | null = null;
  let R: DesignReport;
  let uidN = 1;

  const bp = (): Blueprint => {
    const s = app.state;
    let b = app.ui.bpId ? bpById(s, app.ui.bpId) : undefined;
    if (!b) { b = s.blueprints[s.blueprints.length - 1]; app.ui.bpId = b?.id ?? null; }
    return b!;
  };
  const hull = () => hullOf(bp().design);
  const deck = () => Math.max(1, Math.min(hull().decks.length, app.ui.deck));
  const nextUid = () => {
    const used = new Set(bp().design.blocks.map(b => b.uid));
    let u: string;
    do { u = 'u' + (uidN++); } while (used.has(u));
    return u;
  };

  root.innerHTML =
    '<section class="dd-head" id="ddHead"></section>' +
    '<div class="dd-main"><aside class="panel pal" id="palette" aria-label="' + esc(t('drydock.palette')) + '"></aside>' +
    '<div class="plan-col"><div class="profile-wrap"><div class="plan-head" style="margin:0 0 4px"><span class="label">' + esc(t('drydock.profile')) + '</span><span class="sub2" id="gmTag"></span></div>' +
    '<svg id="profile" role="img" aria-label="' + esc(t('drydock.profileAria')) + '"></svg></div>' +
    '<div class="planbox"><div class="deckbar"><div class="deck-tabs" role="tablist" id="deckTabs"></div><div class="tool-chip" id="toolChip"></div></div>' +
    '<div class="plan-head"><h2 id="deckTitle"></h2><span class="sub2" id="deckMeta"></span></div>' +
    '<div class="grid" id="grid" tabindex="0" aria-label="' + esc(t('drydock.gridAria')) + '"></div>' +
    '<div class="fwd"><span>' + esc(t('drydock.aft')) + '</span><span>' + esc(t('drydock.sides')) + '</span><span>' + esc(t('drydock.fwd')) + '</span></div>' +
    '<div class="legend">' + [['cabin', 'Cabins'], ['venue', 'Venues'], ['service', 'Service'], ['machine', 'Machinery'], ['safety', 'Safety']].map(([c, g]) => '<span><i style="background:var(--c-' + c + ')"></i>' + esc(t('drydock.group.' + g)) + '</span>').join('') +
    '<span><i style="background:repeating-linear-gradient(-45deg,var(--c-locked) 0 2px,transparent 2px 6px)"></i>' + esc(t('drydock.fixed')) + '</span></div>' +
    '<div class="selpanel" id="selPanel"></div></div>' +
    '<details class="howto"><summary>' + esc(t('help.title')) + '</summary><div>' +
    ['gm', 'list', 'power', 'stairs', 'trial', 'refit'].map(k => '<p><b>' + esc(t('help.dd.' + k + '.h')) + '</b> ' + esc(t('help.dd.' + k, { reach: STAIR_REACH, gm: GM_MIN }))).join('</p>') + '</p></div></details>' +
    '</div><aside class="panel ro ro-panel" id="readouts" aria-label="' + esc(t('drydock.readouts')) + '"></aside></div>';

  const grid = $('#grid', root)!;

  function render() {
    const b = bp();
    if (!b) return;
    R = report(app.state, b.design);
    renderHead(); renderPalette(); renderTabs(); renderGrid(); renderProfile(); renderReadouts(); renderSel(); renderToolChip();
  }

  // Changes to the layout go through here so the save, trial status and tutorial stay current.
  function changed() {
    const before = R?.errors ?? 0;
    app.commit();
    if (R.errors > before) sound.red(app.settings);
  }

  // ---------- header and blueprint bar ----------
  function renderHead() {
    const s = app.state, b = bp(), h = hull();
    const ts = trialStatus(s, b);
    const tsCls = ts === 'passed' ? (b.trial!.kind === 'warn' ? 'warn' : 'ok') : ts === 'failed' ? 'err' : 'none';
    const tsIcon = ts === 'passed' ? ICON.ok : ts === 'failed' ? ICON.err : '○';
    const cc = canCommission(s, b);
    const ships = s.ships.filter(x => x.blueprintId === b.id);
    let html = '<div><div class="label">' + esc(t('drydock.title', { hull: t('hull.' + b.design.hull), len: h.length, beam: h.beam, draft: h.draft, air: h.airDraft })) + '</div>' +
      '<h1>' + esc(b.name) + '</h1>' +
      '<div class="sub2" style="margin-top:.3rem"><span class="trialtag ' + tsCls + '">' + tsIcon + ' ' + esc(t('drydock.trial.' + ts)) + '</span>' +
      (ships.length ? ' · ' + esc(tn('drydock.builtAs', ships.length, { names: ships.map(x => x.name).join(', ') })) : '') + '</div></div>' +
      '<div class="acts">' +
      '<button type="button" class="btn" data-act="clear">' + esc(t('drydock.clearDeck')) + '</button>' +
      '<button type="button" class="btn primary" data-act="trial" data-tut="trial">' + esc(t('drydock.runTrial')) + '</button>' +
      '<button type="button" class="btn primary" data-act="commission" data-tut="commission"' + (cc.ok ? '' : ' disabled title="' + esc(t(cc.key, { cost: money((cc as { vars?: { cost: number } }).vars?.cost ?? 0) })) + '"') + '>' +
      esc(t('drydock.commission', { cost: kmoney(commissionCost(s, b.design)) })) + '</button>';
    for (const sh of ships) {
      const q = refitQuote(s, sh);
      if (q) {
        const ok = canRefit(s, sh);
        html += '<button type="button" class="btn" data-refit="' + sh.id + '"' + (ok.ok ? '' : ' disabled title="' + esc(t(ok.key, { cost: money(q.cost) })) + '"') + '>' + esc(t('drydock.refit', { ship: sh.name, cost: kmoney(q.cost) })) + '</button>';
      }
    }
    html += '</div><div class="bpbar"><label class="label" for="bpSel">' + esc(t('drydock.blueprint')) + '</label><select class="sel" id="bpSel">' +
      s.blueprints.map(x => '<option value="' + x.id + '"' + (x.id === b.id ? ' selected' : '') + '>' + esc(x.name) + ' · ' + esc(t('hull.' + x.design.hull)) + '</option>').join('') + '</select>' +
      '<button type="button" class="btn sm" data-act="rename">' + esc(t('drydock.rename')) + '</button>' +
      '<button type="button" class="btn sm" data-act="new">' + esc(t('drydock.new')) + '</button>' +
      '<button type="button" class="btn sm" data-act="copy">' + esc(t('drydock.copy')) + '</button>' +
      '<button type="button" class="btn sm" data-act="delete"' + (s.blueprints.length <= 1 ? ' disabled' : '') + '>' + esc(t('drydock.delete')) + '</button>' +
      '<button type="button" class="btn sm" data-act="share">' + esc(t('drydock.share')) + '</button>' +
      '<button type="button" class="btn sm" data-act="import">' + esc(t('drydock.import')) + '</button>' + iceToggle() + '</div>';
    const head = $('#ddHead', root)!;
    head.innerHTML = html;
    head.querySelector<HTMLSelectElement>('#bpSel')!.onchange = e => { app.ui.bpId = (e.target as HTMLSelectElement).value; selected = null; tool = null; render(); };
    head.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(btn => btn.onclick = () => act(btn.dataset.act!));
    head.querySelectorAll<HTMLButtonElement>('[data-refit]').forEach(btn => btn.onclick = () => doRefit(btn.dataset.refit!));
    head.querySelector<HTMLInputElement>('[data-ice]')?.addEventListener('change', e => {
      const d = bp().design;
      d.options = { ...d.options, ice: (e.target as HTMLInputElement).checked };
      changed();
    });
  }

  /** Ice belt: built into some hulls, a tech option for the rest. */
  function iceToggle(): string {
    const s = app.state, b = bp(), h = hull();
    if (h.ice) return '<span class="trialtag ok" style="margin-left:auto">' + ICON.ok + ' ' + esc(t('drydock.iceBuiltIn')) + '</span>';
    const can = isSandbox(s) || s.tech.includes('icebelt');
    return '<label class="chk" style="margin-left:auto" title="' + esc(can ? t('drydock.iceTip', { cost: kmoney(ICE_BELT_COST) }) : t('drydock.techLocked', { tech: t('tech.icebelt.name') })) + '">' +
      '<input type="checkbox" data-ice' + (b.design.options?.ice ? ' checked' : '') + (can ? '' : ' disabled') + '> ' + esc(t('drydock.iceBelt')) + '</label>';
  }

  function act(a: string) {
    const s = app.state, b = bp();
    switch (a) {
      case 'clear': b.design.blocks = b.design.blocks.filter(x => x.deck !== deck()); selected = null; changed(); break;
      case 'trial': doTrial(); break;
      case 'commission': doCommission(); break;
      case 'rename': {
        const body = el('<div class="field"><label class="label" for="nm">' + esc(t('drydock.name')) + '</label><input class="txt" id="nm" maxlength="40" value="' + esc(b.name) + '"></div>');
        app.modal({ title: t('drydock.rename'), body, buttons: [{ label: t('ui.cancel') }, { label: t('ui.ok'), primary: true, action: () => { const v = (body.querySelector('#nm') as HTMLInputElement).value.trim(); if (v) { b.name = v; changed(); } } }] });
        setTimeout(() => (body.querySelector('#nm') as HTMLInputElement).select());
        break;
      }
      case 'new': {
        const body = el('<div class="modes" style="display:flex;flex-direction:column;gap:.5rem"></div>');
        for (const id of HULL_ORDER) {
          const h = HULLS[id], open = s.unlocked.hulls.includes(id);
          const btn = el('<button type="button" class="ship" style="cursor:' + (open ? 'pointer' : 'not-allowed') + '"' + (open ? '' : ' disabled') + '><span><span class="nm">' + esc(t('hull.' + id)) + '</span> <span class="sub2">' + esc(t('drydock.hullGuests', { n: h.guests })) + '</span></span>' +
            '<span class="loc">' + (open ? '' : '🔒 ' + esc(t('drydock.hullLocked.' + id))) + '</span><span class="specs">' + esc(t('drydock.hullSpecs', { decks: h.decks.length, cols: h.cols, rows: h.rows, len: h.length, beam: h.beam, draft: h.draft, air: h.airDraft, lease: kmoney(h.leasePerNight) })) + '</span></button>') as HTMLButtonElement;
          btn.onclick = () => {
            const nb = newBlueprint(s, id, t('drydock.newName', { hull: t('hull.' + id), n: s.blueprints.length + 1 }));
            app.ui.bpId = nb.id; app.ui.deck = 1; selected = null; tool = null; close(); changed();
          };
          body.appendChild(btn);
        }
        const close = app.modal({ title: t('drydock.newTitle'), body, buttons: [{ label: t('ui.cancel') }] });
        break;
      }
      case 'copy': {
        const nb = copyBlueprint(s, b.id, t('drydock.copyName', { name: b.name }));
        if (nb) { app.ui.bpId = nb.id; changed(); app.toast(t('drydock.copied'), 'ok'); }
        break;
      }
      case 'delete':
        app.modal({ title: t('drydock.delete'), body: '<p>' + esc(t('drydock.deleteSure', { name: b.name })) + '</p>', buttons: [{ label: t('ui.cancel') }, { label: t('drydock.delete'), primary: true, action: () => { deleteBlueprint(s, b.id); app.ui.bpId = null; changed(); } }] });
        break;
      case 'share': {
        const code = encodeBlueprint(b.name, b.design);
        const body = el('<div class="field"><p class="hint">' + esc(t('drydock.shareHint')) + '</p><textarea class="code" readonly>' + esc(code) + '</textarea></div>');
        app.modal({
          title: t('drydock.share'), body, buttons: [{ label: t('ui.close') }, {
            label: t('drydock.copyCode'), primary: true, action: () => {
              const ta = body.querySelector('textarea') as HTMLTextAreaElement;
              ta.select();
              navigator.clipboard?.writeText(code).then(() => app.toast(t('drydock.codeCopied'), 'ok'), () => { /* selection is enough */ });
              return false;
            },
          }],
        });
        break;
      }
      case 'import': {
        const body = el('<div class="field"><label class="label" for="code">' + esc(t('drydock.pasteCode')) + '</label><textarea class="code" id="code" placeholder="CLM1.…"></textarea></div>');
        app.modal({
          title: t('drydock.import'), body, buttons: [{ label: t('ui.cancel') }, {
            label: t('drydock.import'), primary: true, action: () => {
              const r = decodeBlueprint((body.querySelector('#code') as HTMLTextAreaElement).value);
              if (!r) { app.toast(t('drydock.badCode')); return false; }
              const nb = newBlueprint(s, r.design.hull, r.name);
              nb.design = r.design;
              app.ui.bpId = nb.id;
              changed();
              app.toast(r.dropped ? tn('drydock.importedDropped', r.dropped) : t('drydock.imported'), 'ok');
              if (!s.unlocked.hulls.includes(r.design.hull)) app.toast(t('drydock.importLocked'));
            },
          }],
        });
        break;
      }
    }
  }

  // ---------- sea trial ----------
  function doTrial() {
    const s = app.state, b = bp();
    const run = runTrial(s, b.id);
    const body = el('<div class="body" style="padding:0"><canvas width="960" height="540" aria-label="' + esc(t('trial.aria')) + '"></canvas><div id="trialOut"></div></div>');
    const canvas = body.querySelector('canvas') as HTMLCanvasElement;
    const out = body.querySelector('#trialOut') as HTMLElement;
    let anim: TrialAnim | null = null;
    if (!run.result) {
      drawStill(canvas, b.design, run.inspection);
      sound.red(app.settings);
      const errs = run.inspection.issues.filter(i => i.lvl === 'err');
      out.innerHTML = '<div class="verdict err">' + ICON.err + ' ' + esc(tn('trial.blocked', errs.length)) + '</div><ul>' +
        errs.map(i => '<li>' + esc(t(i.key, i.vars)) + (i.deck ? ' ' + esc(t('drydock.onDeck', { n: i.deck })) : '') + '</li>').join('') + '</ul>';
      app.modal({ title: t('trial.inspectionFailed'), sub: t('trial.notCleared'), body, buttons: [{ label: t('trial.back'), primary: true }], wide: true });
      app.commit();
      return;
    }
    const res = run.result;
    // The result is on file now; the animation only shows it. Closing early keeps it.
    app.commit();
    out.innerHTML = '<div class="verdict">' + esc(t('trial.rolling')) + '</div>';
    app.modal({ title: t('trial.title'), sub: t('trial.sub'), body, buttons: [{ label: t('trial.back'), primary: true }], wide: true, onClose: () => anim?.stop() });
    anim = playTrial(canvas, b.design, run.inspection, res, app.reduced(), () => {
      const notes = res.notes.map(k => t(k, { heel: res.maxHeel.toFixed(0), peak: res.maxHeel.toFixed(1), period: res.period.toFixed(1), gm: GM_MIN, list: Math.abs(res.list).toFixed(1) }));
      if (res.capsize) sound.red(app.settings); else sound.good(app.settings);
      out.innerHTML = '<div class="verdict ' + res.kind + '">' + ICON[res.kind === 'err' ? 'err' : res.kind === 'warn' ? 'warn' : 'ok'] + ' ' + esc(t('trial.verdict.' + res.kind)) + '</div>' +
        '<ul>' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>' +
        (run.firsts.length ? '<div class="first">' + esc(t('report.firstTrial')) + '</div>' : '') +
        (!res.capsize ? '<p class="hint">' + esc(t('trial.next')) + '</p>' : '');
    });
  }

  function doCommission() {
    const s = app.state, b = bp();
    const region = regionOf(s);
    const specs = R.specs;
    const homes = turnarounds(region).filter(id => portStatus(region, id, specs, s.unlocked.portGroups, isSandbox(s)).ok);
    const cost = commissionCost(s, b.design);
    const h = HULLS[b.design.hull];
    const body = el('<div class="body" style="padding:0">' +
      '<div class="ledger"><span>' + esc(t('drydock.cHull', { hull: t('hull.' + b.design.hull) })) + '</span><span class="mono">' + money(h.commissionFee) + '</span>' +
      '<span>' + esc(t('drydock.cFit')) + '</span><span class="mono">' + money(R.fitOut) + '</span>' +
      '<span class="tot">' + esc(t('drydock.cTotal')) + '</span><span class="mono tot">' + money(cost) + '</span>' +
      '<span>' + esc(t('drydock.cLease')) + '</span><span class="mono">' + money(h.leasePerNight) + '</span></div>' +
      '<label class="field"><span class="label">' + esc(t('drydock.cPort')) + '</span><select class="sel" id="cport">' + homes.map(id => '<option value="' + id + '">' + esc(region.ports[id].name) + '</option>').join('') + '</select></label>' +
      '<p class="hint">' + esc(t('drydock.cHint')) + '</p></div>');
    app.modal({
      title: t('drydock.cTitle', { name: b.name }), body, buttons: [{ label: t('ui.cancel') }, {
        label: t('drydock.cConfirm'), primary: true, action: () => {
          const r = commission(s, b.id, (body.querySelector('#cport') as HTMLSelectElement).value);
          if ('ship' in r) {
            sound.horn(app.settings);
            s.plan.shipId = r.ship.id;
            app.commit();
            app.toast(t('drydock.commissioned', { ship: r.ship.name, port: region.ports[r.ship.port].name }), 'ok');
          } else if (!r.ok) app.toast(t(r.key, r.vars ? { cost: money(Number(r.vars.cost)) } : undefined));
        },
      }],
    });
  }

  function doRefit(shipId: string) {
    const s = app.state, sh = s.ships.find(x => x.id === shipId)!;
    const q = refitQuote(s, sh);
    if (!q) return;
    app.modal({
      title: t('drydock.refitTitle', { ship: sh.name }), body: '<p>' + esc(t('drydock.refitBody', { cost: money(q.cost) })) + '</p>',
      buttons: [{ label: t('ui.cancel') }, { label: t('drydock.refitConfirm'), primary: true, action: () => { const r = refit(s, shipId); if (r.ok) { app.commit(); app.toast(t('drydock.refitDone', { ship: sh.name }), 'ok'); } } }],
    });
  }

  // ---------- palette ----------
  function renderPalette() {
    const s = app.state, h = hull(), d = deck();
    const pal = $('#palette', root)!;
    let html = '';
    for (const g of GROUPS) {
      const ids = Object.keys(BLOCKS).filter(k => BLOCKS[k].group === g && !BLOCKS[k].fixed);
      html += '<div class="pal-group"><div class="label">' + esc(t('drydock.group.' + g)) + '</div>';
      for (const id of ids) {
        const b = BLOCKS[id];
        const open = blockUnlocked(id, s.tech, isSandbox(s));
        const fits = decksFor(h, id).includes(d);
        const code = b.code.length > 4 ? b.code.slice(0, 3) : b.code;
        const techName = b.tech ? t('tech.' + b.tech + '.name') : '';
        html += '<button type="button" class="pal-item cat-' + b.cat + (b.hi ? ' hi' : '') + (tool?.type === id ? ' armed' : '') + (open ? (fits ? '' : ' off') : ' locked') + '" data-type="' + id + '" title="' + esc(open ? paletteTip(id) : t('drydock.techLocked', { tech: techName })) + '"' + (open ? '' : ' aria-disabled="true"') + '>' +
          '<span class="sw" style="background:var(--c-' + b.cat + (b.hi ? '-hi' : '') + ')">' + esc(open ? code : '🔒') + '</span><span class="nm">' + esc(blockName(id)) + '</span><span class="dm">' + b.w + '×' + b.h + '</span></button>';
      }
      html += '</div>';
    }
    html += '<p class="hint">' + t('drydock.paletteHint') + '</p>';
    pal.innerHTML = html;
    pal.querySelectorAll<HTMLButtonElement>('.pal-item').forEach(btn => {
      const id = btn.dataset.type!;
      if (btn.classList.contains('locked')) { btn.onclick = () => app.toast(btn.title); return; }
      btn.addEventListener('pointerdown', e => { e.preventDefault(); armTool(id); drag = { from: 'palette', x: e.clientX, y: e.clientY, moved: false }; });
      btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); armTool(id); grid.focus(); cursor ??= { c: Math.floor(hull().cols / 2), r: Math.floor(hull().rows / 2) }; renderGrid(); } });
    });
  }

  function paletteTip(id: string): string {
    const b = BLOCKS[id];
    const p: string[] = [t('block.' + id + '.tip'), b.wt + ' t'];
    if (b.kw) p.push(b.kw + ' kW');
    if (b.supply) p.push('+' + b.supply + ' kW');
    if (b.pax) p.push(t('drydock.stat.guests', { n: b.pax }));
    if (b.beds) p.push(t('drydock.stat.beds', { n: b.beds }));
    if (b.seats) p.push(t('drydock.stat.seats', { n: b.seats }));
    if (b.souls) p.push(t('drydock.stat.souls', { n: b.souls }));
    if (b.tank) p.push(t('drydock.stat.tank', { n: hull().tankT }));
    if (b.provisions) p.push(t('drydock.stat.food', { n: b.provisions }));
    p.push(t('drydock.stat.decks', { decks: decksFor(hull(), id).join(', ') || '—' }));
    p.push(money(b.cost));
    return blockName(id) + ' — ' + p.join(' · ');
  }

  function armTool(id: string) {
    const b = BLOCKS[id];
    if (tool && tool.type === id && !drag) tool = null;
    else tool = { type: id, w: b.w, h: b.h };
    selected = null;
    render();
  }

  // ---------- deck tabs ----------
  function renderTabs() {
    const h = hull(), d = deck(), all = fixedBlocks(h).concat(bp().design.blocks);
    const tabs = $('#deckTabs', root)!;
    tabs.innerHTML = '';
    for (let k = h.decks.length; k >= 1; k--) {
      const n = R.issues.filter(i => i.lvl === 'err' && i.deck === k).length;
      const btn = el('<button type="button" class="deck-tab" role="tab" aria-selected="' + (k === d) + '">' + esc(t('drydock.deck', { n: k })) + (n ? '<span class="badge" aria-label="' + esc(tn('drydock.deckErrors', n)) + '">' + n + '</span>' : '') + '</button>') as HTMLButtonElement;
      btn.onclick = () => { app.ui.deck = k; selected = null; render(); };
      tabs.appendChild(btn);
    }
    $('#deckTitle', root)!.textContent = t('drydock.deckTitle', { n: d, name: h.decks[d - 1].name });
    let cells = 0;
    for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) if (inShape(h, d, c, r)) cells++;
    const used = all.filter(b => b.deck === d).reduce((s, b) => s + b.w * b.h, 0);
    $('#deckMeta', root)!.textContent = t('drydock.deckMeta', { used, cells, z: h.decks[d - 1].z.toFixed(1), roles: h.decks[d - 1].roles.map(r => t('role.' + r)).join(', ') });
  }

  // ---------- grid ----------
  const pct = (n: number, of: number) => (n / of * 100) + '%';
  function renderGrid() {
    const h = hull(), d = deck(), b = bp();
    grid.style.aspectRatio = h.cols + ' / ' + h.rows;
    let html = '';
    for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) {
      const kb = cursor && cursor.c === c && cursor.r === r && document.activeElement === grid;
      html += '<div class="cell' + (inShape(h, d, c, r) ? '' : ' void') + (kb ? ' kb' : '') + '" style="left:' + pct(c, h.cols) + ';top:' + pct(r, h.rows) + ';width:' + pct(1, h.cols) + ';height:' + pct(1, h.rows) + '"></div>';
    }
    let path = '';
    for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) {
      if (!inShape(h, d, c, r)) continue;
      const x = c * 10, y = r * 10;
      if (!inShape(h, d, c, r - 1)) path += 'M' + x + ' ' + y + 'h10';
      if (!inShape(h, d, c, r + 1)) path += 'M' + x + ' ' + (y + 10) + 'h10';
      if (!inShape(h, d, c - 1, r)) path += 'M' + x + ' ' + y + 'v10';
      if (!inShape(h, d, c + 1, r)) path += 'M' + (x + 10) + ' ' + y + 'v10';
    }
    html += '<svg class="hullline" viewBox="0 0 ' + h.cols * 10 + ' ' + h.rows * 10 + '" preserveAspectRatio="none"><path d="' + path + '" fill="none" stroke="var(--ink)" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>';
    for (const blk of fixedBlocks(h).concat(b.design.blocks)) {
      if (blk.deck !== d) continue;
      const bt = BLOCKS[blk.type];
      const flag = R.flags.get(blk.uid);
      const label = (blk.w * blk.h >= 2 || bt.code.length <= 3) ? bt.code : bt.code.slice(0, 3);
      html += '<div class="blk cat-' + bt.cat + ' t-' + blk.type + (bt.hi ? ' hi' : '') + (bt.fixed ? ' fixed' : '') + (selected === blk.uid ? ' sel' : '') + (flag ? ' ' + flag : '') + '" data-uid="' + blk.uid + '" style="left:' + pct(blk.c, h.cols) + ';top:' + pct(blk.r, h.rows) + ';width:' + pct(blk.w, h.cols) + ';height:' + pct(blk.h, h.rows) + '" title="' + esc(blockName(blk.type) + (bt.fixed ? ' · ' + t('drydock.fixed') : '')) + '">' +
        '<div class="in">' + esc(label) + (flag ? '<span class="flag" aria-hidden="true">' + (flag === 'err' ? ICON.err : ICON.warn) + '</span>' : '') + '</div></div>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll<HTMLElement>('.blk').forEach(n => {
      const uid = n.dataset.uid!;
      if (uid.startsWith('F')) return;
      n.addEventListener('pointerdown', e => { if (tool) return; e.preventDefault(); e.stopPropagation(); drag = { from: 'block', uid, x: e.clientX, y: e.clientY, moved: false }; });
    });
    renderGhost();
  }

  function renderGhost() {
    grid.querySelector('.ghost')?.remove();
    const at = ghost ?? (document.activeElement === grid ? cursor : null);
    if (!tool || !at) return;
    const h = hull();
    const a = anchorFor(at);
    const v = canPlace(bp().design, tool.type, deck(), a.c, a.r, tool.w, tool.h, drag?.held?.uid);
    const g = el('<div class="ghost' + (v.ok ? '' : ' bad') + '" style="left:' + pct(a.c, h.cols) + ';top:' + pct(a.r, h.rows) + ';width:' + pct(tool.w, h.cols) + ';height:' + pct(tool.h, h.rows) + '">' +
      (v.ok ? '' : '<span class="why">' + ICON.err + ' ' + esc(t(v.key, v.vars)) + '</span>') + '</div>');
    grid.appendChild(g);
  }

  function cellFromPoint(x: number, y: number) {
    const h = hull(), rc = grid.getBoundingClientRect();
    if (x < rc.left || x > rc.right || y < rc.top || y > rc.bottom) return null;
    return { c: Math.min(h.cols - 1, Math.floor((x - rc.left) / rc.width * h.cols)), r: Math.min(h.rows - 1, Math.floor((y - rc.top) / rc.height * h.rows)) };
  }
  const anchorFor = (cell: { c: number; r: number }) => ({ c: cell.c - Math.floor(((tool?.w ?? 1) - 1) / 2), r: cell.r - Math.floor(((tool?.h ?? 1) - 1) / 2) });

  function tryPlace(cell: { c: number; r: number }, held?: Placed): boolean {
    if (!tool) return false;
    const a = anchorFor(cell), b = bp();
    const v = canPlace(b.design, tool.type, deck(), a.c, a.r, tool.w, tool.h, held?.uid);
    if (!v.ok) { sound.red(app.settings); return false; }
    if (held) Object.assign(held, { deck: deck(), c: a.c, r: a.r, w: tool.w, h: tool.h });
    else b.design.blocks.push({ uid: nextUid(), type: tool.type, deck: deck(), c: a.c, r: a.r, w: tool.w, h: tool.h });
    sound.click(app.settings);
    return true;
  }

  function blockAt(c: number, r: number): Placed | undefined {
    return bp().design.blocks.find(b => b.deck === deck() && cellsOf(b).some(([x, y]) => x === c && y === r));
  }

  function rotateTool() { if (!tool) return; tool = { type: tool.type, w: tool.h, h: tool.w }; renderGhost(); renderToolChip(); }
  function rotateSelected() {
    const b = bp().design.blocks.find(x => x.uid === selected);
    if (!b) return;
    if (canPlace(bp().design, b.type, b.deck, b.c, b.r, b.h, b.w, b.uid).ok) { [b.w, b.h] = [b.h, b.w]; changed(); }
    else sound.red(app.settings);
  }
  function removeSelected() {
    const b = bp();
    b.design.blocks = b.design.blocks.filter(x => x.uid !== selected);
    selected = null;
    changed();
  }
  function moveSelected(dc: number, dr: number) {
    const b = bp().design.blocks.find(x => x.uid === selected);
    if (!b) return;
    if (canPlace(bp().design, b.type, b.deck, b.c + dc, b.r + dr, b.w, b.h, b.uid).ok) { b.c += dc; b.r += dr; changed(); }
    else sound.red(app.settings);
  }

  // ---------- side profile ----------
  function renderProfile() {
    const h = hull(), d0 = deck(), nd = h.decks.length, all = fixedBlocks(h).concat(bp().design.blocks);
    const X0 = 40, cw = 556 / h.cols, dh = Math.min(34, 136 / nd), base = 30 + nd * dh + 6;
    const VH = base + 40;
    const svg = $('#profile', root)! as unknown as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 680 ' + VH);
    const deckY = (d: number) => base - d * dh;
    let s = '<rect x="0" y="' + (base - dh * 0.9) + '" width="680" height="' + (VH - (base - dh * 0.9)) + '" fill="var(--sea)" opacity=".55"/>';
    const L = X0 + cw * h.cols;
    s += '<path d="M' + (X0 - 6) + ' ' + deckY(2) + ' L' + (X0 - 6) + ' ' + (base + 10) + ' Q' + (X0 + 20) + ' ' + (base + 26) + ' ' + (X0 + 80) + ' ' + (base + 26) + ' L' + (L - cw * 3) + ' ' + (base + 26) + ' Q' + (L - cw * 0.4) + ' ' + (base + 22) + ' ' + (L + cw * 0.6) + ' ' + deckY(2) + ' Z" fill="var(--sheet)" stroke="var(--ink)" stroke-width="2"/>';
    for (let d = 1; d <= nd; d++) {
      const y = deckY(d);
      for (let c = 0; c < h.cols; c++) {
        const rows: number[] = [];
        for (let r = 0; r < h.rows; r++) if (inShape(h, d, c, r)) rows.push(r);
        if (!rows.length) continue;
        const here = all.filter(b => b.deck === d && b.c <= c && c < b.c + b.w);
        const filled = rows.filter(r => here.some(b => b.r <= r && r < b.r + b.h)).length / rows.length;
        const wt = here.reduce((a, b) => a + (BLOCKS[b.type].wt / (b.w * b.h)) * b.h, 0);
        const heavy = Math.min(1, wt / (140 * h.rows));
        const err = here.some(b => R.flags.get(b.uid) === 'err');
        const fill = filled ? 'color-mix(in srgb,var(--ink) ' + Math.round(18 + heavy * 60) + '%,var(--sheet))' : 'var(--sheet)';
        s += '<rect x="' + (X0 + c * cw + 1) + '" y="' + (y + 1) + '" width="' + (cw - 2) + '" height="' + (dh - 2) + '" fill="' + fill + '" stroke="' + (err ? 'var(--err)' : 'var(--rule)') + '" stroke-width="' + (err ? 2 : 1) + '"/>';
      }
      s += '<g class="dk" data-deck="' + d + '" style="cursor:pointer"><rect x="0" y="' + y + '" width="' + (L + cw * 0.8) + '" height="' + dh + '" fill="transparent" stroke="' + (d === d0 ? 'var(--accent)' : 'none') + '" stroke-width="2.5"/>' +
        '<text x="4" y="' + (y + dh / 2 + 4) + '" font-family="IBM Plex Mono, monospace" font-size="12" font-weight="600" fill="var(--ink)">D' + d + '</text></g>';
    }
    const fu = h.fixed.find(f => f.type === 'FU');
    if (fu) s += '<rect x="' + (X0 + fu.c * cw + 4) + '" y="' + (deckY(nd) - 24) + '" width="' + (cw * fu.w - 8) + '" height="24" fill="var(--c-locked)" stroke="var(--ink)" stroke-width="1.5"/>';
    // G and M markers: metres above keel mapped onto deck rows.
    const z1 = h.decks[0].z, zs = nd > 1 ? h.decks[1].z - h.decks[0].z : 3;
    const mz = (m: number) => base - ((m - z1) / zs + 0.5) * dh;
    const gx = L + cw * 0.8 + 28;
    const gmS = R.gm >= GM_MIN ? 'var(--ok)' : R.gm > 0 ? 'var(--warn)' : 'var(--err)';
    s += '<line x1="' + gx + '" y1="' + mz(0) + '" x2="' + gx + '" y2="' + mz(h.decks[nd - 1].z + 2) + '" stroke="var(--rule)" stroke-width="2"/>';
    s += '<line x1="' + (gx - 10) + '" y1="' + mz(h.km) + '" x2="' + (gx + 10) + '" y2="' + mz(h.km) + '" stroke="var(--ink)" stroke-width="2"/><text x="' + (gx + 14) + '" y="' + (mz(h.km) + 4) + '" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink)">M</text>';
    s += '<circle cx="' + gx + '" cy="' + mz(R.kg) + '" r="6" fill="' + gmS + '" stroke="var(--ink)" stroke-width="1.5"/><text x="' + (gx + 14) + '" y="' + (mz(R.kg) + 4) + '" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink)">G</text>';
    svg.innerHTML = s;
    svg.querySelectorAll<SVGGElement>('.dk').forEach(g => g.addEventListener('click', () => { app.ui.deck = Number(g.dataset.deck); selected = null; render(); }));
    $('#gmTag', root)!.innerHTML = esc(t('drydock.gmTag', { kg: R.kg.toFixed(2) })) + ' · GM <b style="color:' + gmS + '">' + R.gm.toFixed(2) + ' m</b>';
  }

  // ---------- readouts ----------
  function renderReadouts() {
    const a = R, s = app.state;
    const region = regionOf(s);
    const tc = typicalCruise(region, a.specs, { rep: s.rep, demandBonus: s.demandBonus });
    const gmS = a.gm >= GM_MIN ? 'ok' : a.gm > 0 ? 'warn' : 'err';
    const listTxt = a.listDeg == null ? t('drydock.ro.capsizes') : Math.abs(a.listDeg) < 0.05 ? t('drydock.ro.upright') : t(a.listDeg > 0 ? 'drydock.ro.listStbd' : 'drydock.ro.listPort', { deg: Math.abs(a.listDeg).toFixed(1) });
    let h = gauge(t('drydock.ro.gm'), a.gm.toFixed(2) + ' m', Math.max(0, a.gm) / 2, gmS, listTxt + ' · ' + Math.round(a.weight).toLocaleString('en-US') + ' t', GM_MIN / 2);
    const pw = a.supply ? a.demand / a.supply : 1;
    h += gauge(t('drydock.ro.power'), a.demand + ' / ' + a.supply + ' kW', pw, a.demand > a.supply ? 'err' : pw > 0.9 ? 'warn' : 'ok', t('drydock.ro.powerSub'));
    h += gauge(t('drydock.ro.boats'), a.lifeboatSeats + ' / ' + a.souls, a.souls ? a.lifeboatSeats / a.souls : 1, a.lifeboatSeats >= a.souls ? 'ok' : 'err', t('drydock.ro.boatsSub', { pax: a.pax, crew: a.crewNeed }));
    h += gauge(t('drydock.ro.berths'), a.beds + ' / ' + a.crewNeed, a.crewNeed ? a.beds / a.crewNeed : 1, a.beds >= a.crewNeed ? 'ok' : 'err');
    h += gauge(t('drydock.ro.endurance'), t('drydock.ro.days', { n: a.endurance.toFixed(1) }), a.endurance / 10, a.endurance >= 4 ? 'ok' : a.endurance >= 3 ? 'warn' : 'err', t('drydock.ro.enduranceSub', {
      fuel: a.fuelDays.toFixed(1), kn: Math.round(a.specs.vmax * SERVICE_SPEED), food: a.foodDays.toFixed(1), t: a.fuelCap,
      max: fuelRange(a.specs, a.specs.vmax, region.hotelMult ?? 1).days.toFixed(1), top: a.specs.vmax,
      ac: (region.hotelMult ?? 1) > 1 ? t('drydock.ro.withAc') : '',
    }), 0.4);
    h += gauge(t('drydock.ro.sat'), String(Math.round(a.sat)), a.sat / 100, a.sat >= 60 ? 'ok' : a.sat >= 40 ? 'warn' : 'err', t('drydock.ro.satSub', { spend: Math.round(a.spend) }));
    h += '<hr class="r"><div><div class="label" style="margin-bottom:4px">' + esc(t('drydock.ro.typical', { fare: tc.fare })) + '</div><div class="ledger">' +
      '<span>' + esc(t('drydock.ro.guests', { n: tc.fin.booked, pax: a.pax })) + '</span><span class="mono">' + money(tc.fin.rev + tc.fin.onboard) + '</span>' +
      '<span>' + esc(t('ledger.crew')) + '</span><span class="mono">' + money(-tc.fin.crew) + '</span>' +
      '<span>' + esc(t('ledger.lease')) + '</span><span class="mono">' + money(-tc.fin.lease) + '</span>' +
      '<span>' + esc(t('ledger.foodFuelPorts')) + '</span><span class="mono">' + money(-(tc.fin.food + tc.fin.fuel + tc.fin.ports)) + '</span>' +
      '<span class="tot">' + esc(t('ledger.profit')) + '</span><span class="mono tot" style="color:' + (tc.fin.profit >= 0 ? 'var(--ok)' : 'var(--err)') + '">' + money(tc.fin.profit) + '</span></div></div>';
    h += '<hr class="r"><div><div class="label" style="margin-bottom:6px">' + esc(t('drydock.inspection', { e: a.errors, w: a.warnings })) + '</div><div class="issues scroll" id="issues"></div></div>';
    const box = $('#readouts', root)!;
    box.innerHTML = h;
    const list = $('#issues', box)!;
    const sorted = a.issues.slice().sort((x, y) => (x.lvl === y.lvl ? 0 : x.lvl === 'err' ? -1 : 1));
    if (!sorted.length) list.innerHTML = '<div class="clear-ok">' + ICON.ok + ' ' + esc(t('drydock.allClear')) + '</div>';
    else list.innerHTML = sorted.map((i, k) => issueRow(i.lvl, t(i.key, i.vars), i.deck ? '<span class="dk">' + esc(t('drydock.onDeck', { n: i.deck })) + (i.uids.length ? ' · ' + esc(t('drydock.show')) : '') + '</span>' : '', 'data-i="' + k + '"')).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-i]').forEach(btn => btn.onclick = () => {
      const i = sorted[Number(btn.dataset.i)];
      if (i.deck) app.ui.deck = i.deck;
      else {
        const blk = bp().design.blocks.find(b => i.uids.includes(b.uid));
        if (blk) app.ui.deck = blk.deck;
      }
      selected = i.uids.length === 1 ? i.uids[0] : null;
      render();
      i.uids.forEach(u => grid.querySelector('.blk[data-uid="' + u + '"]')?.classList.add('flash'));
    });
  }

  function renderSel() {
    const box = $('#selPanel', root)!;
    const b = bp().design.blocks.find(x => x.uid === selected);
    if (!b) { box.innerHTML = '<span class="hint">' + esc(t('drydock.selHint')) + '</span>'; return; }
    box.innerHTML = '<b>' + esc(blockName(b.type)) + '</b><span class="props">' + esc(paletteTip(b.type).split(' — ')[1]) + '</span>' +
      '<span style="display:flex;gap:6px;margin-left:auto"><button class="btn" id="selRot" type="button">' + esc(t('drydock.rotate')) + '</button><button class="btn" id="selDel" type="button">' + esc(t('drydock.remove')) + '</button></span>';
    $('#selRot', box)!.onclick = rotateSelected;
    $('#selDel', box)!.onclick = removeSelected;
  }

  function renderToolChip() {
    const box = $('#toolChip', root)!;
    if (!tool) { box.innerHTML = '<span>' + esc(t('drydock.noTool')) + '</span>'; return; }
    box.innerHTML = '<span>' + esc(t('drydock.placing', { name: blockName(tool.type), w: tool.w, h: tool.h })) + '</span><button class="btn sm" type="button" id="rotBtn">' + esc(t('drydock.rotate')) + '</button><button class="btn sm" type="button" id="dropBtn">' + esc(t('drydock.done')) + '</button>';
    $('#rotBtn', box)!.onclick = rotateTool;
    $('#dropBtn', box)!.onclick = () => { tool = null; ghost = null; render(); };
  }

  // ---------- pointer and keyboard ----------
  const onMove = (e: PointerEvent) => {
    if (drag && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      drag.moved = true;
      if (drag.from === 'block') {
        const b = bp().design.blocks.find(x => x.uid === drag!.uid);
        if (!b) { drag = null; return; }
        drag.held = b; drag.orig = { ...b };
        tool = { type: b.type, w: b.w, h: b.h };
        selected = null;
        b.deck = -1;
        R = report(app.state, bp().design);
        renderGrid(); renderToolChip();
      }
    }
    if (tool) {
      const c = cellFromPoint(e.clientX, e.clientY);
      const k = c ? c.c + ',' + c.r : null;
      if (k !== (ghost ? ghost.c + ',' + ghost.r : null)) { ghost = c; renderGhost(); }
    }
  };
  const onUp = (e: PointerEvent) => {
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (drag && drag.from === 'block') {
      if (drag.moved) {
        const ok = !!cell && tryPlace(cell, drag.held);
        if (!ok) Object.assign(drag.held!, drag.orig);
        selected = drag.held!.uid; tool = null; ghost = null;
        drag = null;
        changed();
      } else { selected = drag.uid!; drag = null; render(); }
      return;
    }
    if (drag && drag.from === 'palette') {
      const moved = drag.moved;
      drag = null;
      if (moved && cell && tool) { if (tryPlace(cell)) changed(); else render(); }
      return;
    }
    if (tool && cell && (e.target as HTMLElement).closest?.('#grid')) { if (tryPlace(cell)) changed(); return; }
    if (!tool && cell && (e.target as HTMLElement).closest?.('#grid') && !(e.target as HTMLElement).closest('.blk')) { selected = null; render(); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.modal')) return;
    const target = e.target as HTMLElement;
    if (target.closest('input,textarea,select')) return;
    const inGrid = target === grid;
    if (e.key === 'r' || e.key === 'R') { if (tool) rotateTool(); else rotateSelected(); return; }
    if (e.key === 'Escape') { tool = null; ghost = null; selected = null; render(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeSelected(); return; }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && (inGrid || selected)) {
      e.preventDefault();
      const [dc, dr] = arrows[e.key];
      if (selected && !tool) { moveSelected(dc, dr); return; }
      const h = hull();
      cursor ??= { c: Math.floor(h.cols / 2), r: Math.floor(h.rows / 2) };
      cursor = { c: Math.max(0, Math.min(h.cols - 1, cursor.c + dc)), r: Math.max(0, Math.min(h.rows - 1, cursor.r + dr)) };
      renderGrid();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && inGrid) {
      e.preventDefault();
      const h = hull();
      cursor ??= { c: Math.floor(h.cols / 2), r: Math.floor(h.rows / 2) };
      if (tool) { if (tryPlace(cursor)) changed(); }
      else { const b = blockAt(cursor.c, cursor.r); selected = b ? b.uid : null; render(); grid.focus(); }
    }
  };
  grid.addEventListener('pointerleave', () => { if (!drag) { ghost = null; renderGhost(); } });
  grid.addEventListener('contextmenu', e => { e.preventDefault(); tool = null; ghost = null; render(); });
  grid.addEventListener('focus', () => { cursor ??= { c: Math.floor(hull().cols / 2), r: Math.floor(hull().rows / 2) }; renderGrid(); });
  grid.addEventListener('blur', () => renderGrid());
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('keydown', onKey);
  const onResize = () => renderGhost();
  window.addEventListener('resize', onResize);

  return {
    el: root,
    render,
    destroy() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    },
  };
}
