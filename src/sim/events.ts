// Voyage events, rolled from a fixed seed so the same plan gives the same result.
import { EVENTS, type EventDef } from './data';
import type { Plan } from './planner';
import type { ShipSpecs } from './ship';
import { hashString, mulberry } from './geo';
import { NO_TECH, type TechMods } from './tech';
import type { Vars } from './strings';

export interface VoyageEvent {
  id: string; t: number; key: string; vars: Vars; sat: number;
  /** Money lost (+) or gained (−) compared with the forecast. */
  cost: number; good: boolean; cancelsCall?: string;
}

export function planSeed(plan: Plan, shipId: string): number {
  const i = plan.input;
  return hashString([shipId, i.start, i.stops.join('-'), i.end, i.nights, i.departDay].join('|'));
}

function oddsOf(e: EventDef, plan: Plan): number {
  const fall = plan.season?.id === 'fall';
  if (typeof e.odds === 'string') return (plan.season as unknown as Record<string, number> | null)?.[e.odds] ?? 0;
  return fall && e.fallOdds != null ? e.fallOdds : e.odds;
}

export function rollEvents(plan: Plan, ship: ShipSpecs, booked: number, seed: number, tech: TechMods = NO_TECH): VoyageEvent[] {
  const rnd = mulberry(seed);
  const region = plan.input.region;
  const P = region.ports;
  const out: VoyageEvent[] = [];
  const fired = new Set<string>();
  const seasonId = plan.season?.id;

  for (const leg of plan.legs) {
    for (const e of EVENTS.filter(x => x.on === 'leg')) {
      if (e.once && fired.has(e.id)) continue;
      if (e.minNm && leg.r.nm < e.minNm) continue;
      const zone = e.zone ? region.zones[e.zone] ?? [] : [];
      if (e.zone && !leg.r.ids.some(id => zone.includes(id))) continue;
      if (rnd() >= oddsOf(e, plan)) continue;
      fired.add(e.id);
      let sat = e.sat, key = 'event.' + e.id;
      if (e.scaleByHull) {
        // Small hulls with a low GM suffer most in a gale.
        const gmF = ship.gm < 1 ? 1 : ship.gm < 1.4 ? 0.6 : 0.3;
        sat = Math.round(Math.min(-2, e.sat * ship.galeK * gmF));
        key += sat <= -7 ? '.rough' : sat <= -4 ? '.lively' : '.calm';
      }
      out.push({ id: e.id, t: leg.dep + leg.sailH * 0.5, key, vars: { port: P[leg.to].name }, sat, cost: 0, good: sat > 0 });
    }
  }
  for (const c of plan.calls) {
    const p = P[c.id];
    for (const e of EVENTS.filter(x => x.on === 'call')) {
      if (e.port && e.port !== c.id) continue;
      if (e.season && e.season !== seasonId) continue;
      if (e.berth && e.berth !== p.berth) continue;
      if (e.tag && !p.tags.includes(e.tag)) continue;
      if (e.minAppeal && p.appeal[plan.season?.appealIdx ?? 0] < e.minAppeal) continue;
      let odds = oddsOf(e, plan);
      if (e.cancelsCall) odds *= tech.tenderCancel;
      if (rnd() >= odds) continue;
      let cost = 0;
      // Port and tender fees are already committed, so a refund is a pure loss.
      if (e.refund) cost = booked * e.refund;
      if (e.revenue) cost -= booked * e.revenue;
      out.push({
        id: e.id, t: c.arr + 1, key: 'event.' + e.id, vars: { port: p.name, refund: e.refund ?? 0 },
        sat: e.sat, cost, good: e.sat > 0, cancelsCall: e.cancelsCall ? c.id : undefined,
      });
      if (e.cancelsCall) break;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
