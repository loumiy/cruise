// Chartroom: click ports on the chart to build a cruise, set the fare, then sail.
import { t, tn } from '../sim/strings';
import { MILESTONES, REGIONS } from '../sim/data';
import {
  draftPlan, planFinance, sail, shipById, specsOf, regionOf, normalisePlan, market, seasonOver, layUp, layUpCost,
  firstDp, isSandbox, MAX_WAIT, graduationOpen, crossingFor, graduate, grandTourOpen, grandTourChecks, portName, type VoyageResult,
} from '../sim/game';
import { setDeployment, seasonName, seasonYear, fleetGoals, type Deployment } from '../sim/fleet';
import { stormsBetween, stormAt, coneNm, DANGER_NM } from '../sim/storms';
import { fuelRange } from '../sim/ship';
import { portStatus, turnarounds, rivalsAt, nightOptions, FUEL_RESERVE, MIN_SPEED, type Plan, type PlanIssue } from '../sim/planner';
import { fareCurve, summarise, FARE_MIN, FARE_MAX, FARE_STEP, type Finance } from '../sim/economy';
import { fmtClock, fmtDate, seasonOf } from '../sim/calendar';
import { projector } from '../sim/geo';
import { $, esc, money, kmoney, ICON, issueRow, el } from './dom';
import { chartSvg, ptsAttr, shipGlyph, pxPerNm } from './chart';
import { sound } from './audio';
import type { App, Screen } from './app';


export function issueText(i: PlanIssue): string {
  return t(i.key, i.vars);
}

export function chartroom(app: App): Screen {
  const root = el('<div class="wrap"></div>');
  const region = regionOf(app.state);
  const { width: MW, height: MH, proj } = projector(region);
  let P: Plan | null = null, F: Finance | null = null;
  let sailing: { shown: VoyageResult['events']; raf: number } | null = null;

  root.innerHTML =
    '<div class="cr-main"><div class="cr-left">' +
    '<div class="mapcard" id="mapcard"><div class="maphead"><span class="label">' + esc(t('chart.head', { region: region.name, nm: (1 / pxPerNm(region)).toFixed(1).replace(/\.0$/, '') })) + '</span><span class="sub2" id="mapStatus"></span></div>' +
    chartSvg(region) + '<div class="clock" id="clock" hidden></div><div class="tip" id="tip" hidden></div></div>' +
    '<div class="panel strip"><div class="maphead" style="padding:0 0 6px"><span class="label">' + esc(t('chart.strip')) + '</span><span class="sub2" id="stripMeta"></span></div>' +
    '<svg id="strip" viewBox="0 0 1000 150" role="img" aria-label="' + esc(t('chart.stripAria')) + '"></svg></div>' +
    '<div class="cr-bottom"><div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('chart.milestones')) + '</div><div class="ms" id="milestones"></div></div>' +
    '<div class="panel"><div class="label" style="margin-bottom:.5rem">' + esc(t('chart.log')) + '</div><div class="log" id="log"></div></div></div>' +
    '<details class="howto"><summary>' + esc(t('help.title')) + '</summary><div>' +
    ['schedule', 'fuel', 'pvsa', 'ports', 'fare', 'appeal'].map(k => '<p><b>' + esc(t('help.chart.' + k + '.h')) + '</b> ' + esc(t('help.chart.' + k))).join('</p>') + '</p></div></details>' +
    '</div><aside class="panel planner" aria-label="' + esc(t('chart.planner')) + '" id="planner"></aside></div>';

  const tip = $('#tip', root)!;

  function render() {
    if (sailing) return;
    // The chart is drawn once per region. A new chapter means a new chart.
    if (regionOf(app.state) !== region) { queueMicrotask(() => app.go('chartroom')); return; }
    normalisePlan(app.state);
    P = draftPlan(app.state);
    F = P ? planFinance(app.state, P) : null;
    renderPlanner();
    renderStorms();
    renderRoute();
    renderPorts();
    renderStrip();
    renderMilestones();
    renderLog();
  }

  /** The fleet deployment being planned, if this Chartroom visit is for one. */
  function fleetEdit() {
    const s = app.state;
    return s.mode === 'fleet' && s.fleet?.edit && s.fleet.edit.shipId === s.plan.shipId ? s.fleet.edit : null;
  }

  function saveDeployment() {
    const s = app.state, edit = fleetEdit(), p = s.plan;
    if (!edit || !P || P.errors || !p.from) return;
    const dep: Deployment = { region: region.id, from: p.from, stops: [...p.stops], nights: p.nights, fare: p.fare, wait: p.wait, lowSulfur: p.lowSulfur, offset: p.offset };
    setDeployment(s, edit.shipId, edit.season, dep);
    delete s.fleet!.edit;
    sound.good(app.settings);
    app.toast(t('fleet.edit.saved', { ship: shipById(s, edit.shipId)!.name }), 'ok');
    app.commit({ render: false });
    app.go('fleet');
  }

  // ---------- planner ----------
  function renderPlanner() {
    const s = app.state, plan = s.plan, ship = shipById(s, plan.shipId)!, specs = specsOf(s, ship);
    const box = $('#planner', root)!;
    if (!P || !F) { box.innerHTML = ''; return; }
    // Fleet mode plans a deployment: one round trip that repeats all season, from a port the player picks.
    const edit = fleetEdit();
    const home = plan.from ?? ship.port, base = plan.day ?? ship.day;
    const over = !edit && seasonOver(s, ship);
    const errs = P.issues.filter(i => i.lvl === 'err').length, warns = P.issues.filter(i => i.lvl === 'warn').length;
    const homes = turnarounds(region);

    let h = edit ? '<div class="tour"><div class="label">' + esc(t('fleet.edit.head')) + '</div><div>' + esc(t('fleet.edit.what', { ship: ship.name, season: t('fleet.season.' + seasonName(edit.season)), year: seasonYear(edit.season), region: t('region.' + region.id) })) + '</div><div class="sub2">' + esc(t('fleet.edit.hint')) + '</div></div>' : '';
    h += '<div data-tut="ships"><div class="label" style="margin-bottom:6px">' + esc(t('chart.ship')) + '</div><div class="ships" role="radiogroup">';
    for (const sh of edit ? [ship] : s.ships) {
      const sp = specsOf(s, sh);
      // The planner sails each leg as slowly as the schedule allows, so show both ends of the range.
      const slow = fuelRange(sp, Math.min(sp.vmax, MIN_SPEED), region.hotelMult ?? 1), fast = fuelRange(sp, sp.vmax, region.hotelMult ?? 1);
      h += '<button type="button" class="ship" role="radio" aria-checked="' + (sh.id === plan.shipId) + '" data-ship="' + sh.id + '">' +
        '<span><span class="nm">' + esc(sh.name) + '</span> <span class="sub2">' + esc(t('hull.' + sp.hull)) + (sh.chartered ? ' · ' + esc(t('chart.chartered')) : '') + '</span></span>' +
        '<span class="loc">' + esc(edit ? t('fleet.edit.now', { port: portName(s, sh) }) : t('chart.shipAt', { port: portName(s, sh), date: fmtDate(sh.day, false) })) + '</span>' +
        '<span class="specs">' + esc(t('chart.shipSpecs', { pax: sp.pax, kn: sp.vmax, draft: sp.draft, air: sp.air, food: Math.floor(sp.foodDays),
          fast: Math.round(fast.nm / 10) * 10, slow: Math.round(slow.nm / 10) * 10, slowKn: Math.min(sp.vmax, MIN_SPEED) })) + '</span></button>';
    }
    h += '</div></div>';

    h += '<div class="row2"><div><div class="label" style="margin-bottom:4px">' + esc(t('chart.nights')) + '</div><div class="seg" id="nights">' +
      nightOptions(region).map(n => '<button type="button" data-nights="' + n + '" aria-pressed="' + (plan.nights === n) + '">' + n + '</button>').join('') + '</div></div>' +
      '<div class="grow" data-tut="depart"><div class="label" style="margin-bottom:4px">' + esc(t('chart.depart')) + '</div><div class="seg days" id="wait">' +
      Array.from({ length: MAX_WAIT + 1 }, (_, w) => '<button type="button" data-wait="' + w + '" aria-pressed="' + (plan.wait === w) + '" title="' + esc(w ? tn('chart.waitDays', w) : t('chart.waitNone')) + '">' + esc(fmtDate(base + w, false).replace(/ \w+$/, '')) + '</button>').join('') +
      '</div></div></div>';
    const season = seasonOf(region, base + plan.wait);
    h += '<div class="sub2">' + esc(t(edit ? 'fleet.edit.departs' : 'chart.departsOn', { date: fmtDate(base + plan.wait), season: season ? t('season.' + season.id) : t('season.closed') })) +
      (plan.wait ? ' · ' + esc(tn('chart.idle', plan.wait, { cost: kmoney(specs.lease * plan.wait) })) : '') + '</div>';

    // Emissions control area: choose low-sulfur fuel or risk a fine, unless the ship is fitted to burn clean.
    if (region.eca) {
      if (specs.lng || specs.scrubber) h += '<div class="sub2 good">' + ICON.ok + ' ' + esc(t(specs.lng ? 'chart.fuel.lng' : 'chart.fuel.scrubber')) + '</div>';
      else {
        const low = plan.lowSulfur ?? true;
        h += '<div data-tut="fuel"><div class="label" style="margin-bottom:4px">' + esc(t('chart.fuel.label')) + '</div><div class="seg">' +
          '<button type="button" data-lowsulfur="1" aria-pressed="' + low + '">' + esc(t('chart.fuel.low', { price: region.eca.lowSulfurPrice })) + '</button>' +
          '<button type="button" data-lowsulfur="0" aria-pressed="' + !low + '">' + esc(t('chart.fuel.standard', { price: region.fuelPrice })) + '</button></div></div>';
      }
    }

    // Carbon: EU ports charge for every tonne burned. Offsets make the cruise carbon-neutral.
    if (region.carbon) {
      const c = region.carbon, share = specs.lng ? c.lngShare : 1;
      h += '<div data-tut="carbon"><div class="label" style="margin-bottom:4px">' + esc(t('chart.carbon.label')) + '</div><div class="seg">' +
        '<button type="button" data-offset="0" aria-pressed="' + !plan.offset + '">' + esc(t('chart.carbon.pay', { price: Math.round(c.price * share) })) + '</button>' +
        '<button type="button" data-offset="1" aria-pressed="' + !!plan.offset + '">' + esc(t('chart.carbon.offset', { price: Math.round(c.offset * share) })) + '</button></div>' +
        (specs.lng ? '<div class="sub2 good">' + ICON.ok + ' ' + esc(t('chart.carbon.lng', { pct: Math.round((1 - c.lngShare) * 100) })) + '</div>' : '') + '</div>';
    }

    // Itinerary
    const legLine = (i: number) => {
      const l = P!.legs[i];
      if (!l) return '';
      const bad = P!.issues.some(x => x.lvl === 'err' && x.at === l.to && /late|fuel/i.test(x.key));
      return '<div class="leg' + (bad ? ' bad' : '') + '">' + esc(t('chart.legLine', { nm: Math.round(l.r.nm), kn: l.speed.toFixed(1), h: l.sailH.toFixed(1) })) +
        (l.tideWait > 0.3 ? esc(t('chart.legTide', { h: l.tideWait.toFixed(1) })) : '') +
        (l.idleH - l.tideWait > 0.5 ? esc(t('chart.legAnchor', { h: (l.idleH - l.tideWait).toFixed(1) })) : '') +
        (l.r.canals.length ? esc(t('chart.legVia', { canal: l.r.canals.map(c => t('canal.' + c)).join(', ') })) : '') + '</div>';
    };
    h += '<div><div class="label" style="margin-bottom:6px;display:flex;justify-content:space-between"><span>' + esc(t('chart.itinerary')) + '</span>' +
      '<button type="button" class="btn sm" data-clear>' + esc(t('chart.clearStops')) + '</button></div><div class="itin">';
    if (edit) h += '<div class="stop"><span class="n home" aria-hidden="true">⚓</span><span><label class="nm">' + esc(t('fleet.edit.from')) + ' <select class="sel" id="fromSel" aria-label="' + esc(t('fleet.edit.from')) + '">' +
      homes.map(k => '<option value="' + k + '"' + (k === home ? ' selected' : '') + '>' + esc(region.ports[k].name) + '</option>').join('') + '</select></label><br><span class="tm">' + esc(t('chart.embark')) + '</span></span><span></span></div>';
    else h += '<div class="stop"><span class="n home" aria-hidden="true">⚓</span><span><span class="nm">' + esc(region.ports[ship.port].name) + '</span><br><span class="tm">' + esc(t('chart.embark')) + '</span></span><span class="sub2">' + esc(t('chart.shipHere')) + '</span></div>';
    if (!plan.stops.length) h += '<div class="empty">' + esc(t('chart.noStops')) + '</div>';
    plan.stops.forEach((id, i) => {
      h += legLine(i);
      const c = P!.calls[i];
      h += '<div class="stop"><span class="n">' + (i + 1) + '</span><span><span class="nm">' + esc(region.ports[id].name) + '</span><br><span class="tm">' +
        esc(c ? t('weekday.' + c.weekday) + ' ' + fmtClock(c.arr) + ' → ' + fmtClock(c.dep) + (c.scenic ? ' · ' + t('chart.cruiseBy') : '') + (c.refuel ? ' · ' + t('chart.refuel') : '') +
          (c.rivals.length ? ' · ' + tn('chart.rivalsHere', c.rivals.length) : '') + (c.tender ? ' · ' + t('chart.tendering') : '') : t('chart.notReached')) + '</span></span>' +
        '<span class="ctl"><button class="btn sm" data-up="' + i + '" type="button" aria-label="' + esc(t('chart.moveUp')) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button class="btn sm" data-dn="' + i + '" type="button" aria-label="' + esc(t('chart.moveDown')) + '"' + (i === plan.stops.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button class="btn sm" data-rm="' + i + '" type="button" aria-label="' + esc(t('chart.remove')) + '">×</button></span></div>';
    });
    h += legLine(plan.stops.length);
    const lastLeg = P.legs.length === plan.stops.length + 1 ? P.legs[P.legs.length - 1] : null;
    h += '<div class="stop"><span class="n home" aria-hidden="true">⚓</span><span>' + (edit ? '<span class="nm">' + esc(t('fleet.edit.back', { port: region.ports[home].name })) + '</span><br>' : '<label class="nm">' + esc(t('chart.disembark')) + ' <select class="sel" id="endSel" aria-label="' + esc(t('chart.turnaround')) + '">' +
      homes.map(k => '<option value="' + k + '"' + (k === plan.end ? ' selected' : '') + '>' + esc(region.ports[k].name) + '</option>').join('') + '</select></label><br>') +
      '<span class="tm">' + esc(lastLeg ? t('chart.arriveDue', { arr: fmtClock(lastLeg.arr), due: fmtClock(P.deadline) }) : t('chart.due', { due: fmtClock(P.deadline) })) + '</span></span><span></span></div>';
    h += '</div></div>';

    // Fare
    h += '<div class="fare" data-tut="fare"><div class="top"><label class="label" for="fare">' + esc(t('chart.fare')) + '</label><span class="val" id="fareVal"></span></div>' +
      '<input type="range" id="fare" min="' + FARE_MIN + '" max="' + FARE_MAX + '" step="' + FARE_STEP + '" value="' + plan.fare + '">' +
      '<div class="curve"><svg id="curve" viewBox="0 0 320 92" role="img" aria-label="' + esc(t('chart.curveAria')) + '"></svg></div>' +
      '<div class="mix"><svg id="mix" viewBox="0 0 320 14" role="img" aria-label="' + esc(t('chart.mixAria')) + '"></svg><div class="keys" id="mixKeys"></div></div></div>';
    h += '<div class="kpis" id="kpis"></div>';
    if (!edit && grandTourOpen(s)) {
      const checks = grandTourChecks(s, P);
      h += '<div class="tour" data-tut="tour"><div class="label" style="margin-bottom:4px">' + esc(t('tour.head')) + '</div>' +
        checks.map(c => '<div class="' + (c.ok ? 'good' : 'sub2') + '">' + (c.ok ? ICON.ok : '○') + ' ' + esc(t(c.key, c.vars)) + '</div>').join('') +
        '<div class="sub2">' + esc(checks.every(c => c.ok) ? t('tour.ready') : t('tour.hint')) + '</div></div>';
    }
    h += '<div><div class="label" style="margin-bottom:6px">' + esc(t('chart.inspection', { e: errs, w: warns })) + '</div><div class="issues" id="issues"></div></div>';
    h += '<div class="ledger" id="ledger"></div>';
    if (edit) {
      h += '<button type="button" class="btn primary big" id="btnSave"' + (P.errors ? ' disabled' : '') + '>' + esc(P.errors ? tn('chart.fixToSail', P.errors) : t('fleet.edit.save')) + '</button>' +
        '<button type="button" class="btn" data-back>' + esc(t('fleet.edit.cancel')) + '</button>';
    } else if (over) {
      h += '<div class="issue warn"><span class="ic">' + ICON.warn + '</span><span>' + esc(t('chart.layup.why')) + '</span></div>' +
        '<button type="button" class="btn primary big" data-layup>' + esc(t('chart.layup.btn', { cost: kmoney(layUpCost(s, ship)) })) + '</button>';
    } else {
      h += '<button type="button" class="btn primary big" id="btnSail" data-tut="sail"' + (P.errors ? ' disabled' : '') + '>' +
        esc(P.errors ? tn('chart.fixToSail', P.errors) : t('chart.sail', { nights: plan.nights, port: region.ports[ship.port].name })) + '</button>';
    }
    box.innerHTML = h;
    wirePlanner(box);
    renderFare();
    renderIssues();
  }

  function wirePlanner(box: HTMLElement) {
    const s = app.state, plan = s.plan;
    const change = (fn: () => void) => { fn(); sound.click(app.settings); render(); app.commit({ render: false }); };
    box.querySelectorAll<HTMLButtonElement>('[data-ship]').forEach(b => b.onclick = () => change(() => {
      plan.shipId = b.dataset.ship!;
      const sh = shipById(s, plan.shipId)!;
      if (!region.ports[plan.end]?.turnaround) plan.end = sh.port;
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-nights]').forEach(b => b.onclick = () => change(() => { plan.nights = Number(b.dataset.nights); }));
    box.querySelectorAll<HTMLButtonElement>('[data-wait]').forEach(b => b.onclick = () => change(() => { plan.wait = Number(b.dataset.wait); }));
    box.querySelectorAll<HTMLButtonElement>('[data-lowsulfur]').forEach(b => b.onclick = () => change(() => { plan.lowSulfur = b.dataset.lowsulfur === '1'; }));
    box.querySelectorAll<HTMLButtonElement>('[data-offset]').forEach(b => b.onclick = () => change(() => { plan.offset = b.dataset.offset === '1'; }));
    box.querySelectorAll<HTMLButtonElement>('[data-up]').forEach(b => b.onclick = () => change(() => { const i = Number(b.dataset.up); [plan.stops[i - 1], plan.stops[i]] = [plan.stops[i], plan.stops[i - 1]]; }));
    box.querySelectorAll<HTMLButtonElement>('[data-dn]').forEach(b => b.onclick = () => change(() => { const i = Number(b.dataset.dn); [plan.stops[i + 1], plan.stops[i]] = [plan.stops[i], plan.stops[i + 1]]; }));
    box.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach(b => b.onclick = () => change(() => { plan.stops.splice(Number(b.dataset.rm), 1); }));
    box.querySelector<HTMLButtonElement>('[data-clear]')!.onclick = () => change(() => { plan.stops = []; });
    const endSel = box.querySelector<HTMLSelectElement>('#endSel');
    if (endSel) endSel.onchange = () => change(() => { plan.end = endSel.value; });
    const fromSel = box.querySelector<HTMLSelectElement>('#fromSel');
    if (fromSel) fromSel.onchange = () => change(() => { plan.from = plan.end = fromSel.value; plan.stops = plan.stops.filter(x => x !== plan.from); });
    box.querySelector<HTMLButtonElement>('#btnSave')?.addEventListener('click', saveDeployment);
    box.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { delete s.fleet!.edit; app.commit({ render: false }); app.go('fleet'); });
    const fare = box.querySelector<HTMLInputElement>('#fare')!;
    fare.oninput = () => {
      plan.fare = Number(fare.value);
      if (P) F = planFinance(s, P);
      renderFare(); renderKpisLedger();
    };
    fare.onchange = () => app.commit({ render: false });
    box.querySelector<HTMLButtonElement>('#btnSail')?.addEventListener('click', startSail);
    const lu = box.querySelector<HTMLButtonElement>('[data-layup]');
    if (lu) lu.onclick = () => {
      const r = layUp(s, plan.shipId);
      if (r.ok) { app.toast(t('chart.layup.done', { date: fmtDate(shipById(s, plan.shipId)!.day) }), 'ok'); app.commit(); }
    };
  }

  function renderFare() {
    if (!P || !F) return;
    const s = app.state;
    $('#fareVal', root)!.textContent = '$' + s.plan.fare;
    const pts = fareCurve(region, P.input.ship, summarise(P, s.plan.wait), market(s));
    let lo = Math.min(0, ...pts.map(p => p[1])), hi = Math.max(1, ...pts.map(p => p[1]));
    if (hi === lo) hi = lo + 1;
    const X = (f: number) => 10 + (f - FARE_MIN) / (FARE_MAX - FARE_MIN) * 300, Y = (v: number) => 8 + (hi - v) / (hi - lo) * 64;
    const best = pts.reduce((a, b) => b[1] > a[1] ? b : a);
    const rival = region.market.rivalFare;
    const line = pts.map(p => X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' L');
    let sv = '<line x1="10" x2="310" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="3 3"/>';
    sv += '<path d="M' + line + ' L310 ' + Y(lo) + ' L10 ' + Y(lo) + ' Z" fill="color-mix(in srgb,var(--route) 10%,transparent)"/>';
    sv += '<path d="M' + line + '" fill="none" stroke="var(--route)" stroke-width="2"/>';
    sv += '<line x1="' + X(rival) + '" x2="' + X(rival) + '" y1="6" y2="72" stroke="var(--mass)" stroke-width="1.5"/><text x="' + (X(rival) + 3) + '" y="14" font-family="Montserrat, sans-serif" font-size="9" fill="var(--ink-2)">' + esc(t('chart.rivalFare', { fare: rival })) + '</text>';
    sv += '<line x1="' + X(best[0]) + '" x2="' + X(best[0]) + '" y1="' + Y(best[1]) + '" y2="72" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="2 2"/>';
    sv += '<circle cx="' + X(s.plan.fare) + '" cy="' + Y(F.profit) + '" r="4.5" fill="var(--sheet)" stroke="var(--ink)" stroke-width="2"/>';
    sv += '<text x="10" y="86" font-family="Montserrat, sans-serif" font-size="10" fill="var(--ink-2)">$' + FARE_MIN + '</text><text x="310" y="86" text-anchor="end" font-family="Montserrat, sans-serif" font-size="10" fill="var(--ink-2)">$' + FARE_MAX + '</text>';
    sv += '<text x="' + Math.min(255, Math.max(40, X(best[0]))) + '" y="86" text-anchor="middle" font-family="Montserrat, sans-serif" font-size="10" fill="var(--ink-2)">' + esc(t('chart.best', { fare: best[0], profit: kmoney(best[1]) })) + '</text>';
    sv += '<text x="308" y="' + (Y(0) - 3) + '" text-anchor="end" font-family="Montserrat, sans-serif" font-size="9" fill="var(--ink-2)">' + esc(t('chart.breakEven')) + '</text>';
    $('#curve', root)!.innerHTML = sv;
    // Guest mix: mass and premium bookings against berths.
    const pax = Math.max(1, P.input.ship.pax);
    const wM = F.bookedMass / pax * 320, wP = F.bookedPremium / pax * 320;
    $('#mix', root)!.innerHTML = '<rect x="0" y="0" width="320" height="14" fill="var(--rule-2)"/><rect x="0" y="0" width="' + wM.toFixed(1) + '" height="14" fill="var(--mass)"/>' +
      '<rect x="' + wM.toFixed(1) + '" y="0" width="' + wP.toFixed(1) + '" height="14" fill="var(--premium)"/>';
    $('#mixKeys', root)!.innerHTML = '<span><i style="background:var(--mass)"></i>' + esc(t('chart.mass', { n: F.bookedMass })) + '</span><span><i style="background:var(--premium)"></i>' + esc(t('chart.premium', { n: F.bookedPremium })) + '</span><span>' + esc(t('chart.empty', { n: pax - F.booked })) + '</span>';
    renderKpisLedger();
  }

  function renderKpisLedger() {
    if (!P || !F) return;
    const s = app.state, ship = P.input.ship;
    const occS = F.occ >= 0.85 ? 'ok' : F.occ >= 0.6 ? 'warn' : 'err';
    const scS = P.score >= 55 ? 'ok' : P.score >= 35 ? 'warn' : 'err';
    const prS = F.profit > 0 ? 'ok' : 'err';
    $('#kpis', root)!.innerHTML =
      '<div class="kpi ' + scS + '"><span class="label">' + esc(t('chart.appeal')) + '</span><b>' + ICON[scS] + ' ' + P.score + '</b><span class="sub2">' + esc(t('chart.of100')) + '</span></div>' +
      '<div class="kpi ' + occS + '"><span class="label">' + esc(t('chart.booked')) + '</span><b>' + ICON[occS] + ' ' + Math.round(F.occ * 100) + '%</b><span class="sub2">' + F.booked + ' / ' + ship.pax + '</span></div>' +
      '<div class="kpi ' + prS + '"><span class="label">' + esc(t('chart.profit')) + '</span><b>' + ICON[prS] + ' ' + kmoney(F.profit) + '</b><span class="sub2">' + esc(t('chart.projected')) + '</span></div>';
    const ap = P.parts.map(p => '<span>' + esc(t(p.key, p.vars)) + '</span><span class="mono">' + (p.v > 0 ? '+' : '') + p.v + '</span>').join('');
    $('#ledger', root)!.innerHTML = '<span class="label hd">' + esc(t('chart.appealHead', { season: P.season ? t('season.' + P.season.id) : t('season.closed') })) + '</span>' +
      (ap || '<span class="sub2">' + esc(t('chart.noPorts')) + '</span><span></span>') +
      '<span class="label hd">' + esc(t('chart.pnl')) + '</span>' +
      '<span>' + esc(t('ledger.fares', { n: F.booked, fare: s.plan.fare, nights: P.input.nights })) + '</span><span class="mono">' + money(F.rev) + '</span>' +
      '<span>' + esc(t('ledger.onboard')) + '</span><span class="mono">' + money(F.onboard) + '</span>' +
      '<span>' + esc(t('ledger.crew')) + '</span><span class="mono">' + money(-F.crew) + '</span>' +
      '<span>' + esc(t('ledger.lease')) + '</span><span class="mono">' + money(-F.lease) + '</span>' +
      '<span>' + esc(t('ledger.food')) + '</span><span class="mono">' + money(-F.food) + '</span>' +
      '<span>' + esc(t('ledger.fuel', { t: P.burned.toFixed(1) })) + '</span><span class="mono">' + money(-F.fuel) + '</span>' +
      (F.carbon ? '<span>' + esc(t(P.offset ? 'ledger.carbonNeutral' : 'ledger.carbon')) + '</span><span class="mono">' + money(-F.carbon) + '</span>' : '') +
      '<span>' + esc(t('ledger.ports')) + '</span><span class="mono">' + money(-F.ports) + '</span>' +
      (F.fees ? '<span>' + esc(t('ledger.tolls')) + '</span><span class="mono">' + money(-F.fees) + '</span>' : '') +
      '<span class="tot">' + esc(t('ledger.profit')) + '</span><span class="mono tot" style="color:' + (F.profit >= 0 ? 'var(--ok)' : 'var(--err)') + '">' + money(F.profit) + '</span>';
  }

  function renderIssues() {
    if (!P) return;
    const list = $('#issues', root)!;
    const sorted = P.issues.slice().sort((a, b) => 'ewi'.indexOf(a.lvl[0]) - 'ewi'.indexOf(b.lvl[0]));
    const bad = sorted.filter(i => i.lvl !== 'info');
    list.innerHTML = (bad.length ? '' : '<div class="clear-ok">' + ICON.ok + ' ' + esc(t('chart.allClear')) + '</div>') +
      sorted.map(i => issueRow(i.lvl, issueText(i), '', i.at ? 'data-at="' + i.at + '"' : '')).join('');
    list.querySelectorAll<HTMLButtonElement>('[data-at]').forEach(b => b.onclick = () => showTip(b.dataset.at!));
  }

  // ---------- chart layers ----------
  function renderRoute() {
    const g = $('#routeLayer', root)!;
    if (!P) { g.innerHTML = ''; return; }
    const errAt = new Set(P.issues.filter(i => i.lvl === 'err' && i.at).map(i => i.at));
    let s = '';
    P.legs.forEach(l => {
      const bad = errAt.has(l.to);
      const pts = ptsAttr(region, l.r.pts);
      s += '<polyline points="' + pts + '" fill="none" stroke="var(--halo)" stroke-width="8" stroke-linejoin="round" opacity=".8"/>';
      s += '<polyline points="' + pts + '" fill="none" stroke="' + (bad ? 'var(--err)' : 'var(--route)') + '" stroke-width="3.4" stroke-linejoin="round"' + (bad ? ' stroke-dasharray="7 4"' : '') + '/>';
      const pp = l.r.pts.map(p => proj(p[0], p[1]));
      let tot = 0;
      const seg: number[] = [];
      for (let k = 1; k < pp.length; k++) { const d = Math.hypot(pp[k][0] - pp[k - 1][0], pp[k][1] - pp[k - 1][1]); seg.push(d); tot += d; }
      let half = tot / 2, k = 0;
      while (k < seg.length - 1 && half > seg[k]) { half -= seg[k]; k++; }
      const a = pp[k], b = pp[k + 1] ?? pp[k], f = seg[k] ? half / seg[k] : 0;
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      s += '<path d="M-6 -5 L6 0 L-6 5 Z" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + ang.toFixed(0) + ')" fill="' + (bad ? 'var(--err)' : 'var(--route)') + '"/>';
    });
    g.innerHTML = s;
    $('#mapStatus', root)!.textContent = P.legs.length ? t('chart.status', { nm: Math.round(P.nm), calls: P.calls.length, sea: P.seaDays }) : '';
  }

  function renderPorts() {
    const g = $('#portLayer', root)!;
    const s = app.state, ship = shipById(s, s.plan.shipId)!, specs = specsOf(s, ship);
    g.innerHTML = '';
    for (const id of Object.keys(region.ports)) {
      const p = region.ports[id], [x, y] = proj(p.lon, p.lat);
      const st = portStatus(region, id, specs, s.unlocked.portGroups, isSandbox(s));
      const idx = s.plan.stops.map((v, i) => v === id ? i + 1 : 0).filter(Boolean);
      const home = s.plan.from ?? ship.port;
      const isHome = id === home || id === s.plan.end;
      const n = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      n.setAttribute('class', 'port' + (st.ok ? '' : ' blocked') + (!st.ok && st.locked ? ' locked' : ''));
      n.setAttribute('tabindex', '0');
      n.setAttribute('role', 'button');
      n.setAttribute('data-port', id);
      n.setAttribute('aria-label', p.name + ', ' + (st.ok ? t('chart.portAdd') : t(st.key, st.vars)));
      let inner = '';
      if (idx.length) inner += '<circle class="mk" r="10" fill="var(--accent)"/><text text-anchor="middle" y="4" font-family="Montserrat, sans-serif" font-size="11" font-weight="600" fill="var(--accent-ink)" stroke="none">' + idx.join(',') + '</text>';
      else if (isHome) inner += '<rect class="mk" x="-7" y="-7" width="14" height="14" fill="var(--ink)"/>';
      else if (!st.ok) inner += '<g class="mk"><circle r="5.5" fill="var(--sheet)"/><path d="M-3 -3 L3 3 M3 -3 L-3 3" stroke="var(--muted)" stroke-width="1.6"/></g>';
      else inner += '<circle class="mk" r="5.5" fill="' + (p.turnaround ? 'var(--ink)' : 'var(--sheet)') + '"/>';
      if (!st.ok && st.locked) inner += '<text x="0" y="-9" text-anchor="middle" font-size="10" fill="var(--muted)" stroke="none">🔒</text>';
      if (p.berth === 'tender') inner += '<text x="7" y="-5" font-size="9" fill="var(--ink-2)" stroke="none" font-family="Montserrat, sans-serif">T</text>';
      const [dx, dy, an] = p.label;
      inner += '<text class="lbl" x="' + dx + '" y="' + dy + '" text-anchor="' + an + '">' + esc(p.name) + (p.country === 'PM' ? ' (FR)' : '') + '</text>';
      inner += '<circle class="hit" r="14"/>';
      n.innerHTML = inner;
      n.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
      n.addEventListener('pointerenter', () => showTip(id));
      n.addEventListener('pointerleave', hideTip);
      n.addEventListener('focus', () => showTip(id));
      n.addEventListener('blur', hideTip);
      const act = () => {
        if (sailing) return;
        if (!st.ok) { sound.red(app.settings); showTip(id); return; }
        if (id === (s.plan.from ?? ship.port) && !s.plan.stops.length) { showTip(id); return; }
        s.plan.stops.push(id);
        sound.click(app.settings);
        render();
        app.commit({ render: false });
        showTip(id);
      };
      n.addEventListener('click', act);
      n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      g.appendChild(n);
    }
    if (!sailing) {
      const at = region.ports[s.plan.from ?? ship.port];
      const [x, y] = proj(at.lon, at.lat);
      $('#shipLayer', root)!.innerHTML = shipGlyph(x + 12, y - 12, 0);
    }
  }

  function showTip(id: string) {
    const s = app.state, ship = shipById(s, s.plan.shipId)!, specs = specsOf(s, ship);
    const p = region.ports[id], st = portStatus(region, id, specs, s.unlocked.portGroups, isSandbox(s));
    const card = $('#mapcard', root)!;
    let status = st.ok ? (id === (s.plan.from ?? ship.port) && !s.plan.stops.length ? t('chart.tip.here') : t('chart.tip.add', { n: s.plan.stops.length + 1 })) : t(st.key, st.vars);
    if (st.ok && s.plan.stops.includes(id)) status = t('chart.tip.again');
    tip.innerHTML = '<h4>' + esc(p.name) + '</h4><div class="sub2">' + esc(t('country.' + p.country)) + (p.turnaround ? ' · ' + esc(t('chart.tip.turnaround')) : '') + '</div>' +
      '<div class="tags">' + p.tags.map(x => '<span class="tag">' + esc(x) + '</span>').join('') + '</div>' +
      '<div class="row"><span>' + esc(t('chart.tip.appeal')) + '</span><span class="mono">' + p.appeal[0] + ' / ' + p.appeal[1] + '</span></div>' +
      '<div class="row"><span>' + esc(t('chart.tip.berth')) + '</span><span class="mono">' + esc(p.berth === 'pier' ? t('chart.tip.pier', { draft: p.maxDraft ?? '—', len: p.maxLength ?? '—' }) : t('chart.tip.' + p.berth)) + '</span></div>' +
      '<div class="row"><span>' + esc(t('chart.tip.fuel')) + '</span><span class="mono">' + esc(p.fuel ? t('chart.tip.fuelYes') : t('chart.tip.fuelNo')) + '</span></div>' +
      '<div class="row"><span>' + esc(t('chart.tip.fees')) + '</span><span class="mono">$' + p.callFee.toLocaleString('en-US') + ' + $' + p.headTax + '/' + esc(t('chart.tip.guest')) + '</span></div>' +
      (p.berths != null && !p.privateIsland ? '<div class="row"><span>' + esc(t('chart.tip.piers')) + '</span><span class="mono">' + p.berths + (p.tenderOk ? ' + ' + esc(t('chart.tip.anchor')) : '') + '</span></div>' + rivalWeek(id) : '') +
      (p.spend ? '<div class="row"><span>' + esc(t('chart.tip.island')) + '</span><span class="mono">+$' + p.spend + '/' + esc(t('chart.tip.guest')) + '</span></div>' : '') +
      '<div class="st ' + (st.ok ? 'ok' : 'bad') + '">' + (st.ok ? ICON.ok : ICON.err) + ' ' + esc(status) + '</div>';
    tip.hidden = false;
    const svgR = $('#map', root)!.getBoundingClientRect(), cR = card.getBoundingClientRect();
    const [x, y] = proj(p.lon, p.lat);
    const sx = svgR.left - cR.left + x / MW * svgR.width, sy = svgR.top - cR.top + y / MH * svgR.height;
    const tw = 260;
    let left = sx + 16;
    if (left + tw > cR.width - 6) left = sx - 16 - tw;
    left = Math.max(6, left);
    let top = sy - 20;
    const th = tip.offsetHeight;
    if (top + th > cR.height - 6) top = cR.height - 6 - th;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(6, top) + 'px';
  }
  function hideTip() { tip.hidden = true; }

  /** Which weekdays rivals call here: "Mon 1 · Tue 2 (full)". */
  function rivalWeek(id: string): string {
    const p = region.ports[id];
    const days = [0, 1, 2, 3, 4, 5, 6].map(d => ({ d, n: rivalsAt(region, id, d).length })).filter(x => x.n);
    if (!days.length) return '';
    return '<div class="row"><span>' + esc(t('chart.tip.rivals')) + '</span><span class="mono">' +
      days.map(x => esc(t('weekday.' + x.d)) + ' ' + x.n + (p.berths != null && x.n >= p.berths ? ' ' + ICON.err : '')).join(' · ') + '</span></div>';
  }

  // ---------- storms ----------
  function renderStorms() {
    const g = $('#stormLayer', root)!;
    const s = app.state, ship = shipById(s, s.plan.shipId)!;
    const d0 = (s.plan.day ?? ship.day) + s.plan.wait, d1 = d0 + s.plan.nights;
    const ppn = pxPerNm(region);
    let h = '';
    for (const st of stormsBetween(region, d0, d1)) {
      // The forecast cone: the danger zone along the forecast track, widening with each day ahead.
      const pts: [number, number, number][] = [];
      for (let d = Math.max(d0, st.t0); d <= d1 + 0.01; d += 1) {
        const c = stormAt(st, d, false);
        if (c) pts.push([...proj(c[0], c[1]), (DANGER_NM + coneNm(d - d0)) * ppn] as [number, number, number]);
      }
      if (!pts.length) continue;
      h += pts.map(([x, y, r]) => '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="var(--err)" opacity=".04"/>').join('');
      const last = pts[pts.length - 1];
      h += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="' + last[2].toFixed(1) + '" fill="none" stroke="var(--err)" stroke-width="1" stroke-dasharray="3 5" opacity=".6"/>';
      h += '<polyline points="' + pts.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ') + '" fill="none" stroke="var(--err)" stroke-width="1.5" stroke-dasharray="4 4"/>';
      const [x, y] = pts[0];
      const spin = app.reduced() ? '' : '<animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="6s" repeatCount="indefinite"/>';
      h += '<g transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"><g>' + spin +
        '<path d="M0 -9 C7 -9 9 -3 4 0 M0 9 C-7 9 -9 3 -4 0" fill="none" stroke="var(--err)" stroke-width="2.5" stroke-linecap="round"/><circle r="3" fill="var(--err)"/></g>' +
        '<text x="12" y="-8" class="canal-lbl" style="fill:var(--err)">' + esc(t('chart.storm', { name: st.name })) + '</text></g>';
    }
    g.innerHTML = h;
  }

  // ---------- graduation ----------
  function openCrossing() {
    const s = app.state, g = region.graduation!;
    const to = g.toRegion!;
    const body = el('<div class="body" style="padding:0"></div>');
    const chosen = new Set<string>();
    const draw = () => {
      const dest = REGIONS[to]?.ports[g.toPort!]?.name ?? region.ports[g.toPort!]?.name ?? 'Miami';
      let h = '<p class="hint">' + esc(g.guestLeg ? t('cross.introGuests', { port: dest, nm: g.guestLeg.nm.toLocaleString('en-US'), days: g.guestLeg.days }) : t('cross.intro', { port: dest })) + '</p><div class="ships">';
      for (const sh of s.ships) {
        const c = crossingFor(s, sh);
        const can = c.ok;
        h += '<label class="ship" style="cursor:' + (can ? 'pointer' : 'not-allowed') + '"><span><input type="checkbox" data-ship="' + sh.id + '"' + (can ? '' : ' disabled') + (chosen.has(sh.id) ? ' checked' : '') + '> <span class="nm">' + esc(sh.name) + '</span></span>' +
          '<span class="loc">' + esc(region.ports[sh.port].name) + '</span><span class="specs">' +
          (c.nm ? esc(t('cross.stats', { nm: c.nm, days: (c.hours / 24).toFixed(1), fuel: Math.round(Math.max(0, c.fuelLeft) * 100), heel: Math.round(c.heel) })) : '') + '</span>' +
          '<span style="grid-column:1/-1">' + (c.issues.length ? c.issues.map(i => '<span class="' + (i.lvl === 'err' ? 'bad' : 'warned') + '">' + ICON[i.lvl] + ' ' + esc(t(i.key, i.vars)) + '</span>').join('<br>') : '<span class="good">' + ICON.ok + ' ' + esc(t('cross.ready')) + '</span>') + '</span></label>';
      }
      h += '</div><div class="ledger"><span class="label hd">' + esc(t('cross.carry')) + '</span>' +
        '<span>' + esc(t('cross.keep')) + '</span><span></span>' +
        '<span>' + esc(t('cross.cash', { pct: Math.round((g.keepCash ?? 0.25) * 100) })) + '</span><span class="mono">' + money(Math.round(s.cash * (g.keepCash ?? 0.25)) + (g.grant ?? 0)) + '</span>' +
        '<span>' + esc(t('cross.rep')) + '</span><span class="mono">' + s.rep.toFixed(1) + ' → ' + (Math.round((s.rep + 3) / 2 * 10) / 10).toFixed(1) + '</span>' +
        '<span>' + esc(t('cross.left')) + '</span><span></span></div>';
      body.innerHTML = h;
      body.querySelectorAll<HTMLInputElement>('[data-ship]').forEach(cb => cb.onchange = () => { if (cb.checked) chosen.add(cb.dataset.ship!); else chosen.delete(cb.dataset.ship!); draw(); });
    };
    draw();
    app.modal({
      title: t('milestone.' + g.id + '.name'), wide: true, body, buttons: [{ label: t('ui.cancel') }, {
        label: t(g.guestLeg ? 'cross.goAtlantic' : 'cross.go'), primary: true, action: () => {
          if (!chosen.size) { app.toast(t('cross.pickShip')); return false; }
          const r = graduate(s, [...chosen]);
          if ('ok' in r) { if (!r.ok) app.toast(t(r.key, r.vars)); return false; }
          sound.horn(app.settings);
          app.go('chartroom');
          app.commit();
          app.chapterIntro(r);
        },
      }],
    });
  }

  // ---------- schedule strip ----------
  function renderStrip(plan: Plan | null = P) {
    const svg = $('#strip', root)!;
    if (!plan) { svg.innerHTML = ''; return; }
    const ship = plan.input.ship, nights = plan.input.nights;
    const span = nights * 24 + 24, X = (h: number) => 20 + h / span * 965;
    let s = '';
    for (let d = 0; d <= nights; d++) {
      s += '<rect x="' + X(d * 24 - 4) + '" y="16" width="' + (X(10) - X(0)) + '" height="118" fill="var(--rule-2)" opacity=".6"/>';
      s += '<line x1="' + X(d * 24) + '" x2="' + X(d * 24) + '" y1="12" y2="134" stroke="var(--rule)"/><text x="' + (X(d * 24) + 4) + '" y="11" font-family="Montserrat, sans-serif" font-size="11" fill="var(--ink-2)">' + esc(t('chart.day', { n: d + 1 })) + '</text>';
    }
    s += '<line x1="' + X(plan.deadline) + '" x2="' + X(plan.deadline) + '" y1="14" y2="134" stroke="var(--err)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="' + (X(plan.deadline) - 4) + '" y="146" text-anchor="end" font-family="Montserrat, sans-serif" font-size="10" fill="var(--err)">' + esc(t('chart.guestsOff', { t: fmtClock(plan.deadline) })) + '</text>';
    const yb = 40;
    plan.legs.forEach(l => {
      s += '<line x1="' + X(l.dep) + '" x2="' + X(l.dep + l.sailH) + '" y1="' + yb + '" y2="' + yb + '" stroke="var(--route)" stroke-width="3"/>';
      if (l.idleH > 0.3) s += '<line x1="' + X(l.dep + l.sailH) + '" x2="' + X(l.arr) + '" y1="' + yb + '" y2="' + yb + '" stroke="var(--ink-2)" stroke-width="2" stroke-dasharray="2 3"/>';
    });
    s += '<rect x="' + (X(17) - 3) + '" y="' + (yb - 12) + '" width="6" height="24" fill="var(--ink)"/>';
    plan.calls.forEach(c => {
      s += '<rect x="' + X(c.arr) + '" y="' + (yb - 12) + '" width="' + (X(c.dep) - X(c.arr)) + '" height="24" fill="var(--sheet)" stroke="var(--ink)" stroke-width="1.5"/><text x="' + ((X(c.arr) + X(c.dep)) / 2) + '" y="' + (yb + 4) + '" text-anchor="middle" font-family="Montserrat, sans-serif" font-size="11" font-weight="600" fill="var(--ink)">' + c.id + '</text>';
    });
    if (plan.legs.length === plan.input.stops.length + 1) {
      const l = plan.legs[plan.legs.length - 1];
      s += '<rect x="' + (X(l.arr) - 3) + '" y="' + (yb - 12) + '" width="6" height="24" fill="' + (l.arr > plan.deadline + 0.05 ? 'var(--err)' : 'var(--ink)') + '"/>';
    }
    const fy = (v: number) => 132 - Math.max(-0.15, v / ship.fuelCap) * 64;
    s += '<line x1="20" x2="985" y1="' + fy(ship.fuelCap * FUEL_RESERVE) + '" y2="' + fy(ship.fuelCap * FUEL_RESERVE) + '" stroke="var(--warn)" stroke-dasharray="3 3"/><text x="22" y="' + (fy(ship.fuelCap * FUEL_RESERVE) - 3) + '" font-family="Montserrat, sans-serif" font-size="9.5" fill="var(--warn)">' + esc(t('chart.reserve')) + '</text>';
    s += '<text x="22" y="' + (fy(ship.fuelCap) + 9) + '" font-family="Montserrat, sans-serif" font-size="9.5" fill="var(--ink-2)">' + esc(t('chart.fuelTank', { t: ship.fuelCap })) + '</text>';
    s += '<polyline points="' + plan.fuelPts.map(([h, v]) => X(h).toFixed(1) + ',' + fy(v).toFixed(1)).join(' ') + '" fill="none" stroke="' + (plan.minFuel < 0 ? 'var(--err)' : 'var(--ink)') + '" stroke-width="2"/>';
    plan.calls.filter(c => c.refuel).forEach(c => { s += '<text x="' + X(c.dep) + '" y="' + (fy(ship.fuelCap) - 4) + '" text-anchor="middle" font-family="Montserrat, sans-serif" font-size="9.5" fill="var(--ok)">' + esc(t('chart.refuel')) + '</text>'; });
    svg.innerHTML = s;
    $('#stripMeta', root)!.textContent = t('chart.stripMeta', { t: plan.burned.toFixed(1), pct: Math.round(plan.minFuel / ship.fuelCap * 100) });
  }

  function renderMilestones() {
    const s = app.state;
    if (s.fleet) {
      $('#milestones', root)!.innerHTML = fleetGoals(s).map(g => '<div class="m' + (g.done ? ' done' : '') + '"><span class="box">' + (g.done ? '✓' : '') + '</span><span><b>' + esc(t('fleet.goal.' + g.id)) + '</b><br><span class="ds">' + esc(t('fleet.goal.' + g.id + '.now', g.vars)) + '</span></span><span></span></div>').join('');
      return;
    }
    $('#milestones', root)!.innerHTML = (MILESTONES[s.region] ?? []).map(m => {
      const done = s.milestones.includes(m.id);
      return '<div class="m' + (done ? ' done' : '') + '"><span class="box" aria-label="' + esc(done ? t('ui.done') : t('ui.open')) + '">' + (done ? '✓' : '') + '</span>' +
        '<span><b>' + esc(t('milestone.' + m.id + '.name')) + '</b><br><span class="ds">' + esc(t('milestone.' + m.id + '.goal')) + '</span></span><span class="rw">' + esc(t('milestone.' + m.id + '.reward')) + '</span></div>';
    }).join('') + graduationRow();
    $('#milestones', root)!.querySelector<HTMLButtonElement>('[data-cross]')?.addEventListener('click', openCrossing);
  }

  function graduationRow(): string {
    const g = region.graduation;
    if (!g) return '';
    const open = graduationOpen(app.state);
    if (g.cruise) {
      const done = app.state.milestones.includes(g.id);
      return '<div class="m' + (done ? ' done' : '') + '"><span class="box">' + (done ? '✓' : '·') + '</span><span><b>' + esc(t('milestone.' + g.id + '.name')) + '</b><br><span class="ds">' + esc(t('milestone.' + g.id + '.goal')) + '</span></span>' +
        '<span class="rw">' + esc(t('milestone.' + g.id + '.reward')) + '</span></div>';
    }
    return '<div class="m"><span class="box">·</span><span><b>' + esc(t('milestone.' + g.id + '.name')) + '</b><br><span class="ds">' + esc(t('milestone.' + g.id + '.goal')) + '</span></span>' +
      '<span class="rw">' + (g.locked ? esc(t('chart.comingSoon')) : open ? '<button type="button" class="btn sm primary" data-cross data-tut="cross">' + esc(t('cross.plan')) + '</button>' : esc(t('milestone.' + g.id + '.reward'))) + '</span></div>';
  }

  function renderLog() {
    const box = $('#log', root)!;
    const s = app.state;
    if (sailing) {
      box.innerHTML = sailing.shown.map(e => '<div class="e"><span class="mono sub2">' + esc(fmtClock(e.t)) + '</span><span class="' + (e.good ? 'good' : 'bad') + '">' + (e.good ? ICON.ok : ICON.warn) + ' ' + esc(t(e.key, e.vars)) + '</span><span></span></div>').join('') || '<p class="hint">' + esc(t('chart.underway')) + '</p>';
      return;
    }
    box.innerHTML = s.log.length ? s.log.slice().reverse().map(v => '<div class="e"><span class="mono sub2">#' + v.n + '</span><span>' + esc(v.route.map(id => (REGIONS[v.region] ?? region).ports[id]?.name ?? id).join(' → ')) + ' · ' + esc(v.ship) + ' · ' + esc(t('chart.satShort', { n: v.sat })) + '</span><span class="mono ' + (v.profit >= 0 ? 'good' : 'bad') + '">' + kmoney(v.profit) + '</span></div>').join('')
      : '<p class="hint">' + esc(t('chart.noVoyages')) + '</p>';
  }

  // ---------- sailing ----------
  function startSail() {
    if (!P || P.errors || sailing) return;
    const res = sail(app.state);
    if (!res) return;
    sound.horn(app.settings);
    hideTip();
    const plan = res.plan;
    const segs: { t0: number; t1: number; pp?: [number, number][]; cum?: number[]; stay?: [number, number] }[] = [];
    plan.legs.forEach((l, i) => {
      const pp = l.r.pts.map(p => proj(p[0], p[1]));
      const cum = [0];
      for (let k = 1; k < pp.length; k++) cum.push(cum[k - 1] + Math.hypot(pp[k][0] - pp[k - 1][0], pp[k][1] - pp[k - 1][1]));
      segs.push({ t0: l.dep, t1: l.dep + l.sailH, pp, cum });
      segs.push({ t0: l.dep + l.sailH, t1: i < plan.calls.length ? plan.calls[i].dep : l.arr, stay: pp[pp.length - 1] });
    });
    const T0 = 17, T1 = plan.ret;
    const instant = app.settings.instant || app.reduced();
    const dur = instant ? 0 : 10000 / app.settings.speed;
    sailing = { shown: [], raf: 0 };
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#planner button, #planner input, #planner select').forEach(x => { x.disabled = true; });
    renderStrip(plan);
    renderLog();
    const clock = $('#clock', root)!;
    clock.hidden = instant;
    const posAt = (h: number) => {
      for (const sg of segs) {
        if (h <= sg.t1 || sg === segs[segs.length - 1]) {
          if (sg.stay) return { x: sg.stay[0], y: sg.stay[1], a: 0 };
          const pp = sg.pp!, cum = sg.cum!;
          const f = Math.max(0, Math.min(1, (h - sg.t0) / (sg.t1 - sg.t0 || 1))), d = f * cum[cum.length - 1];
          let k = 1;
          while (k < cum.length - 1 && cum[k] < d) k++;
          const a = pp[k - 1], b = pp[k], ff = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
          return { x: a[0] + (b[0] - a[0]) * ff, y: a[1] + (b[1] - a[1]) * ff, a: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI };
        }
      }
      return { x: 0, y: 0, a: 0 };
    };
    let lastA = 0;
    const startMs = performance.now();
    const step = (now: number) => {
      if (!sailing) return;
      const f = dur ? Math.min(1, (now - startMs) / dur) : 1, h = T0 + (T1 - T0) * f, p = posAt(h);
      if (p.a !== 0) lastA = p.a;
      $('#shipLayer', root)!.innerHTML = shipGlyph(p.x, p.y, lastA);
      clock.textContent = fmtClock(h).replace('D', t('chart.dayShort'));
      const newly = res.events.filter(e => e.t <= h && !sailing!.shown.includes(e));
      if (newly.length) { sailing.shown.push(...newly); renderLog(); }
      if (f < 1) sailing.raf = requestAnimationFrame(step);
      else finish(res);
    };
    if (instant) finish(res); else sailing.raf = requestAnimationFrame(step);
  }

  function finish(res: VoyageResult) {
    sailing = null;
    $('#clock', root)!.hidden = true;
    app.commit();
    const s = app.state, plan = res.plan, ship = shipById(s, res.shipId)!;
    const kind = res.profit >= 0 && res.sat >= 65 ? 'ok' : res.profit >= 0 ? 'warn' : 'err';
    if (res.milestones.length) sound.good(app.settings);
    const routeTxt = [plan.input.start, ...plan.calls.map(c => c.id), plan.input.end].map(id => region.ports[id].name).join(' → ');
    const body =
      '<div class="verdict ' + kind + '">' + ICON[kind] + ' ' + esc(res.profit >= 0 ? t('report.profit', { v: money(res.profit) }) : t('report.loss', { v: money(res.profit) })) + ' · ' + esc(t('report.sat', { n: res.sat })) + '</div>' +
      '<div class="sub2">' + esc(routeTxt) + '</div>' +
      '<div class="ledger"><span>' + esc(t('report.booked')) + '</span><span class="mono">' + res.fin.booked + ' / ' + plan.input.ship.pax + '</span>' +
      '<span>' + esc(t('report.projected')) + '</span><span class="mono">' + money(res.fin.profit) + '</span>' +
      '<span>' + esc(t('report.events')) + '</span><span class="mono">' + money(-res.extra) + '</span>' +
      '<span class="tot">' + esc(t('report.actual')) + '</span><span class="mono tot">' + money(res.profit) + '</span>' +
      '<span>' + esc(t('ui.reputation')) + '</span><span class="mono">' + res.repBefore.toFixed(1) + ' → ' + res.repAfter.toFixed(1) + '</span>' +
      (isSandbox(s) ? '' : '<span>' + esc(t('ui.cash')) + '</span><span class="mono">' + money(res.cashBefore) + ' → ' + money(res.cashAfter) + '</span>') + '</div>' +
      '<div><div class="label" style="margin-bottom:4px">' + esc(t('chart.log')) + '</div>' +
      (res.events.length ? '<ul>' + res.events.map(e => '<li class="' + (e.good ? 'good' : 'bad') + '">' + esc(t(e.key, e.vars)) + '</li>').join('') + '</ul>' : '<p class="hint">' + esc(t('report.quiet')) + '</p>') + '</div>' +
      res.milestones.map(m => '<div class="unlock"><b>' + esc(t('report.milestone', { name: t('milestone.' + m + '.name') })) + '</b> ' + esc(t('milestone.' + m + '.reward')) + '</div>').join('') +
      (res.firsts.length ? '<div class="first"><b>' + esc(tn('report.firsts', res.firsts.length, { dp: res.dp })) + '</b> ' + esc(res.firsts.map(f => firstName(f, region)).join(' · ')) + '</div>' : '') +
      '<p class="hint">' + esc(t('report.nowAt', { ship: ship.name, port: region.ports[ship.port].name, date: fmtDate(ship.day) })) + '</p>';
    const tour = res.grandTour ? '<div class="unlock"><b>' + esc(t('tour.done')) + '</b> ' + esc(t('tour.doneSub')) + '</div>' : '';
    app.modal({
      title: t('report.title', { n: res.logN }), sub: ship.name + ' · ' + tn('report.nights', plan.input.nights) + ' · ' + (plan.season ? t('season.' + plan.season.id) : ''), body: tour + body,
      buttons: [{ label: t('report.back'), primary: true, action: res.grandTour ? () => { queueMicrotask(() => app.campaignEnd()); } : undefined }],
    });
  }

  return {
    el: root,
    render,
    destroy() { if (sailing) cancelAnimationFrame(sailing.raf); sailing = null; },
  };
}

export function firstName(id: string, region: { ports: Record<string, { name: string }> }): string {
  const [k, v] = id.split(':');
  if (k === 'port') return t('first.port', { port: region.ports[v]?.name ?? v, dp: firstDp(id) });
  if (k === 'region') return t('first.region', { dp: firstDp(id) });
  return t('first.' + k, { dp: firstDp(id) });
}
