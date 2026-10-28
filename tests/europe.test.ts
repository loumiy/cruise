import { describe, expect, it } from 'vitest';
import { REGIONS, HULLS, EVENTS } from '../src/sim/data';
import { planVoyage, portStatus, type PlanInput } from '../src/sim/planner';
import { route } from '../src/sim/route';
import { analyse, canPlace, type Design } from '../src/sim/ship';
import { summarise, finance } from '../src/sim/economy';
import { checkCrossing } from '../src/sim/crossing';
import { dayOf } from '../src/sim/calendar';
import {
  newGame, report, runTrial, commission, graduate, crossingFor, moveRegion, draftPlan, sail, normalisePlan,
  grandTourChecks, grandTourOpen, cloneDesign, checkMilestones, type GameState,
} from '../src/sim/game';

const EU = REGIONS.europe;
const bp = (name: string) => newGame('sandbox').blueprints.find(b => b.name === name)!.design;
const specs = (d: Design) => report(newGame('sandbox'), d).specs;

/** Fit battery banks in free space on the tank top, the way a player would in the Drydock. */
function withBatteries(d: Design, n: number): Design {
  const out = cloneDesign(d);
  const H = HULLS[d.hull];
  for (let k = 0; k < n; k++) {
    let done = false;
    for (let c = 0; c < H.cols && !done; c++) for (let r = 0; r < H.rows && !done; r++) {
      if (!canPlace(out, 'BAT', 1, c, r, 2, 1).ok) continue;
      out.blocks.push({ uid: 'bat' + k, type: 'BAT', deck: 1, c, r, w: 2, h: 1 });
      done = true;
    }
    if (!done) throw new Error('no room for a battery');
  }
  return out;
}

const sovereign = bp('MS Atlantic Sovereign');
const grand = specs(sovereign), grandB = specs(withBatteries(sovereign, 4));
const tern = specs(bp('MV Northern Tern')), ternB = specs(withBatteries(bp('MV Northern Tern'), 1)), crown = specs(bp('MS Northern Crown'));
const july = dayOf(2031, 7, 5);
const base = (o: Partial<PlanInput> = {}): PlanInput => ({ region: EU, ship: grandB, start: 'BCN', stops: ['PMI', 'MRS', 'VFR', 'LIV'], end: 'BCN', nights: 7, departDay: july, openGroups: [], ...o });
const keys = (i: PlanInput) => planVoyage(i).issues.map(x => x.key);
const mk = { rep: 3, demandBonus: 0 };

describe('Europe data', () => {
  it('has four chart areas, about 30 ports and the doc’s home ports', () => {
    expect(EU.areas).toEqual(['british', 'nordic', 'wmed', 'emed']);
    const ids = Object.keys(EU.ports);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    for (const id of ids) expect(EU.areas).toContain(EU.ports[id].area);
    for (const id of ['SOU', 'CPH', 'BCN', 'CIV', 'PIR']) expect(EU.ports[id].turnaround).toBe(true);
    for (const a of EU.areas!) expect(ids.some(id => EU.ports[id].area === a && EU.ports[id].turnaround)).toBe(true);
  });
  it('the Grand hull matches the doc, and its template is ready for the Atlantic', () => {
    expect(HULLS.grand).toMatchObject({ cols: 28, rows: 9, length: 290, beam: 36, draft: 8.2, airDraft: 58 });
    expect(HULLS.grand.decks.length).toBe(8);
    const r = analyse(sovereign);
    expect(r.errors).toBe(0);
    expect(r.pax).toBeGreaterThanOrEqual(1200);
    expect(r.pax).toBeLessThanOrEqual(1800);
    expect(r.foodDays).toBeGreaterThanOrEqual(14);
  });
  it('Europe-only events never roll elsewhere', () => {
    const mine = EVENTS.filter(e => e.region === 'europe').map(e => e.id);
    expect(mine).toEqual(expect.arrayContaining(['mistral', 'meltemi', 'dolphins', 'strike']));
  });
});

describe('Europe rules', () => {
  it('cruises run 7 to 14 nights, and the plan snaps to a length on offer', () => {
    expect(EU.nights).toEqual([7, 9, 10, 12, 14]);
    const s = newGame('sandbox');
    moveRegion(s, 'europe');
    s.plan.nights = 4;
    normalisePlan(s);
    expect(s.plan.nights).toBe(7);
  });
  it('carbon is charged on every tonne burned; LNG pays less, offsets cost more', () => {
    const p = planVoyage(base());
    const f = finance(EU, grandB, summarise(p), 220, mk);
    expect(f.carbon).toBe(Math.round(p.burned * EU.carbon!.price));
    const lng = planVoyage(base({ ship: { ...grandB, lng: true } }));
    expect(lng.carbonPrice).toBeCloseTo(EU.carbon!.price * EU.carbon!.lngShare, 6);
    const off = planVoyage(base({ offset: true }));
    expect(off.offset).toBe(true);
    const fo = finance(EU, grandB, summarise(off), 220, mk);
    expect(fo.carbon).toBeGreaterThan(f.carbon);
    expect(fo.premium).toBeGreaterThan(f.premium);
  });
  it('the fjords are zero-emission: a ship needs battery range to call', () => {
    expect(portStatus(EU, 'GEI', grand, []).ok).toBe(false);
    expect(portStatus(EU, 'GEI', grandB, []).ok).toBe(true);
    expect(tern.zeroNm).toBe(0);
    expect(ternB.zeroNm).toBeGreaterThan(EU.ports.FLA.zeroNm!);
    // A small, frugal ship goes further on one battery than a big ship does on one.
    expect(ternB.zeroNm).toBeGreaterThan(grandB.zeroNm / 4);
    const p = planVoyage(base({ start: 'SOU', stops: ['BGO', 'GEI', 'SVG'], end: 'SOU' }));
    expect(p.zeroCalls).toEqual(['GEI']);
  });
  it('Venice bars big ships; small ones still call', () => {
    expect(portStatus(EU, 'VCE', grand, []).ok).toBe(false);
    const v = portStatus(EU, 'VCE', grand, []);
    expect(v.ok ? '' : v.key).toBe('plan.port.banned');
    expect(portStatus(EU, 'VCE', tern, []).ok).toBe(true);
  });
  it('the Kiel Canal takes small ships; big ones sail round Denmark', () => {
    const small = route(EU, 'SOU', 'KEL', { draft: tern.draft, air: tern.air, beam: tern.beam, length: tern.length })!;
    const big = route(EU, 'SOU', 'KEL', { draft: grand.draft, air: grand.air, beam: grand.beam, length: grand.length })!;
    expect(small.canals).toContain('kiel');
    expect(big.canals).not.toContain('kiel');
    expect(big.nm).toBeGreaterThan(small.nm + 150);
    expect(keys(base({ start: 'SOU', stops: ['KEL'], end: 'CPH' }))).toContain('plan.canalAround');
  });
  it('turnarounds near big airports book better', () => {
    const big = planVoyage(base({ start: 'SOU', stops: ['BGO', 'SVG'], end: 'SOU' }));
    const small = planVoyage(base({ ship: tern, start: 'KEL', stops: ['BGO', 'SVG'], end: 'KEL' }));
    expect(big.flyIn).toBeGreaterThan(1);
    expect(small.flyIn).toBeLessThan(big.flyIn);
  });
  it('each extra country adds appeal', () => {
    const p = planVoyage(base());
    expect(p.parts.some(x => x.key === 'appeal.countries')).toBe(true);
  });
  it('a long one-way cruise across three areas is legal: no PVSA here', () => {
    const p = planVoyage(base({ start: 'CPH', stops: ['GEI', 'BGO', 'EDI', 'SOU', 'LIS', 'GIB'], end: 'BCN', nights: 14 }));
    expect(p.issues.filter(i => i.lvl === 'err').map(i => i.key)).toEqual([]);
    expect(p.areas.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Chapter 3 graduation: the transatlantic crossing', () => {
  const g = REGIONS.alaska.graduation!;
  it('the Grand template makes it; a stock liner and expedition ship need a refit; the Mega is too tall', () => {
    expect(checkCrossing(g, 'SEA', grand, REGIONS.alaska.ports).ok).toBe(true);
    const lin = checkCrossing(g, 'SEA', crown, REGIONS.alaska.ports).issues.map(i => i.key);
    expect(lin).toContain('cross.food');
    expect(checkCrossing(g, 'SEA', tern, REGIONS.alaska.ports).ok).toBe(false);
    expect(checkCrossing(g, 'SEA', specs(bp('MS Harbor Majesty')), REGIONS.alaska.ports).issues.map(i => i.key)).toContain('cross.tooTall');
    expect(checkCrossing(g, 'SEA', { ...grand, vmax: 15 }, REGIONS.alaska.ports).issues.map(i => i.key)).toContain('cross.tooSlow');
  });
  it('the Grand hull unlocks with Northern light, and the crossing lands in Southampton', () => {
    const s = newGame('campaign');
    s.tutorial.off = true;
    s.region = 'alaska';
    s.rep = 4.2;
    s.unlocked.drydock = true;
    s.cash = 50_000_000;
    checkMilestones(s);
    expect(s.unlocked.hulls).toContain('grand');
    const tpl = s.blueprints.find(b => b.name === 'MS Atlantic Sovereign')!;
    runTrial(s, tpl.id);
    const c = commission(s, tpl.id, 'SEA');
    if (!('ship' in c)) throw new Error('commission failed');
    c.ship.day = dayOf(2030, 8, 20);
    expect(crossingFor(s, c.ship).ok).toBe(true);
    const r = graduate(s, [c.ship.id]);
    expect('ships' in r).toBe(true);
    expect(s.region).toBe('europe');
    expect(s.ships[0].port).toBe('SOU');
    expect(s.firsts).toContain('transatlantic');
    expect(EU.nights).toContain(s.plan.nights);
  });
});

function europeGame(rep = 4.6): GameState {
  const s = newGame('sandbox');
  moveRegion(s, 'europe');
  s.blueprints.push({ id: 'bpG', name: 'Sovereign B', design: withBatteries(sovereign, 4) });
  runTrial(s, 'bpG');
  const c = commission(s, 'bpG', 'CPH');
  if (!('ship' in c)) throw new Error('commission failed');
  c.ship.day = july;
  s.ships = [c.ship];
  s.rep = rep;
  s.plan = { shipId: c.ship.id, nights: 14, wait: 0, stops: ['GEI', 'BGO', 'EDI', 'SOU', 'LIS', 'GIB'], end: 'BCN', fare: 220 };
  return s;
}

describe('the Grand Tour', () => {
  it('the planner shows what the tour still needs', () => {
    const s = europeGame(4.0);
    expect(grandTourOpen(s)).toBe(true);
    const checks = grandTourChecks(s, draftPlan(s)!);
    expect(checks.find(c => c.key === 'tour.rep')!.ok).toBe(false);
    expect(checks.filter(c => c.key !== 'tour.rep').every(c => c.ok)).toBe(true);
    s.plan.stops = ['BGO', 'EDI', 'SOU', 'LIS', 'GIB'];
    expect(grandTourChecks(s, draftPlan(s)!).find(c => c.key === 'tour.zero')!.ok).toBe(false);
  });
  it('sailing it finishes the campaign and unlocks fleet mode', () => {
    const s = europeGame();
    const r = sail(s)!;
    expect(r.grandTour).toBe(true);
    expect(s.milestones).toContain('grandTour');
    expect(s.unlocked.fleet).toBe(true);
    expect(s.firsts).toEqual(expect.arrayContaining(['grandTour', 'zero', 'fortnight']));
    expect(grandTourOpen(s)).toBe(false);
  });
  it('a short cruise is not the tour', () => {
    const s = europeGame();
    s.plan.nights = 9;
    s.plan.stops = ['OSL', 'SVG', 'BGO', 'GEI'];
    s.plan.end = 'CPH';
    const r = sail(s);
    expect(r && !r.grandTour).toBe(true);
    expect(s.unlocked.fleet).toBeFalsy();
  });
});

describe('Chapter 4 milestones', () => {
  it('first fjord, carbon-neutral cruise and the Kiel shortcut', () => {
    const s = europeGame(3);
    s.mode = 'campaign';
    s.cash = 10_000_000;
    s.plan = { ...s.plan, nights: 9, stops: ['OSL', 'SVG', 'BGO', 'GEI'], end: 'CPH', offset: true };
    const r = sail(s)!;
    expect(r.milestones).toEqual(expect.arrayContaining(['firstFjord', 'carbonNeutral']));
    // The Kiel Canal needs a small ship.
    s.blueprints.push({ id: 'bpT', name: 'Tern', design: bp('MV Northern Tern') });
    runTrial(s, 'bpT');
    const c = commission(s, 'bpT', 'CPH');
    if (!('ship' in c)) throw new Error('commission failed');
    c.ship.day = july + 20;
    s.plan = { shipId: c.ship.id, nights: 7, wait: 0, stops: ['KEL', 'EDI'], end: 'SOU', fare: 300 };
    const p = draftPlan(s)!;
    expect(p.canals).toContain('kiel');
    expect(sail(s)!.milestones).toContain('kielShortcut');
  });
});
