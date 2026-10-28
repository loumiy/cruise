// Company: cash, reputation, fleet, tech tree, milestones and firsts.
import { t, tn } from '../sim/strings';
import { FIRST_DP, MILESTONES, TECH, REGION_ORDER, REGIONS } from '../sim/data';
import { dpAvailable, buyTech, specsOf, regionOf, refitQuote, isSandbox, bpById, canLeaseIsland, leaseIsland, moveRegion, ISLAND_LEASE,
  companyDay, portName, permitKey, canBidPermit, bidPermit, MAX_PERMITS, PERMIT_BID_RANGE } from '../sim/game';
import { dateOf } from '../sim/calendar';
import { canBuy, tierOpen } from '../sim/tech';
import { fmtDate } from '../sim/calendar';
import { esc, money, kmoney, stars, ICON, el } from './dom';
import { firstName } from './chartroom';
import { sound } from './audio';
import type { App, Screen } from './app';

export function company(app: App): Screen {
  const root = el('<div class="wrap"></div>');

  function render() {
    const s = app.state, region = regionOf(s), dp = dpAvailable(s);
    let h = '<section class="co-head"><div><div class="label">' + esc(t('company.label')) + '</div><h1>' + esc(s.company) + '</h1>' +
      '<button type="button" class="btn link" data-rename>' + esc(t('company.rename')) + '</button></div>' +
      '<div><span class="label">' + esc(t('ui.cash')) + '</span><span class="big">' + (isSandbox(s) ? '∞' : money(s.cash)) + '</span></div>' +
      '<div><span class="label">' + esc(t('ui.reputation')) + '</span><span class="big">' + s.rep.toFixed(1) + ' <span class="stars">' + stars(s.rep) + '</span></span></div>' +
      '<div><span class="label">' + esc(t('company.dp')) + '</span><span class="big">' + (isSandbox(s) ? '∞' : dp + ' <span class="sub2">' + esc(t('company.dpEarned', { n: s.dpEarned })) + '</span>') + '</span></div>' +
      '<div><span class="label">' + esc(t('company.voyages')) + '</span><span class="big">' + s.voyages + '</span></div>' +
      '<div><span class="label">' + esc(t('company.mode')) + '</span><span class="big" style="font-size:1rem">' + esc(t('mode.' + s.mode)) + '</span></div></section>';

    h += '<div class="co-grid"><div style="display:flex;flex-direction:column;gap:.9rem">';
    // Fleet
    h += '<div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('company.fleet')) + '</div><table class="fleet"><thead><tr>' +
      ['ship', 'where', 'guests', 'gm', 'voyages', 'design'].map(k => '<th>' + esc(t('company.col.' + k)) + '</th>').join('') + '<th></th></tr></thead><tbody>';
    for (const sh of s.ships) {
      const sp = specsOf(s, sh);
      const q = refitQuote(s, sh);
      const bp = sh.blueprintId ? bpById(s, sh.blueprintId) : undefined;
      h += '<tr><td><b>' + esc(sh.name) + '</b><br><span class="sub2">' + esc(t('hull.' + sp.hull)) + (sh.chartered ? ' · ' + esc(t('chart.chartered')) : '') + '</span></td>' +
        '<td>' + esc(portName(s, sh)) + '<br><span class="sub2">' + esc(t('company.freeFrom', { date: fmtDate(sh.day) })) + '</span></td>' +
        '<td class="num">' + sp.pax + '</td><td class="num">' + sp.gm.toFixed(2) + '</td><td class="num">' + sh.voyages + '</td>' +
        '<td>' + (bp ? esc(bp.name) + (q ? '<br><span class="sub2 warned">' + ICON.warn + ' ' + esc(t('company.refitReady', { cost: kmoney(q.cost) })) + '</span>' : '') : '<span class="sub2">—</span>') + '</td>' +
        '<td><button type="button" class="btn sm" data-plan="' + sh.id + '">' + esc(t('company.planCruise')) + '</button>' +
        (bp ? ' <button type="button" class="btn sm" data-design="' + bp.id + '"' + (s.unlocked.drydock ? '' : ' disabled') + '>' + esc(t('company.openDesign')) + '</button>' : '') + '</td></tr>';
    }
    h += '</tbody></table></div>';

    // Tech tree
    h += '<div class="panel"><div class="label" style="margin-bottom:.3rem">' + esc(t('company.tech')) + '</div><p class="hint" style="margin-bottom:.6rem">' + esc(t('company.techHint')) + '</p><div class="tree">';
    for (const br of TECH.branches) {
      h += '<div class="branch"><div class="label">' + esc(t('tech.branch.' + br)) + '</div>';
      const nodes = TECH.nodes.filter(n => n.branch === br).sort((a, b) => a.tier - b.tier);
      let lastTier = 0;
      for (const n of nodes) {
        if (n.tier !== lastTier) { h += '<div class="tier">' + esc(t('company.tier', { n: n.tier })) + '</div>'; lastTier = n.tier; }
        const owned = s.tech.includes(n.id);
        const ok = canBuy(n.id, s.tech, dp);
        const open = tierOpen(n, s.tech);
        const cls = owned ? 'owned' : ok.ok ? 'can' : 'shut';
        const status = owned ? ICON.ok + ' ' + t('company.owned') : !open ? '🔒 ' + t('company.tierLocked') : t('company.costDp', { n: n.cost });
        h += '<button type="button" class="tnode ' + cls + '" data-tech="' + n.id + '"' + (ok.ok ? '' : ' aria-disabled="true"') + '><b>' + esc(t('tech.' + n.id + '.name')) + '</b><span>' + esc(t('tech.' + n.id + '.desc')) + '</span><span class="cost">' + esc(status) + '</span></button>';
      }
      h += '</div>';
    }
    h += '</div></div>';
    h += '</div><div style="display:flex;flex-direction:column;gap:.9rem">';

    // Private island
    const island = Object.entries(region.ports).find(([, p]) => p.lockedBy === 'island');
    if (island) {
      const owned = s.unlocked.portGroups.includes('island');
      const can = canLeaseIsland(s);
      h += '<div class="panel"><div class="label" style="margin-bottom:.4rem">' + esc(t('company.island.title', { name: island[1].name })) + '</div><div class="island">' +
        '<span class="hint" style="flex:1 1 14rem">' + esc(t(owned ? 'company.island.ownedDesc' : 'company.island.desc', { spend: island[1].spend ?? 0 })) + '</span>' +
        (owned ? '<span class="good">' + ICON.ok + ' ' + esc(t('company.owned')) + '</span>'
          : '<button type="button" class="btn primary" data-lease' + (can.ok ? '' : ' disabled title="' + esc(t(can.key, can.vars ? { cost: money(ISLAND_LEASE) } : undefined)) + '"') + '>' + esc(t('company.island.lease', { cost: kmoney(ISLAND_LEASE) })) + '</button>') +
        '</div></div>';
    }
    // Glacier permits: one sealed bid per season and slot.
    const permitPort = Object.values(region.ports).find(p => p.lockedBy === 'permit');
    if (permitPort) {
      const day = companyDay(s), rec = s.permits?.[permitKey(s, day)];
      const can = canBidPermit(s, day);
      const year = dateOf(day).getUTCFullYear();
      let status = rec?.slots ? t('company.permit.held', { n: rec.slots, max: MAX_PERMITS }) : t('company.permit.noneYet');
      if (rec?.outbid) status = (rec.slots ? t('company.permit.held', { n: rec.slots, max: MAX_PERMITS }) + ' ' : '') + t('company.permit.outbid', { rival: money(rec.rival) });
      h += '<div class="panel"><div class="label" style="margin-bottom:.4rem">' + esc(t('company.permit.title', { name: permitPort.name, year })) + '</div>' +
        '<p class="hint" style="margin-bottom:.5rem">' + esc(t('company.permit.desc')) + '</p><div class="island">' +
        '<span style="flex:1 1 12rem">' + (rec?.slots ? '<span class="good">' + ICON.ok + '</span> ' : '') + esc(status) + '</span>' +
        (can.ok ? '<label class="chk">' + esc(t('company.permit.bid')) + ' $<input class="txt mono" type="number" data-bidamt min="0" step="5000" value="' + Math.round((PERMIT_BID_RANGE[0] + PERMIT_BID_RANGE[1]) / 2) + '" style="width:7.5rem"></label>' +
          '<button type="button" class="btn primary" data-bid>' + esc(t('company.permit.submit')) + '</button>' : '') +
        '</div></div>';
    }
    if (isSandbox(s)) {
      h += '<div class="panel"><div class="label" style="margin-bottom:.4rem">' + esc(t('company.region')) + '</div><div class="seg">' +
        REGION_ORDER.map(id => '<button type="button" data-region="' + id + '" aria-pressed="' + (id === s.region) + '">' + esc(t('region.' + id)) + '</button>').join('') + '</div></div>';
    }

    // Milestones
    h += '<div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('company.milestones', { region: region.name })) + '</div><div class="ms">' +
      (MILESTONES[s.region] ?? []).map(m => {
        const done = s.milestones.includes(m.id);
        return '<div class="m' + (done ? ' done' : '') + '"><span class="box">' + (done ? '✓' : '') + '</span><span><b>' + esc(t('milestone.' + m.id + '.name')) + '</b><br><span class="ds">' + esc(t('milestone.' + m.id + '.goal')) + '</span></span><span class="rw">' + esc(t('milestone.' + m.id + '.reward')) + '</span></div>';
      }).join('') + '</div></div>';

    // Firsts
    const all = [...Object.keys(region.ports).filter(id => !region.ports[id].closed).map(id => 'port:' + id), 'region:' + region.id, ...Object.keys(FIRST_DP).filter(k => k !== 'port' && k !== 'region')];
    const got = all.filter(f => s.firsts.includes(f)).length;
    h += '<div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('company.firsts', { got, of: all.length })) + '</div><div class="firsts">' +
      all.map(f => '<span class="' + (s.firsts.includes(f) ? 'got' : '') + '">' + (s.firsts.includes(f) ? ICON.ok + ' ' : '') + esc(firstName(f, region)) + '</span>').join('') + '</div></div>';

    // History
    h += '<div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('company.history')) + '</div>' +
      (s.log.length ? '<table class="fleet"><thead><tr><th>#</th><th>' + esc(t('company.col.cruise')) + '</th><th>' + esc(t('company.col.booked')) + '</th><th>' + esc(t('company.col.sat')) + '</th><th>' + esc(t('company.col.profit')) + '</th></tr></thead><tbody>' +
        s.log.slice().reverse().slice(0, 20).map(v => '<tr><td class="num">' + v.n + '</td><td>' + esc(v.ship) + '<br><span class="sub2">' + esc(fmtDate(v.day, false)) + ' · ' + esc(tn('report.nights', v.nights)) + ' · ' + esc(v.route.map(id => (REGIONS[v.region] ?? region).ports[id]?.name ?? id).join(' → ')) + '</span></td>' +
          '<td class="num">' + v.booked + '/' + v.pax + '</td><td class="num">' + v.sat + '</td><td class="num ' + (v.profit >= 0 ? 'good' : 'bad') + '">' + kmoney(v.profit) + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="hint">' + esc(t('chart.noVoyages')) + '</p>') + '</div>';
    h += '</div></div>';
    root.innerHTML = h;

    root.querySelector<HTMLButtonElement>('[data-rename]')!.onclick = () => {
      const body = el('<div class="field"><label class="label" for="cn">' + esc(t('company.nameLabel')) + '</label><input class="txt" id="cn" maxlength="40" value="' + esc(s.company) + '"></div>');
      app.modal({ title: t('company.rename'), body, buttons: [{ label: t('ui.cancel') }, { label: t('ui.ok'), primary: true, action: () => { const v = (body.querySelector('#cn') as HTMLInputElement).value.trim(); if (v) { s.company = v; app.commit(); } } }] });
    };
    root.querySelector<HTMLButtonElement>('[data-lease]')?.addEventListener('click', () => {
      const r = leaseIsland(s);
      if ('ok' in r) { if (!r.ok) app.toast(t(r.key)); return; }
      sound.good(app.settings);
      app.toast(t('company.island.done'), 'ok');
      for (const m of r.milestones) app.toast(t('report.milestone', { name: t('milestone.' + m + '.name') }), 'ok');
      app.commit();
    });
    root.querySelector<HTMLButtonElement>('[data-bid]')?.addEventListener('click', () => {
      const amt = Math.max(0, Math.round(Number(root.querySelector<HTMLInputElement>('[data-bidamt]')!.value) || 0));
      const r = bidPermit(s, companyDay(s), amt);
      if ('ok' in r) { if (!r.ok) app.toast(t(r.key, r.vars ? { cost: money(Number(r.vars.cost)) } : undefined)); return; }
      if (r.won) { sound.good(app.settings); app.toast(t('company.permit.won', { rival: money(r.rival) }), 'ok'); }
      else { sound.red(app.settings); app.toast(t('company.permit.lostNow', { rival: money(r.rival) })); }
      for (const m of r.milestones) app.toast(t('report.milestone', { name: t('milestone.' + m + '.name') }), 'ok');
      app.commit();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-region]').forEach(b => b.onclick = () => {
      if (moveRegion(s, b.dataset.region!).ok) { app.commit({ render: false }); app.go('company'); }
    });
    root.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach(b => b.onclick = () => { if (s.mode === 'fleet') { app.go('fleet'); return; } s.plan.shipId = b.dataset.plan!; app.commit({ render: false }); app.go('chartroom'); });
    root.querySelectorAll<HTMLButtonElement>('[data-design]').forEach(b => b.onclick = () => { app.ui.bpId = b.dataset.design!; app.go('drydock'); });
    root.querySelectorAll<HTMLButtonElement>('[data-tech]').forEach(b => b.onclick = () => {
      const r = buyTech(s, b.dataset.tech!);
      if (r.ok) { sound.good(app.settings); app.toast(t('company.bought', { name: t('tech.' + b.dataset.tech + '.name') }), 'ok'); app.commit(); }
      else { sound.red(app.settings); app.toast(t(r.key)); }
    });
  }

  return { el: root, render };
}
