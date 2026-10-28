import { describe, expect, it } from 'vitest';
import { REGIONS, HULLS } from '../src/sim/data';
import { planVoyage, portStatus, rivalsAt, piersFree, type PlanInput } from '../src/sim/planner';
import { stormsBetween, stormAt, realHit } from '../src/sim/storms';
import { rollEvents, planSeed } from '../src/sim/events';
import { checkCrossing } from '../src/sim/crossing';
import { analyse, fuelRange } from '../src/sim/ship';
import { graphOf, edgeBlock } from '../src/sim/route';
import { onLand } from '../src/sim/geo';
import { dayOf, weekdayOf } from '../src/sim/calendar';
import {
  newGame, report, runTrial, commission, graduate, crossingFor, graduationOpen, leaseIsland, canLeaseIsland,
  sail, checkMilestones, weekGuests, specsOf, type GameState,
} from '../src/sim/game';
import { fixHarborLight } from './helpers';

const CA = REGIONS.caribbean;
const NE = REGIONS.northeast;

/** A campaign that has built Harbor Light and earned Fleet capital, with both ships in New York. */
function readyToGraduate(): GameState {
  const s = newGame();
  s.tutorial.off = true;
  fixHarborLight(s);
  runTrial(s, 'bp2');
  s.cash = 2_000_000;
  const r = commission(s, 'bp2', 'NYC');
  if (!('ship' in r)) throw new Error('commission failed');
  s.milestones.push('maiden', 'capital');
  return s;
}

const templateSpecs = (name: string) => {
  const s = newGame('sandbox');
  return report(s, s.blueprints.find(b => b.name === name)!.design).specs;
};
const liner = templateSpecs('MS Northern Crown');
const mega = templateSpecs('MS Harbor Majesty');
const base = (o: Partial<PlanInput> = {}): PlanInput => ({ region: CA, ship: liner, start: 'MIA', stops: ['NAS', 'CZM'], end: 'MIA', nights: 5, departDay: dayOf(2028, 1, 15), openGroups: [], ...o });

describe('Caribbean data', () => {
  it('has 19 ports plus a private island and closed Havana', () => {
    const ports = Object.values(CA.ports);
    expect(ports.filter(p => !p.privateIsland && !p.closed).length).toBe(19);
    expect(CA.ports.HAV.closed).toBe(true);
    expect(CA.ports.GCM.berth).toBe('tender');
  });
  it('has eight rival ships', () => { expect(CA.rivals.length).toBe(8); });
  it('the Mega template passes inspection and matches the doc', () => {
    expect(HULLS.mega).toMatchObject({ cols: 32, rows: 10, length: 315, beam: 41, draft: 8.6, airDraft: 64 });
    expect(HULLS.mega.decks.length).toBe(9);
    const s = newGame('sandbox');
    const r = analyse(s.blueprints.find(b => b.name === 'MS Harbor Majesty')!.design);
    expect(r.errors).toBe(0);
    expect(r.pax).toBeGreaterThanOrEqual(2000);
  });
});

describe('Caribbean rules', () => {
  it('a Miami round trip needs a foreign port; San Juan counts as US', () => {
    expect(planVoyage(base({ stops: ['EYW'], nights: 3 })).issues.map(i => i.key)).toContain('plan.pvsaForeign');
    expect(planVoyage(base({ start: 'SJU', end: 'SJU', stops: ['STT'], nights: 3 })).issues.map(i => i.key)).toContain('plan.pvsaForeign');
  });
  it('Havana is closed', () => {
    expect(portStatus(CA, 'HAV', liner, []).ok).toBe(false);
  });
  it('Colón’s old locks turn the Mega away by beam, and Key West by length', () => {
    expect(portStatus(CA, 'COL', liner, []).ok).toBe(true);
    const w = portStatus(CA, 'COL', mega, []);
    expect(w.ok).toBe(false);
    expect(portStatus(CA, 'EYW', mega, []).ok).toBe(false);
  });
  it('a Colón call charges the partial canal toll', () => {
    const p = planVoyage(base({ start: 'MIA', stops: ['CTG', 'COL'], nights: 7 }));
    expect(p.canals).toContain('panama');
    expect(p.tolls).toBeGreaterThanOrEqual(CA.ports.COL.canalCall!);
  });
  it('air conditioning raises hotel fuel use', () => {
    const p = planVoyage(base());
    const cool = planVoyage(base({ region: { ...CA, hotelMult: 1 } }));
    expect(p.burned).toBeGreaterThan(cool.burned);
  });
  it('rivals fill piers by weekday, and departure day changes the outcome', () => {
    // Find a weekday when Ocho Rios (2 piers) is full, then show a free day.
    const fullDay = [0, 1, 2, 3, 4, 5, 6].find(d => piersFree(CA, 'OCJ', d) <= 0);
    expect(fullDay).toBeDefined();
    expect(rivalsAt(CA, 'OCJ', fullDay!).length).toBeGreaterThan(0);
    let blocked = 0, clear = 0;
    for (let w = 0; w < 7; w++) {
      const p = planVoyage(base({ stops: ['GCM', 'OCJ'], nights: 5, departDay: dayOf(2028, 1, 15) + w }));
      const keys = p.issues.map(i => i.key);
      if (keys.some(k => k.startsWith('plan.piersFull'))) blocked++; else clear++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(0);
  });
  it('crowds cost appeal', () => {
    const czmDay = [0, 1, 2, 3, 4, 5, 6].find(d => rivalsAt(CA, 'CZM', d).length >= 2)!;
    let crowded: number | null = null, quiet: number | null = null;
    for (let w = 0; w < 7; w++) {
      const p = planVoyage(base({ stops: ['CZM'], end: 'MIA', nights: 4, departDay: dayOf(2028, 1, 15) + w, start: 'MIA' }));
      const c = p.calls[0];
      if (!c) continue;
      if (c.weekday === czmDay) crowded = p.score; else if (!c.rivals.length) quiet = p.score;
    }
    if (crowded != null && quiet != null) expect(crowded).toBeLessThan(quiet);
    expect(weekdayOf(0)).toBe(6); // the campaign starts on a Saturday
  });
});

describe('hurricanes', () => {
  const year = 2028;
  const storms = stormsBetween(CA, dayOf(year, 8, 1), dayOf(year, 10, 31));
  it('hurricane season brings storms; winter does not', () => {
    expect(storms.length).toBeGreaterThan(3);
    expect(stormsBetween(CA, dayOf(year, 1, 1), dayOf(year, 3, 1)).length).toBe(0);
  });
  it('storms are named, move west, and drift from the forecast', () => {
    const s = storms[0];
    expect(s.name).toBeTruthy();
    const a = stormAt(s, s.t0, true)!, b = stormAt(s, s.t0 + 4, true)!;
    expect(b[0]).toBeLessThan(a[0]);
    const f = stormAt(s, s.t0 + 6, false)!, r = stormAt(s, s.t0 + 6, true)!;
    expect(Math.hypot(f[0] - r[0], f[1] - r[1])).toBeGreaterThan(0);
  });
  it('a port in the real path closes, and the same plan rolls the same storm', () => {
    // Search the season for a cruise that a storm actually hits.
    let found = false;
    for (let d = dayOf(year, 8, 1); d < dayOf(year, 10, 25) && !found; d++) {
      const p = planVoyage(base({ start: 'BGI', end: 'BGI', stops: ['SLU', 'ANU', 'SXM'], nights: 6, departDay: d }));
      if (p.errors) continue;
      const ev = rollEvents(p, liner, 800, planSeed(p, 's1'));
      if (ev.some(e => e.id === 'stormClosed')) {
        found = true;
        expect(rollEvents(p, liner, 800, planSeed(p, 's1'))).toEqual(ev);
        const closed = ev.find(e => e.id === 'stormClosed')!;
        expect(closed.cancelsCall).toBeTruthy();
        const port = CA.ports[closed.cancelsCall!];
        expect(realHit(CA, [port.lon, port.lat], d + p.calls.find(c => c.id === closed.cancelsCall)!.arr / 24)).toBeTruthy();
      }
    }
    expect(found).toBe(true);
  });
  it('the planner warns when a stop sits in the forecast cone', () => {
    let warned = false;
    for (let d = dayOf(year, 8, 1); d < dayOf(year, 10, 25) && !warned; d++) {
      const p = planVoyage(base({ start: 'BGI', end: 'BGI', stops: ['SLU', 'ANU'], nights: 5, departDay: d }));
      if (p.issues.some(i => i.key === 'plan.storm')) warned = true;
    }
    expect(warned).toBe(true);
  });
});

describe('graduation: south to Miami', () => {
  it('opens only after Fleet capital', () => {
    const s = newGame();
    expect(graduationOpen(s)).toBe(false);
    s.milestones.push('capital');
    expect(graduationOpen(s)).toBe(true);
  });
  it('Harbor Light can make it from New York but not from Boston', () => {
    const s = readyToGraduate();
    const hl = s.ships[1];
    expect(crossingFor(s, hl).ok).toBe(true);
    hl.port = 'BOS';
    const c = crossingFor(s, hl);
    expect(c.ok).toBe(false);
    expect(c.issues.map(i => i.key)).toContain('cross.reserve');
  });
  it('a top-heavy ship would roll too far off Hatteras', () => {
    const c = checkCrossing(NE.graduation!, 'NYC', { ...specsOf(newGame(), newGame().ships[0]), gm: 0.08 });
    expect(c.issues.map(i => i.key)).toContain('cross.unstable');
  });
  it('the chartered Puffin stays behind', () => {
    const s = readyToGraduate();
    s.ships[0].port = 'NYC';
    expect(crossingFor(s, s.ships[0]).issues[0].key).toBe('cross.chartered');
  });
  it('carries tech and blueprints over, resets cash and pulls reputation toward 3', () => {
    const s = readyToGraduate();
    s.rep = 4.6;
    s.tech.push('bilge');
    const bps = s.blueprints.length, cash = s.cash;
    const r = graduate(s, [s.ships[1].id]);
    expect('ships' in r).toBe(true);
    expect(s.region).toBe('caribbean');
    expect(s.ships.map(x => x.name)).toEqual(['MV Harbor Light']);
    expect(s.ships[0].port).toBe('MIA');
    expect(s.cash).toBe(Math.round(cash * 0.25) + 400_000);
    expect(s.rep).toBe(3.8);
    expect(s.tech).toContain('bilge');
    expect(s.blueprints.length).toBe(bps);
    expect(s.firsts).toContain('crossing');
  });
});

describe('Chapter 2 progression', () => {
  function inCaribbean(): GameState {
    const s = readyToGraduate();
    graduate(s, [s.ships[1].id]);
    return s;
  }
  it('Coral Cay costs $1.5M and adds island spending with no head tax', () => {
    const s = inCaribbean();
    s.cash = 2_000_000;
    expect(portStatus(CA, 'CORAL', specsOf(s, s.ships[0]), s.unlocked.portGroups).ok).toBe(false);
    expect(canLeaseIsland(s).ok).toBe(true);
    const r = leaseIsland(s);
    expect('milestones' in r && r.milestones).toContain('islandOwner');
    expect(s.cash).toBe(500_000);
    expect(portStatus(CA, 'CORAL', specsOf(s, s.ships[0]), s.unlocked.portGroups).ok).toBe(true);
  });
  it('a first Caribbean cruise completes First week in the sun', () => {
    const s = inCaribbean();
    // The coastal ship is the wrong tool out here: a short Bahamas run is all it can manage.
    Object.assign(s.plan, { stops: ['NAS', 'EYW'], end: 'MIA', nights: 4, fare: 150, wait: 0 });
    let r = sail(s);
    for (let w = 1; !r && w < 7; w++) { s.plan.wait = w; r = sail(s); }
    expect(r).toBeTruthy();
    expect(r!.milestones).toContain('sun');
  });
  it('Mega market counts full-booked guests across a week', () => {
    const s = inCaribbean();
    const day = s.ships[0].day;
    s.log.push({ n: 90, day, region: 'caribbean', shipId: 'a', ship: 'A', route: [], nights: 5, booked: 900, pax: 900, fare: 1, profit: 1, sat: 70, events: [] });
    s.log.push({ n: 91, day: day + 3, region: 'caribbean', shipId: 'b', ship: 'B', route: [], nights: 5, booked: 650, pax: 680, fare: 1, profit: 1, sat: 70, events: [] });
    s.log.push({ n: 92, day: day + 3, region: 'caribbean', shipId: 'c', ship: 'C', route: [], nights: 5, booked: 400, pax: 900, fare: 1, profit: 1, sat: 70, events: [] });
    expect(weekGuests(s, day + 3)).toBe(1550);
    expect(checkMilestones(s, { profit: 1, visited: [], day: day + 3 })).toContain('megaMarket');
    expect(s.unlocked.hulls).toContain('mega');
    expect(s.blueprints.some(b => b.design.hull === 'mega')).toBe(true);
  });
});

describe('fuel range and the Panama Canal', () => {
  it('the readout uses the planner’s fuel model: full speed and air conditioning cost range', () => {
    const slow = fuelRange(liner, 16), fast = fuelRange(liner, liner.vmax), hot = fuelRange(liner, liner.vmax, 1.35);
    expect(fast.days).toBeLessThan(slow.days * 0.7);
    expect(hot.days).toBeLessThan(fast.days);
  });
  it('Colón and Cartagena sell fuel, so Miami > Colón > Cartagena > Barbados works for a Liner', () => {
    const p = planVoyage(base({ stops: ['COL', 'CTG'], end: 'BGI', nights: 7 }));
    expect(p.issues.filter(i => i.lvl === 'err').map(i => i.key)).toEqual([]);
    expect(p.calls.every(c => c.refuel)).toBe(true);
  });
  it('the canal is drawn as a lane from Colón to the Pacific, and the Gulf of Panama is water', () => {
    const e = graphOf(CA).edges.find(x => x.canal === 'panama')!;
    expect([e.a, e.b]).toContain('COL');
    expect(onLand(CA, CA.nodes.PAC)).toBe(false);
    // The Bridge of the Americas leaves 61.3 m: the Mega (64 m air draft) can't pass.
    expect(edgeBlock(e, { draft: 8.6, air: 64, beam: 41 })).toBe('air');
  });
});
