// Fleet board: one row per ship, one column per season. Assign deployments, then run the season.
import { t, tn } from '../sim/strings';
import { REGIONS, REGION_ORDER } from '../sim/data';
import { specsOf, shipById, portName } from '../sim/game';
import { nightOptions, turnarounds } from '../sim/planner';
import {
  assignmentFor, setLayup, toggleDock, clearSeason, runSeason, repoCheck, shipRegion, ageYears, dockDue, dockCost,
  seasonName, seasonYear, seasonStart, planningDay, fuelIndex, companyValue, fleetGoals, regionLoad, crowdShare, arrivalPort,
  lineSummary, rivalShare,
  OVERHEAD_PER_SHIP, DOCK_DAYS, type SeasonReport, type Assignment,
} from '../sim/fleet';
import { fmtDate } from '../sim/calendar';
import { esc, money, kmoney, ICON, el } from './dom';
import { sound } from './audio';
import type { App, Screen } from './app';

/** How many seasons the board shows, starting with the next one to run. */
const COLS = 4;

export function fleet(app: App): Screen {
  const root = el('<div class="wrap"></div>');
  const seasonLabel = (idx: number) => t('fleet.seasonLabel', { season: t('fleet.season.' + seasonName(idx)), year: seasonYear(idx) });

  /** Where the ship will be at the start of a season: the region of the latest plan before it. */
  function regionBefore(shipId: string, idx: number): string {
    const s = app.state, ship = shipById(s, shipId)!;
    for (let k = idx - 1; k >= s.fleet!.season; k--) {
      const a = assignmentFor(s, shipId, k);
      if (a.dep) return a.dep.region;
    }
    return shipRegion(s, ship);
  }

  function cell(shipId: string, idx: number): string {
    const s = app.state, a = assignmentFor(s, shipId, idx), from = regionBefore(shipId, idx);
    const repo = a.dep && a.dep.region !== from;
    let body: string, cls = 'fcell';
    if (a.dep) {
      const R = REGIONS[a.dep.region];
      body = '<span class="rchip r-' + a.dep.region + '">' + esc(t('region.' + a.dep.region)) + '</span>' +
        '<span class="fdep">' + esc(t('fleet.cell.dep', { nights: a.dep.nights, port: R.ports[a.dep.from]?.name ?? a.dep.from, n: a.dep.stops.length })) + '</span>' +
        '<span class="sub2">' + esc(t('fleet.cell.fare', { fare: a.dep.fare })) + '</span>';
    } else if (a.layup) { body = '<span class="fdep">' + esc(t('fleet.cell.layup')) + '</span>'; cls += ' idle'; }
    else { body = '<span class="fdep bad">' + ICON.err + ' ' + esc(t('fleet.cell.none')) + '</span>'; cls += ' empty'; }
    const flags = (repo ? '<span class="flag">' + esc(t('fleet.cell.repo', { from: t('region.' + from) })) + '</span>' : '') +
      (a.dock ? '<span class="flag dock">' + esc(t('fleet.cell.dock')) + '</span>' : '');
    if (a.carried && (a.dep || a.layup)) cls += ' carried';
    return '<button type="button" class="' + cls + '" data-cell="' + shipId + ':' + idx + '">' + body + flags + (a.carried && (a.dep || a.layup) ? '<span class="sub2">' + esc(t('fleet.cell.carried')) + '</span>' : '') + '</button>';
  }

  function render() {
    const s = app.state, F = s.fleet!, idx = F.season;
    const value = companyValue(s), fuel = fuelIndex(idx);
    let h = '<section class="co-head"><div><div class="label">' + esc(t('fleet.label')) + '</div><h1>' + esc(t('fleet.title')) + '</h1></div>' +
      '<div><span class="label">' + esc(t('fleet.next')) + '</span><span class="big">' + esc(seasonLabel(idx)) + '</span><span class="sub2" style="color:var(--nav-2)">' + esc(fmtDate(seasonStart(idx))) + '</span></div>' +
      '<div><span class="label">' + esc(t('fleet.fuel')) + '</span><span class="big">×' + fuel.toFixed(2) + '</span></div>' +
      '<div><span class="label">' + esc(t('fleet.value')) + '</span><span class="big">' + kmoney(value) + '</span></div>' +
      '<div style="margin-left:auto;align-self:center"><button type="button" class="btn primary frun" data-run>' + esc(t('fleet.run', { season: seasonLabel(idx) })) + '</button></div></section>';

    // The board.
    h += '<div class="panel"><div class="fboard" style="--cols:' + COLS + '"><div class="fhead">' + esc(t('fleet.col.ship')) + '</div>';
    for (let k = 0; k < COLS; k++) h += '<div class="fhead">' + esc(seasonLabel(idx + k)) + (k === 0 ? ' · ' + esc(t('fleet.col.next')) : '') + '</div>';
    for (const sh of s.ships) {
      const sp = specsOf(s, sh), age = ageYears(sh, seasonStart(idx)), due = dockDue(sh);
      const overdue = due < seasonStart(idx + 1);
      h += '<div class="fship"><b>' + esc(sh.name) + '</b><span class="sub2">' + esc(t('hull.' + sp.hull)) + ' · ' + esc(t('fleet.age', { n: age.toFixed(0) })) + ' · ' + sp.pax + ' ' + esc(t('fleet.guests')) + '</span>' +
        '<span class="sub2">' + esc(t('fleet.at', { port: portName(s, sh), region: t('region.' + shipRegion(s, sh)) })) + '</span>' +
        '<span class="sub2 ' + (overdue ? 'warned' : '') + '">' + (overdue ? ICON.warn + ' ' : '') + esc(t('fleet.dockDue', { date: fmtDate(due, true) })) + '</span></div>';
      for (let k = 0; k < COLS; k++) h += cell(sh.id, idx + k);
    }
    h += '</div><p class="hint" style="margin-top:.6rem">' + esc(t('fleet.boardHint')) + '</p></div>';

    // Region load next season: own ships share a region's guests.
    const load = regionLoad(s, idx);
    h += '<div class="co-grid"><div class="stack"><div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('fleet.regions')) + '</div><div class="ledger">' +
      REGION_ORDER.map(r => '<span>' + esc(t('region.' + r)) + '</span><span class="mono">' + esc(load[r] ? t('fleet.regionLoad', { n: load[r], pct: Math.round(crowdShare(load[r]) * 100) }) : '—') + '</span>').join('') +
      '<span>' + esc(t('fleet.overhead')) + '</span><span class="mono">' + money(-OVERHEAD_PER_SHIP * s.ships.length) + '</span></div></div>';
    // Goals.
    h += '<div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('fleet.goals')) + '</div><div class="ms">' +
      fleetGoals(s).map(g => '<div class="m' + (g.done ? ' done' : '') + '"><span class="box">' + (g.done ? '✓' : '') + '</span><span><b>' + esc(t('fleet.goal.' + g.id)) + '</b><br><span class="ds">' + esc(t('fleet.goal.' + g.id + '.now', g.vars)) + '</span></span><span></span></div>').join('') +
      '</div></div></div>' + rivalsHtml() + '</div>';

    // Last season.
    const last = F.reports[F.reports.length - 1];
    if (last) h += '<div class="panel">' + reportHtml(last) + '</div>';
    root.innerHTML = h;
    root.querySelector<HTMLButtonElement>('[data-run]')!.onclick = run;
    root.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach(b => b.onclick = () => {
      const [id, k] = b.dataset.cell!.split(':');
      openCell(id, Number(k));
    });
  }

  /** The three rival lines, and what their fares and fleets mean for your guests in each region. */
  function rivalsHtml(): string {
    const s = app.state, fare = s.fleet!.rivals?.fare ?? {};
    let h = '<div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('fleet.rivals')) + '</div><div class="ledger">';
    for (const L of lineSummary(s)) {
      h += '<span><b>' + esc(L.name) + '</b><br><span class="sub2">' + esc(t('fleet.line.' + L.line)) + ' · ' + L.regions.map(r => esc(t('region.' + r))).join(', ') + '</span></span>' +
        '<span class="mono">' + esc(t('fleet.rivals.line', { ships: L.ships, berths: L.berths.toLocaleString('en-US') })) + '</span>';
    }
    h += '</div><div class="label" style="margin:.8rem 0 .5rem">' + esc(t('fleet.rivals.fares')) + '</div><div class="ledger">';
    for (const r of REGION_ORDER) {
      const f = fare[r] ?? 1, reach = Math.round(rivalShare(s, r) * 100);
      h += '<span>' + esc(t('region.' + r)) + '<br><span class="sub2">' + esc(t('fleet.rivals.reach', { pct: reach })) + '</span></span>' +
        '<span class="mono ' + (f < 1 ? 'bad' : '') + '">' + esc(f < 1 ? t('fleet.rivals.fare.cut', { pct: Math.round((1 - f) * 100) }) : t('fleet.rivals.fare.normal')) + '</span>';
    }
    return h + '</div><p class="hint" style="margin-top:.6rem">' + esc(t('fleet.rivals.hint')) + '</p></div>';
  }

  function reportHtml(r: SeasonReport): string {
    let h = '<div class="label" style="margin-bottom:.5rem">' + esc(t('fleet.report.head', { season: seasonLabel(r.season) })) + '</div><table class="fleet"><thead><tr>' +
      ['ship', 'region', 'cruises', 'booked', 'sat', 'profit'].map(k => '<th>' + esc(t('fleet.report.col.' + k)) + '</th>').join('') + '</tr></thead><tbody>';
    for (const x of r.ships) {
      h += '<tr><td><b>' + esc(x.ship) + '</b>' + x.notes.map(n => '<br><span class="sub2 ' + (n.bad ? 'warned' : '') + '">' + (n.bad ? ICON.warn + ' ' : '') + esc(t(n.key, n.vars)) + '</span>').join('') + '</td>' +
        '<td>' + esc(t('region.' + x.region)) + '</td><td class="num">' + x.cruises + '</td>' +
        '<td class="num">' + (x.berths ? Math.round(x.guests / x.berths * 100) + '%' : '—') + '</td><td class="num">' + (x.cruises ? x.sat : '—') + '</td>' +
        '<td class="num ' + (x.profit >= 0 ? 'good' : 'bad') + '">' + kmoney(x.profit) + '</td></tr>';
    }
    h += '<tr><td colspan="5">' + esc(t('fleet.overhead')) + '</td><td class="num bad">' + kmoney(-r.overhead) + '</td></tr>' +
      '<tr><td colspan="5"><b>' + esc(t('fleet.report.total')) + '</b> <span class="sub2">' + esc(t('fleet.report.meta', { fuel: r.fuel.toFixed(2), rep0: r.repBefore.toFixed(1), rep1: r.repAfter.toFixed(1) })) + '</span></td><td class="num ' + (r.profit >= 0 ? 'good' : 'bad') + '"><b>' + kmoney(r.profit) + '</b></td></tr></tbody></table>';
    h += '<div class="label" style="margin:.8rem 0 .4rem">' + esc(t('fleet.rivals.news')) + '</div>';
    h += r.rivalNews?.length
      ? '<ul class="fnews">' + r.rivalNews.map(n => '<li>' + esc(t(n.key, n.vars)) + '</li>').join('') + '</ul>'
      : '<p class="sub2">' + esc(t('fleet.rivals.quiet')) + '</p>';
    return h;
  }

  function run() {
    const s = app.state;
    const missing = s.ships.filter(sh => { const a = assignmentFor(s, sh.id, s.fleet!.season); return !a.dep && !a.layup; });
    const go = () => {
      const r = runSeason(s);
      sound.horn(app.settings);
      app.commit();
      app.modal({ title: t('fleet.report.title', { season: seasonLabel(r.season) }), wide: true, body: reportHtml(r), buttons: [{ label: t('ui.close'), primary: true }] });
    };
    if (missing.length) {
      app.modal({ title: t('fleet.confirm.title'), body: '<p>' + esc(tn('fleet.confirm.body', missing.length, { ships: missing.map(x => x.name).join(', ') })) + '</p>',
        buttons: [{ label: t('ui.cancel') }, { label: t('fleet.confirm.go'), primary: true, action: go }] });
    } else go();
  }

  function openCell(shipId: string, idx: number) {
    const s = app.state, ship = shipById(s, shipId)!, a: Assignment = assignmentFor(s, shipId, idx);
    let region = a.dep?.region ?? regionBefore(shipId, idx);
    const body = el('<div class="body" style="padding:0"></div>');
    const draw = () => {
      const from = regionBefore(shipId, idx);
      let h = '<div><div class="label" style="margin-bottom:6px">' + esc(t('fleet.cellModal.region')) + '</div><div class="seg">' +
        REGION_ORDER.map(r => '<button type="button" data-r="' + r + '" aria-pressed="' + (r === region) + '">' + esc(t('region.' + r)) + '</button>').join('') + '</div></div>';
      if (region !== from) {
        const c = repoCheck(s, ship, region);
        h += c ? '<div class="' + (c.ok ? 'clear-ok' : 'issue err') + '">' + (c.ok ? ICON.ok + ' ' + esc(t('fleet.cellModal.repoOk', { from: t('region.' + from), to: t('region.' + region), nm: c.nm.toLocaleString('en-US'), days: Math.ceil(c.hours / 24) + 1, port: REGIONS[region].ports[arrivalPort(region)].name }))
          : '<span class="ic">' + ICON.err + '</span><span>' + c.issues.filter(i => i.lvl === 'err').map(i => esc(t(i.key, i.vars))).join(' ') + '</span>') + '</div>'
          : '<div class="issue err"><span class="ic">' + ICON.err + '</span><span>' + esc(t('fleet.note.noRoute', { to: t('region.' + region) })) + '</span></div>';
      }
      h += '<p class="hint">' + esc(t('fleet.cellModal.hint', { region: t('region.' + region) })) + '</p>';
      const due = dockDue(ship);
      h += '<label class="chk"><input type="checkbox" data-dock' + (a.dock ? ' checked' : '') + '> ' + esc(t('fleet.cellModal.dock', { days: DOCK_DAYS, cost: kmoney(dockCost(ship)), date: fmtDate(due, true) })) + '</label>';
      body.innerHTML = h;
      body.querySelectorAll<HTMLButtonElement>('[data-r]').forEach(b => b.onclick = () => { region = b.dataset.r!; draw(); });
      body.querySelector<HTMLInputElement>('[data-dock]')!.onchange = () => { toggleDock(s, shipId, idx); a.dock = !a.dock; app.commit({ render: false }); render(); };
    };
    draw();
    const close = app.modal({
      title: t('fleet.cellModal.title', { ship: ship.name, season: seasonLabel(idx) }), body, wide: true,
      buttons: [
        { label: t('fleet.cellModal.repeat'), action: () => { clearSeason(s, shipId, idx); app.commit(); } },
        { label: t('fleet.cellModal.layup'), action: () => { setLayup(s, shipId, idx); app.commit(); } },
        { label: t('fleet.cellModal.plan'), primary: true, action: () => { close(); plan(shipId, idx, region); return false; } },
      ],
    });
  }

  /** Open the Chartroom to plan this ship's season in a region. */
  function plan(shipId: string, idx: number, region: string) {
    const s = app.state, a = assignmentFor(s, shipId, idx);
    const R = REGIONS[region], homes = turnarounds(R);
    const dep = a.dep?.region === region ? a.dep : undefined;
    const from = dep?.from ?? (homes.includes(arrivalPort(region)) ? arrivalPort(region) : homes[0]);
    s.region = region;
    s.fleet!.edit = { shipId, season: idx };
    s.plan = {
      shipId, nights: dep?.nights ?? nightOptions(R).find(n => n >= 7) ?? nightOptions(R)[0], wait: dep?.wait ?? 0,
      stops: dep ? [...dep.stops] : [], end: from, fare: dep?.fare ?? R.market.rivalFare, lowSulfur: dep?.lowSulfur ?? true, offset: dep?.offset,
      from, day: planningDay(idx),
      // Your other ships in the region share its guests: count this one in. Rival berths shrink or grow the pool.
      share: crowdShare((regionLoad(s, idx)[region] ?? 0) + (a.dep?.region === region ? 0 : 1)) * rivalShare(s, region),
    };
    app.commit({ render: false });
    app.go('chartroom');
  }

  return { el: root, render };
}
