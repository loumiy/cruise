// Headless balance check. Sails a set of reference cruises and flags big changes against
// tests/reference-cruises.json. Run `npm run balance`; set UPDATE_BALANCE=1 to accept new numbers.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  newGame, draftPlan, planFinance, sail, runTrial, commission, specsOf, companyDay, seasonOver, layUp, market, regionOf,
  graduate, crossingFor, canCommission, leaseIsland, canLeaseIsland, moveRegion, bidPermit, canBidPermit, rivalBid, type GameState,
} from '../src/sim/game';
import { dayOf } from '../src/sim/calendar';
import { bestFare, summarise } from '../src/sim/economy';
import { fixHarborLight } from './helpers';

const REF_FILE = path.join(__dirname, 'reference-cruises.json');
const TOLERANCE = 0.15;

interface Ref { ship: 'puffin' | 'harbor' | 'crown' | 'majesty' | 'tern'; start: string; stops: string[]; end: string; nights: number; wait?: number; region?: string }
const REFERENCE: Record<string, Ref> = {
  'puffin · Bar Harbor + Halifax · 4n': { ship: 'puffin', start: 'BOS', stops: ['BHB', 'HFX'], end: 'BOS', nights: 4 },
  'puffin · Portland + Saint John · 4n': { ship: 'puffin', start: 'BOS', stops: ['PWM', 'SJB'], end: 'BOS', nights: 4 },
  'harbor · Bar Harbor + Halifax · 4n': { ship: 'harbor', start: 'BOS', stops: ['BHB', 'HFX'], end: 'BOS', nights: 4 },
  'harbor · Maritimes to Québec · 7n': { ship: 'harbor', start: 'BOS', stops: ['BHB', 'HFX', 'CHA'], end: 'YQB', nights: 7 },
  'harbor · Québec to Boston · 7n': { ship: 'harbor', start: 'YQB', stops: ['GPE', 'HFX', 'BHB'], end: 'BOS', nights: 7 },
  'harbor · New York + Newport + Halifax · 5n': { ship: 'harbor', start: 'NYC', stops: ['NPT', 'BHB'], end: 'HFX', nights: 5 },
  'harbor · fall foliage · 5n': { ship: 'harbor', start: 'BOS', stops: ['PWM', 'BHB', 'SJB'], end: 'HFX', nights: 5, wait: 100 },
  'liner · Bahamas + Coral Cay · 3n': { ship: 'crown', region: 'caribbean', start: 'MIA', stops: ['NAS', 'CORAL'], end: 'MIA', nights: 3, wait: 228 },
  'liner · Eastern Caribbean from Barbados · 6n': { ship: 'crown', region: 'caribbean', start: 'BGI', stops: ['SLU', 'ANU', 'SXM'], end: 'BGI', nights: 6, wait: 228 },
  'mega · Western Caribbean · 7n': { ship: 'majesty', region: 'caribbean', start: 'MIA', stops: ['CZM', 'GCM', 'OCJ'], end: 'MIA', nights: 7, wait: 228 },
  'mega · Eastern Caribbean from San Juan · 7n': { ship: 'majesty', region: 'caribbean', start: 'SJU', stops: ['STT', 'SXM', 'ANU', 'SLU', 'BGI'], end: 'SJU', nights: 7, wait: 228 },
  'expedition · Misty Fjords to Seward · 7n': { ship: 'tern', region: 'alaska', start: 'YVR', stops: ['MIS', 'KTN', 'TRA', 'JNU'], end: 'SWD', nights: 7, wait: 763 },
  'expedition · Inside Passage and Sitka · 7n': { ship: 'tern', region: 'alaska', start: 'YVR', stops: ['KTN', 'WRG', 'TRA', 'SIT'], end: 'SWD', nights: 7, wait: 763 },
  'liner · Glacier Bay round trip · 7n': { ship: 'crown', region: 'alaska', start: 'YVR', stops: ['KTN', 'GLB', 'JNU'], end: 'YVR', nights: 7, wait: 763 },
  'mega · Alaska round trip · 7n': { ship: 'majesty', region: 'alaska', start: 'YVR', stops: ['KTN', 'GLB', 'JNU'], end: 'YVR', nights: 7, wait: 763 },
};

const TEMPLATE = { crown: 'MS Northern Crown', majesty: 'MS Harbor Majesty', tern: 'MV Northern Tern' };

function setup(ref: Ref): GameState {
  if (ref.ship === 'crown' || ref.ship === 'majesty' || ref.ship === 'tern') {
    const s = newGame('sandbox');
    moveRegion(s, ref.region!);
    s.unlocked.portGroups.push('island', 'permit');
    const bp = s.blueprints.find(b => b.name === TEMPLATE[ref.ship as 'crown'])!;
    runTrial(s, bp.id);
    const r = commission(s, bp.id, ref.start);
    if (!('ship' in r)) throw new Error('commission failed');
    s.plan.shipId = r.ship.id;
    r.ship.day = ref.wait ?? 0;
    Object.assign(s.plan, { stops: ref.stops, end: ref.end, nights: ref.nights, wait: 0 });
    return s;
  }
  const s = newGame();
  s.tutorial.off = true;
  if (ref.ship === 'harbor') {
    fixHarborLight(s);
    runTrial(s, 'bp2');
    s.cash = 1e7;
    const r = commission(s, 'bp2', ref.start);
    if (!('ship' in r)) throw new Error('commission failed');
    s.plan.shipId = r.ship.id;
    r.ship.day = ref.wait ?? 0;
  } else {
    s.ships[0].port = ref.start;
    s.ships[0].day = ref.wait ?? 0;
  }
  Object.assign(s.plan, { stops: ref.stops, end: ref.end, nights: ref.nights, wait: 0 });
  return s;
}

function measure(ref: Ref) {
  const s = setup(ref);
  const plan = draftPlan(s)!;
  const best = bestFare(regionOf(s), plan.input.ship, summarise(plan), market(s));
  s.plan.fare = best.fare;
  const fin = planFinance(s, plan);
  return { errors: plan.issues.filter(i => i.lvl === 'err').map(i => i.key), appeal: plan.score, fare: best.fare, booked: fin.booked, fuel: Math.round(plan.burned), profit: Math.round(fin.profit) };
}

describe('reference cruises', () => {
  const results = Object.fromEntries(Object.entries(REFERENCE).map(([k, r]) => [k, measure(r)]));
  if (process.env.UPDATE_BALANCE) fs.writeFileSync(REF_FILE, JSON.stringify(results, null, 2) + '\n');
  const saved: Record<string, ReturnType<typeof measure>> = fs.existsSync(REF_FILE) ? JSON.parse(fs.readFileSync(REF_FILE, 'utf8')) : results;
  console.table(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ...v, errors: v.errors.length }])));
  for (const [name, r] of Object.entries(results)) {
    it(name + ' is sailable and close to its reference', () => {
      expect(r.errors).toEqual([]);
      expect(r.profit).toBeGreaterThan(0);
      const ref = saved[name];
      expect(ref, 'missing reference: run with UPDATE_BALANCE=1').toBeTruthy();
      for (const k of ['profit', 'booked', 'fuel'] as const) {
        const tol = Math.max(Math.abs(ref[k]) * TOLERANCE, k === 'fuel' ? 2 : 5);
        expect(Math.abs(r[k] - ref[k]), k + ' moved from ' + ref[k] + ' to ' + r[k]).toBeLessThanOrEqual(tol);
      }
    });
  }
  it('a bigger ship earns more per cruise', () => {
    expect(results['harbor · Bar Harbor + Halifax · 4n'].profit).toBeGreaterThan(results['puffin · Bar Harbor + Halifax · 4n'].profit * 1.5);
    expect(results['mega · Eastern Caribbean from San Juan · 7n'].profit).toBeGreaterThan(results['liner · Eastern Caribbean from Barbados · 6n'].profit);
  });
  it('in Alaska small and nimble beats big: the Mega is the wrong tool', () => {
    expect(results['mega · Alaska round trip · 7n'].profit).toBeLessThan(results['liner · Glacier Bay round trip · 7n'].profit);
    expect(results['mega · Alaska round trip · 7n'].profit).toBeLessThan(results['expedition · Misty Fjords to Seward · 7n'].profit);
  });
});

/** A simple player: picks the best legal cruise from a route list for whichever ship is free first. */
const ROUTES: [string[], string, number][] = [
  [['BHB', 'HFX'], 'BOS', 4], [['PWM', 'BHB', 'SJB'], 'BOS', 5], [['BHB', 'HFX', 'SYD'], 'BOS', 6],
  [['HFX', 'CHA', 'GPE'], 'YQB', 6], [['GPE', 'CHA', 'HFX'], 'BOS', 6], [['BHB', 'HFX'], 'YQB', 7],
  [['NPT', 'BHB', 'HFX'], 'BOS', 5], [['HFX'], 'BOS', 3], [['SJB', 'HFX'], 'HFX', 4], [['BHB', 'SJB'], 'HFX', 3],
  [['CHA', 'GPE'], 'YQB', 4], [['HFX', 'BHB'], 'NYC', 5], [['HFX', 'BHB'], 'BOS', 5], [['SYD', 'CHA', 'GPE'], 'YQB', 5],
  // Out of Québec City: it's far upriver, so these are the long ones.
  [['CHA', 'HFX'], 'BOS', 6], [['GPE', 'CHA', 'HFX'], 'BOS', 7], [['GPE', 'HFX', 'BHB'], 'BOS', 7],
];

const CARIB_ROUTES: [string[], string, number][] = [
  [['NAS', 'CORAL'], 'MIA', 3], [['NAS', 'EYW'], 'MIA', 4], [['EYW', 'CZM'], 'MIA', 5], [['NAS', 'CORAL', 'EYW'], 'MIA', 5],
  [['CZM', 'GCM', 'OCJ'], 'MIA', 7], [['STT', 'SXM', 'ANU'], 'SJU', 5], [['STT', 'SXM', 'ANU', 'SLU', 'BGI'], 'SJU', 7],
  [['SLU', 'ANU', 'SXM'], 'BGI', 6], [['SXM', 'STT'], 'SJU', 4], [['AMB', 'NAS'], 'MIA', 5], [['CUR', 'AUA'], 'BGI', 6],
  [['SLU', 'ANU', 'STT'], 'SJU', 5], [['STT', 'SXM'], 'BGI', 5], [['AMB'], 'MIA', 4], [['NAS'], 'MIA', 3],
];

const ALASKA_ROUTES: [string[], string, number][] = [
  [['MIS', 'KTN', 'TRA', 'JNU'], 'SWD', 7], [['KTN', 'WRG', 'TRA', 'SIT'], 'SWD', 7], [['KTN', 'GLB', 'JNU'], 'YVR', 7],
  [['KTN', 'JNU', 'GLB', 'HUB'], 'SWD', 7], [['YYJ', 'KTN', 'JNU'], 'SEA', 7], [['KTN', 'JNU'], 'YVR', 7],
  [['HUB', 'GLB', 'JNU', 'KTN'], 'YVR', 7], [['HUB', 'SIT', 'TRA', 'KTN'], 'YVR', 7], [['HUB', 'JNU', 'MIS'], 'YVR', 7],
  [['YYJ'], 'SEA', 3], [['YYJ', 'KTN'], 'YVR', 6],
];

function playOneCruise(s: GameState): boolean {
  const ship = s.ships.slice().sort((a, b) => a.day - b.day)[0];
  if (seasonOver(s, ship)) { layUp(s, ship.id); return false; }
  let best: { stops: string[]; end: string; nights: number; fare: number; profit: number } | null = null;
  let bestWait = 0;
  for (const [stops, end, nights] of s.region === 'caribbean' ? CARIB_ROUTES : s.region === 'alaska' ? ALASKA_ROUTES : ROUTES) {
    if (stops.includes(ship.port)) continue;
    for (let wait = 0; wait < (s.region === 'caribbean' ? 3 : 1); wait++) {
      Object.assign(s.plan, { shipId: ship.id, stops, end, nights, wait });
      const plan = draftPlan(s)!;
      if (plan.errors) continue;
      const bf = bestFare(regionOf(s), specsOf(s, ship), summarise(plan, wait), market(s));
      if (!best || bf.profit > best.profit) { best = { stops, end, nights, fare: bf.fare, profit: bf.profit }; bestWait = wait; }
    }
  }
  if (!best) { ship.day += 1; return false; }
  Object.assign(s.plan, { shipId: ship.id, stops: best.stops, end: best.end, nights: best.nights, fare: best.fare, wait: bestWait });
  return !!sail(s);
}

describe('phase 1 goal: build a ship, sail, unlock the liner', () => {
  it('a straightforward player unlocks the Liner in the first season', () => {
    const s = newGame();
    s.tutorial.off = true;
    // Tutorial: Puffin's first cruise, then fix and build Harbor Light.
    Object.assign(s.plan, { stops: ['BHB', 'HFX'], end: 'BOS', nights: 4, fare: 240 });
    expect(sail(s)).toBeTruthy();
    fixHarborLight(s);
    expect(runTrial(s, 'bp2').result?.capsize).toBe(false);
    expect('ship' in commission(s, 'bp2', 'BOS')).toBe(true);
    let cruises = 1, turns = 0;
    while (!s.unlocked.hulls.includes('liner') && cruises < 40 && turns++ < 400) if (playOneCruise(s)) cruises++;
    console.log('Liner unlocked after', cruises, 'cruises, on day', companyDay(s), 'with', s.dpEarned, 'DP, rep', s.rep);
    expect(s.unlocked.hulls).toContain('liner');
    expect(cruises).toBeGreaterThanOrEqual(5);
    expect(cruises).toBeLessThanOrEqual(14);
    expect(s.blueprints.some(b => b.design.hull === 'liner')).toBe(true);
  });
});

describe('chapter 2 goal: grow in the Caribbean and unlock the Mega', () => {
  it('after the crossing, a straightforward player builds Liners and unlocks the Mega', () => {
    const s = newGame();
    s.tutorial.off = true;
    Object.assign(s.plan, { stops: ['BHB', 'HFX'], end: 'BOS', nights: 4, fare: 240 });
    sail(s);
    fixHarborLight(s);
    runTrial(s, 'bp2');
    commission(s, 'bp2', 'NYC');
    let turns = 0;
    while (!s.milestones.includes('capital') && turns++ < 200) playOneCruise(s);
    const hl = s.ships.find(x => x.name === 'MV Harbor Light')!;
    hl.port = 'NYC';
    expect(crossingFor(s, hl).ok).toBe(true);
    const g = graduate(s, [hl.id]);
    expect('ships' in g).toBe(true);
    expect(s.region).toBe('caribbean');
    const startCash = s.cash, startDay = companyDay(s);
    const crown = s.blueprints.find(b => b.name === 'MS Northern Crown')!;
    runTrial(s, crown.id);
    let cruises = 0, worst = Infinity;
    turns = 0;
    while (!s.unlocked.hulls.includes('mega') && turns++ < 600 && cruises < 80) {
      if (canCommission(s, crown).ok && s.ships.length < 4) commission(s, crown.id, 'MIA');
      if (canLeaseIsland(s).ok && s.cash > 4_000_000) leaseIsland(s);
      const before = s.cash;
      if (playOneCruise(s)) { cruises++; worst = Math.min(worst, s.cash - before); }
    }
    const years = (companyDay(s) - startDay) / 365;
    console.log('Mega unlocked after', cruises, 'Caribbean cruises,', years.toFixed(1), 'years, fleet', s.ships.length, 'cash', Math.round(s.cash / 1000) + 'k from', Math.round(startCash / 1000) + 'k, worst cruise', Math.round(worst / 1000) + 'k, milestones', s.milestones.join(','));
    expect(s.unlocked.hulls).toContain('mega');
    expect(cruises).toBeLessThanOrEqual(40);
    expect(s.milestones).toContain('sun');
  });
  it('the reference day is in winter high season', () => {
    expect(dayOf(2028, 1, 19)).toBe(228);
  });
});

describe('chapter 3 goal: a ship built for Alaska', () => {
  it('after the canal, a player who builds Expedition ships and bids for permits earns the Alaska milestones', () => {
    const s = newGame('sandbox');
    s.mode = 'campaign';
    s.tech = [];
    s.region = 'caribbean';
    s.cash = 3_000_000;
    s.milestones.push('capital', 'miami', 'megaMarket');
    const crown = s.blueprints.find(b => b.name === 'MS Northern Crown')!;
    runTrial(s, crown.id);
    const c = commission(s, crown.id, 'MIA');
    if (!('ship' in c)) throw new Error('commission failed');
    s.ships = [c.ship];
    c.ship.day = dayOf(2028, 3, 1);
    expect(crossingFor(s, c.ship).ok).toBe(true);
    const g = graduate(s, [c.ship.id]);
    expect('ships' in g).toBe(true);
    const tern = s.blueprints.find(b => b.name === 'MV Northern Tern')!;
    runTrial(s, tern.id);
    let cruises = 0, worst = Infinity, turns = 0, lost = 0;
    const start = companyDay(s), cash0 = s.cash;
    while (turns++ < 500 && cruises < 40 && companyDay(s) < start + 2 * 365) {
      if (canCommission(s, tern).ok && s.ships.length < 3 && s.cash > 1_500_000) commission(s, tern.id, 'YVR');
      const day = companyDay(s);
      if (canBidPermit(s, day).ok && s.cash > 800_000) {
        const r = bidPermit(s, day, rivalBid(s, day) + 10000);
        if ('won' in r && !r.won) lost++;
      }
      const before = s.cash;
      if (playOneCruise(s)) { cruises++; worst = Math.min(worst, s.cash - before); }
    }
    console.log('Alaska:', cruises, 'cruises in 2 seasons, fleet', s.ships.map(x => x.name).join(', '), 'cash', Math.round(cash0 / 1000) + 'k →', Math.round(s.cash / 1000) + 'k, worst', Math.round(worst / 1000) + 'k, fines', s.log.filter(v => v.region === 'alaska' && v.fine).length, 'milestones', s.milestones.filter(m => ['firstGlacier', 'permitHolder', 'cleanStack', 'wildlifeWeek', 'northernLight'].includes(m)).join(','));
    expect(s.cash).toBeGreaterThan(cash0);
    expect(s.milestones).toContain('firstGlacier');
    expect(s.milestones).toContain('permitHolder');
    expect(s.milestones).toContain('cleanStack');
    expect(lost).toBeLessThanOrEqual(2); // a second slot costs more than the first, so a flat bid can lose once a season
  });
});
