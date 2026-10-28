import { describe, expect, it } from 'vitest';
import { REGIONS, HULLS } from '../src/sim/data';
import { planVoyage, portStatus, tideWait, SCENIC_STAY, type PlanInput } from '../src/sim/planner';
import { route } from '../src/sim/route';
import { rollEvents, planSeed } from '../src/sim/events';
import { analyse } from '../src/sim/ship';
import { summarise, finance } from '../src/sim/economy';
import { dayOf } from '../src/sim/calendar';
import {
  newGame, report, runTrial, commission, graduate, crossingFor, moveRegion, bidPermit, rivalBid, canBidPermit,
  draftPlan, sail, cleanSeason, specsOf, type GameState,
} from '../src/sim/game';

const AK = REGIONS.alaska;
const tpl = (name: string) => { const s = newGame('sandbox'); return report(s, s.blueprints.find(b => b.name === name)!.design).specs; };
const tern = tpl('MV Northern Tern'), liner = tpl('MS Northern Crown'), mega = tpl('MS Harbor Majesty');
const july = dayOf(2029, 7, 7);
const base = (o: Partial<PlanInput> = {}): PlanInput => ({ region: AK, ship: tern, start: 'YVR', stops: ['KTN', 'JNU'], end: 'YVR', nights: 7, departDay: july, openGroups: [], lowSulfur: true, ...o });
const keys = (i: PlanInput) => planVoyage(i).issues.map(x => x.key);

describe('Alaska data', () => {
  it('has the doc’s ports and home ports', () => {
    for (const id of ['SEA', 'YVR', 'YYJ', 'KTN', 'JNU', 'SGY', 'SIT', 'GLB', 'HUB', 'SWD']) expect(AK.ports[id]).toBeTruthy();
    expect(Object.keys(AK.ports).filter(k => AK.ports[k].turnaround).sort()).toEqual(['SEA', 'SWD', 'YVR']);
  });
  it('the Expedition hull and template match the doc', () => {
    expect(HULLS.expedition).toMatchObject({ cols: 18, rows: 6, length: 140, beam: 22, draft: 5.5, airDraft: 32, ice: true });
    const s = newGame('sandbox');
    const r = analyse(s.blueprints.find(b => b.name === 'MV Northern Tern')!.design);
    expect(r.errors).toBe(0);
    expect(r.pax).toBeGreaterThanOrEqual(150);
    expect(r.pax).toBeLessThanOrEqual(300);
    expect(r.specs.ice && r.specs.zodiacSeats > 0).toBe(true);
  });
});

describe('Alaska rules', () => {
  it('PVSA: Seattle to Seward is illegal, Vancouver to Seward is the classic one-way', () => {
    expect(keys(base({ start: 'SEA', end: 'SWD', stops: ['JNU', 'HUB'] }))).toContain('plan.pvsaOneWay');
    expect(keys(base({ start: 'YVR', end: 'SWD', stops: ['KTN', 'JNU', 'HUB'] }))).not.toContain('plan.pvsaOneWay');
    expect(keys(base({ start: 'SEA', end: 'SEA', stops: ['KTN', 'JNU'] }))).toContain('plan.pvsaForeign');
    expect(keys(base({ start: 'SEA', end: 'SEA', stops: ['KTN', 'JNU', 'YYJ'] }))).not.toContain('plan.pvsaForeign');
  });
  it('the season runs May to September', () => {
    expect(keys(base({ departDay: dayOf(2029, 4, 20) }))).toContain('plan.offSeason');
    expect(keys(base({ departDay: dayOf(2029, 9, 27) }))).toContain('plan.seasonEnds');
  });
  it('Glacier Bay needs a permit; Tracy Arm turns away long ships', () => {
    expect(portStatus(AK, 'GLB', tern, []).ok).toBe(false);
    expect(portStatus(AK, 'GLB', tern, ['permit']).ok).toBe(true);
    expect(portStatus(AK, 'TRA', mega, []).ok).toBe(false);
    expect(portStatus(AK, 'TRA', tern, []).ok).toBe(true);
  });
  it('scenic stops are short daytime visits with no port fees', () => {
    const p = planVoyage(base({ stops: ['KTN', 'TRA', 'JNU'], openGroups: [] }));
    const c = p.calls.find(x => x.id === 'TRA')!;
    expect(c.scenic).toBe(true);
    expect(c.dep - c.arr).toBe(SCENIC_STAY);
    expect(c.arr % 24).toBeGreaterThanOrEqual(6);
    expect(c.arr % 24).toBeLessThanOrEqual(16);
  });
  it('zodiac landings need zodiacs', () => {
    expect(keys(base({ ship: liner, stops: ['MIS', 'KTN'] }))).toContain('plan.noZodiacs');
    expect(keys(base({ stops: ['MIS', 'KTN'] }))).not.toContain('plan.noZodiacs');
  });
  it('without an ice belt a ship gets less from Hubbard Glacier', () => {
    const iced = planVoyage(base({ start: 'YVR', end: 'SWD', stops: ['JNU', 'HUB'], ship: { ...liner, ice: true } }));
    const plain = planVoyage(base({ start: 'YVR', end: 'SWD', stops: ['JNU', 'HUB'], ship: liner }));
    expect(plain.issues.map(i => i.key)).toContain('plan.noIce');
    expect(plain.score).toBeLessThan(iced.score);
  });
});

describe('Seymour Narrows', () => {
  it('slack water comes every half tide, in a short window', () => {
    const g = { period: 12.42, window: 1.5, phase: 2 };
    expect(tideWait(g, 2)).toBe(0);
    expect(tideWait(g, 2.5)).toBe(0);
    expect(tideWait(g, 5)).toBeCloseTo(12.42 - 0.75 - 3, 5);
  });
  it('the inside route runs the narrows; the outside route avoids them but is longer', () => {
    const size = { draft: 5.5, air: 32, beam: 22 };
    const inside = route(AK, 'YVR', 'KTN', size)!, outside = route(AK, 'YVR', 'KTN', size, { avoidTide: true })!;
    expect(inside.tides.length).toBe(1);
    expect(outside.tides.length).toBe(0);
    expect(outside.nm).toBeGreaterThan(inside.nm);
  });
  it('departure day changes the tide, so some days wait for slack water', () => {
    const waits = [0, 1, 2, 3, 4, 5, 6].map(d => planVoyage(base({ departDay: july + d })).legs[0].tideWait);
    expect(new Set(waits.map(w => w.toFixed(1))).size).toBeGreaterThan(1);
  });
});

describe('emissions', () => {
  it('ordinary fuel is cheaper but risks a fine; low-sulfur costs more; a scrubber avoids both', () => {
    const low = planVoyage(base()), std = planVoyage(base({ lowSulfur: false })), scr = planVoyage(base({ ship: { ...tern, scrubber: true } }));
    expect(low.fuelMode).toBe('lowSulfur');
    expect(std.fuelMode).toBe('standard');
    expect(scr.fuelMode).toBe('scrubber');
    expect(std.issues.map(i => i.key)).toContain('plan.ecaRisk');
    const mk = { rep: 3, demandBonus: 0 };
    expect(finance(AK, tern, summarise(low), 250, mk).fuel).toBeGreaterThan(finance(AK, tern, summarise(std), 250, mk).fuel);
    let fined = 0;
    for (let d = 0; d < 20; d++) {
      const p = planVoyage(base({ lowSulfur: false, departDay: july + d }));
      if (rollEvents(p, tern, 200, planSeed(p, 's1')).some(e => e.id === 'ecaFine')) fined++;
      const q = planVoyage(base({ departDay: july + d }));
      expect(rollEvents(q, tern, 200, planSeed(q, 's1')).some(e => e.id === 'ecaFine')).toBe(false);
    }
    expect(fined).toBeGreaterThan(0);
  });
});

function alaskaGame(): GameState {
  const s = newGame('campaign');
  s.tutorial.off = true;
  s.region = 'alaska';
  s.unlocked.hulls.push('expedition', 'liner');
  s.unlocked.drydock = true;
  s.cash = 5_000_000;
  const s2 = newGame('sandbox');
  const bp = s2.blueprints.find(b => b.name === 'MV Northern Tern')!;
  s.blueprints.push({ ...bp, id: 'bpT' });
  runTrial(s, 'bpT');
  const r = commission(s, 'bpT', 'YVR');
  if (!('ship' in r)) throw new Error('commission failed');
  r.ship.day = july;
  s.ships = [r.ship];
  s.plan = { shipId: r.ship.id, nights: 7, wait: 0, stops: [], end: 'YVR', fare: 260, lowSulfur: true };
  return s;
}

describe('Glacier Bay permits', () => {
  it('a sealed bid wins at or above the seeded rival bid, and you pay only if you win', () => {
    const a = alaskaGame(), b = alaskaGame();
    const rival = rivalBid(a, july);
    const cash = a.cash;
    const lost = bidPermit(a, july, rival - 5000);
    expect('won' in lost && lost.won).toBe(false);
    expect(a.cash).toBe(cash);
    expect(canBidPermit(a, july).ok).toBe(false);
    const won = bidPermit(b, july, rival);
    expect('won' in won && won.won).toBe(true);
    expect(b.cash).toBe(cash - rival + 100_000); // the Permit holder milestone pays out
    expect('won' in won && won.milestones).toContain('permitHolder');
  });
  it('a permit opens Glacier Bay for one call a week', () => {
    const s = alaskaGame();
    s.plan.stops = ['KTN', 'GLB', 'JNU'];
    expect(draftPlan(s)!.issues.map(i => i.key)).toContain('plan.port.locked.permit');
    bidPermit(s, july, 400000);
    expect(draftPlan(s)!.issues.filter(i => i.lvl === 'err').map(i => i.key + JSON.stringify(i.vars))).toEqual([]);
    const r = sail(s)!;
    expect(r).toBeTruthy();
    expect(r.milestones).toContain('firstGlacier');
    // A second ship the same week finds the permit used.
    s.ships[0].day = july + 1; s.ships[0].port = 'YVR';
    s.log[s.log.length - 1].day = july + 1;
    expect(draftPlan(s)!.issues.map(i => i.key)).toContain('plan.permitUsed');
  });
});

describe('Chapter 2 graduation: through the Panama Canal', () => {
  function caribbeanReady(): GameState {
    const s = newGame('sandbox');
    s.mode = 'campaign';
    moveRegion({ ...s, mode: 'sandbox' } as GameState, 'caribbean');
    s.region = 'caribbean';
    s.milestones.push('megaMarket');
    for (const name of ['MS Northern Crown', 'MS Harbor Majesty']) {
      const bp = s.blueprints.find(b => b.name === name)!;
      runTrial(s, bp.id);
      const r = commission(s, bp.id, 'MIA');
      if ('ship' in r) r.ship.day = dayOf(2028, 11, 1);
    }
    s.ships = s.ships.filter(x => x.port === 'MIA');
    return s;
  }
  it('the Mega is too tall for the Bridge of the Americas; the Liner fits', () => {
    const s = caribbeanReady();
    const crown = s.ships.find(x => x.name.includes('Crown'))!, maj = s.ships.find(x => x.name.includes('Majesty'))!;
    expect(crossingFor(s, crown).ok).toBe(true);
    expect(crossingFor(s, maj).issues.map(i => i.key)).toContain('cross.tooTall');
  });
  it('arriving in winter, the ship waits for the May season; the Expedition hull unlocks', () => {
    const s = caribbeanReady();
    const crown = s.ships.find(x => x.name.includes('Crown'))!;
    const r = graduate(s, [crown.id]);
    expect('ships' in r).toBe(true);
    expect(s.region).toBe('alaska');
    expect(s.ships[0].port).toBe('SEA');
    expect(new Date(Date.UTC(2027, 5, 5) + s.ships[0].day * 86400000).getUTCMonth() + 1).toBe(5);
    expect(s.unlocked.hulls).toContain('expedition');
    expect(s.blueprints.some(b => b.name === 'MV Northern Tern')).toBe(true);
  });
});

describe('Chapter 3 milestones', () => {
  it('Clean stack needs six cruises in a season with no fines', () => {
    const s = alaskaGame();
    const add = (day: number, fine: boolean) => s.log.push({ n: s.log.length + 1, day, region: 'alaska', shipId: 'x', ship: 'X', route: [], nights: 7, booked: 1, pax: 1, fare: 1, profit: 1, sat: 70, events: [], fine });
    for (let i = 0; i < 5; i++) add(july + i * 7, false);
    expect(cleanSeason(s, 6)).toBe(false);
    add(july + 40, true);
    expect(cleanSeason(s, 6)).toBe(false);
    for (let i = 0; i < 6; i++) add(dayOf(2030, 6, 1) + i * 7, false);
    expect(cleanSeason(s, 6)).toBe(true);
    void specsOf;
  });
});
