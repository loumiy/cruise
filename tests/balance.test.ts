// Headless balance check. Sails a set of reference cruises and flags big changes against
// tests/reference-cruises.json. Run `npm run balance`; set UPDATE_BALANCE=1 to accept new numbers.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  newGame, draftPlan, planFinance, sail, runTrial, commission, specsOf, companyDay, seasonOver, layUp, market, regionOf,
  type GameState,
} from '../src/sim/game';
import { bestFare, summarise } from '../src/sim/economy';
import { fixHarborLight } from './helpers';

const REF_FILE = path.join(__dirname, 'reference-cruises.json');
const TOLERANCE = 0.15;

interface Ref { ship: 'puffin' | 'harbor'; start: string; stops: string[]; end: string; nights: number; wait?: number }
const REFERENCE: Record<string, Ref> = {
  'puffin · Bar Harbor + Halifax · 4n': { ship: 'puffin', start: 'BOS', stops: ['BHB', 'HFX'], end: 'BOS', nights: 4 },
  'puffin · Portland + Saint John · 4n': { ship: 'puffin', start: 'BOS', stops: ['PWM', 'SJB'], end: 'BOS', nights: 4 },
  'harbor · Bar Harbor + Halifax · 4n': { ship: 'harbor', start: 'BOS', stops: ['BHB', 'HFX'], end: 'BOS', nights: 4 },
  'harbor · Maritimes to Québec · 7n': { ship: 'harbor', start: 'BOS', stops: ['BHB', 'HFX', 'CHA'], end: 'YQB', nights: 7 },
  'harbor · Québec to Boston · 7n': { ship: 'harbor', start: 'YQB', stops: ['GPE', 'HFX', 'BHB'], end: 'BOS', nights: 7 },
  'harbor · New York + Newport + Halifax · 5n': { ship: 'harbor', start: 'NYC', stops: ['NPT', 'BHB'], end: 'HFX', nights: 5 },
  'harbor · fall foliage · 5n': { ship: 'harbor', start: 'BOS', stops: ['PWM', 'BHB', 'SJB'], end: 'HFX', nights: 5, wait: 100 },
};

function setup(ref: Ref): GameState {
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

function playOneCruise(s: GameState): boolean {
  const ship = s.ships.slice().sort((a, b) => a.day - b.day)[0];
  if (seasonOver(s, ship)) { layUp(s, ship.id); return false; }
  let best: { stops: string[]; end: string; nights: number; fare: number; profit: number } | null = null;
  for (const [stops, end, nights] of ROUTES) {
    if (stops.includes(ship.port)) continue;
    Object.assign(s.plan, { shipId: ship.id, stops, end, nights, wait: 0 });
    const plan = draftPlan(s)!;
    if (plan.errors) continue;
    const bf = bestFare(regionOf(s), specsOf(s, ship), summarise(plan), market(s));
    if (!best || bf.profit > best.profit) best = { stops, end, nights, fare: bf.fare, profit: bf.profit };
  }
  if (!best) { ship.day += 1; return false; }
  Object.assign(s.plan, { shipId: ship.id, stops: best.stops, end: best.end, nights: best.nights, fare: best.fare, wait: 0 });
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
