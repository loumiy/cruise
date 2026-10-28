import { describe, expect, it } from 'vitest';
import { planVoyage, portStatus, type PlanInput } from '../src/sim/planner';
import { route } from '../src/sim/route';
import { newGame, specsOf, draftPlan, sail, planFinance, bpById, report } from '../src/sim/game';
import { rollEvents, planSeed } from '../src/sim/events';
import { bestFare, summarise } from '../src/sim/economy';
import { dayOf } from '../src/sim/calendar';
import { NE } from './helpers';

const s0 = newGame();
const puffin = specsOf(s0, s0.ships[0]);
const linerSpecs = (() => {
  const s = newGame('sandbox');
  const bp = s.blueprints.find(b => b.design.hull === 'liner')!;
  return report(s, bp.design).specs;
})();
const base = (o: Partial<PlanInput> = {}): PlanInput => ({ region: NE, ship: puffin, start: 'BOS', stops: ['BHB', 'HFX'], end: 'BOS', nights: 4, departDay: 0, openGroups: [], ...o });
const keys = (i: PlanInput) => planVoyage(i).issues.map(x => x.key);

describe('routes', () => {
  it('Boston to Halifax is about 408 nm', () => {
    const r = route(NE, 'BOS', 'HFX', { draft: 4.8, air: 27, beam: 19 })!;
    expect(r.nm).toBeGreaterThan(380);
    expect(r.nm).toBeLessThan(440);
  });
  it('a coastal ship uses the Cape Cod Canal; a liner is too tall and sails around', () => {
    const small = route(NE, 'NYC', 'BOS', { draft: 4.8, air: 27, beam: 19 })!;
    const big = route(NE, 'NYC', 'BOS', { draft: 7.9, air: 46, beam: 30.5 })!;
    expect(small.canals).toContain('capeCod');
    expect(big.canals).not.toContain('capeCod');
    expect(big.nm).toBeGreaterThan(small.nm);
  });
  it('never sails through a port without calling', () => {
    const r = route(NE, 'BOS', 'HFX', { draft: 4.8, air: 27, beam: 19 })!;
    expect(r.ids.slice(1, -1).some(id => id in NE.ports)).toBe(false);
  });
});

describe('port rules', () => {
  it('blocks a ship too deep or too long for the pier', () => {
    expect(portStatus(NE, 'GPE', linerSpecs, []).ok).toBe(false);
    expect(portStatus(NE, 'GPE', puffin, []).ok).toBe(true);
  });
  it('Newfoundland is locked until the milestone', () => {
    const r = portStatus(NE, 'STJ', puffin, []);
    expect(r.ok).toBe(false);
    expect(portStatus(NE, 'STJ', puffin, ['six']).ok).toBe(true);
  });
});

describe('the planner', () => {
  it('the tutorial cruise is legal', () => {
    expect(planVoyage(base()).errors).toBe(0);
  });
  it('a US round trip needs a foreign port (PVSA)', () => {
    expect(keys(base({ stops: ['BHB'] }))).toContain('plan.pvsaForeign');
  });
  it('one US port to another is not allowed', () => {
    expect(keys(base({ end: 'NYC', stops: ['HFX'] }))).toContain('plan.pvsaOneWay');
  });
  it('ending in Canada is a legal turnaround', () => {
    expect(planVoyage(base({ stops: ['BHB'], end: 'HFX' })).errors).toBe(0);
  });
  it('flags a late return', () => {
    expect(keys(base({ nights: 3, stops: ['HFX', 'SYD', 'CHA'] }))).toContain('plan.late');
  });
  it('flags running out of fuel', () => {
    const tiny = { ...puffin, fuelCap: 12 };
    expect(keys(base({ ship: tiny }))).toContain('plan.fuelOut');
  });
  it('a cruise that ends after the season closes is red', () => {
    expect(keys(base({ departDay: dayOf(2027, 10, 29) }))).toContain('plan.seasonEnds');
  });
  it('arrives by 07:00, stays 8 hours, never under 10 knots', () => {
    const p = planVoyage(base());
    for (const c of p.calls) {
      expect(c.dep - c.arr).toBeGreaterThanOrEqual(8);
      expect(c.arr % 24).toBeLessThanOrEqual(11.001);
    }
    for (const l of p.legs) expect(l.speed).toBeGreaterThanOrEqual(10);
  });
  it('variety beats repeats', () => {
    const one = planVoyage(base({ stops: ['BHB', 'HFX'] })).score;
    const rep = planVoyage(base({ stops: ['BHB', 'HFX', 'BHB'], nights: 5 }));
    expect(rep.issues.map(i => i.key)).toContain('plan.repeat');
    expect(rep.score).toBeLessThanOrEqual(one + 5);
  });
});

describe('economy and events', () => {
  it('the same plan rolls the same events', () => {
    const p = planVoyage(base());
    const a = rollEvents(p, puffin, 120, planSeed(p, 's1'));
    const b = rollEvents(p, puffin, 120, planSeed(p, 's1'));
    expect(a).toEqual(b);
  });
  it('raising the fare past the best one loses money', () => {
    const p = planVoyage(base());
    const best = bestFare(NE, puffin, summarise(p), { rep: 3, demandBonus: 0 });
    const s = newGame();
    s.plan.stops = ['BHB', 'HFX'];
    const plan = draftPlan(s)!;
    expect(planFinance(s, plan, best.fare).profit).toBeGreaterThanOrEqual(planFinance(s, plan, 450).profit);
  });
  it('sailing moves the ship, pays out and opens the Drydock', () => {
    const s = newGame();
    s.plan.stops = ['BHB', 'HFX'];
    s.plan.fare = 260;
    const r = sail(s)!;
    expect(r).toBeTruthy();
    expect(s.ships[0].day).toBe(4);
    expect(s.cash).toBe(300000 + r.profit + 50000);
    expect(s.unlocked.drydock).toBe(true);
    expect(r.firsts).toContain('region:northeast');
    expect(s.dpEarned).toBeGreaterThan(0);
  });
  it('a cruise with red items will not sail', () => {
    const s = newGame();
    s.plan.stops = ['BHB'];
    expect(sail(s)).toBeNull();
    expect(bpById(s, 'bp1')).toBeTruthy();
  });
});
