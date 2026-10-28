// Voyage events, rolled from a fixed seed so the same plan gives the same result.
import { EVENTS, type EventDef } from './data';
import type { Plan } from './planner';
import type { ShipSpecs } from './ship';
import { hashString, mulberry } from './geo';
import { NO_TECH, type TechMods } from './tech';
import { realHit, DANGER_NM } from './storms';

export const CROWD_EVENT = 6000;
export const STORM_REFUND = 40;
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
  // Storms: the real track can drift from the forecast. A port in its path closes; a leg near it is rough.
  const day0 = plan.input.departDay;
  for (const leg of plan.legs) {
    const mid = leg.r.pts[Math.floor(leg.r.pts.length / 2)];
    const hit = realHit(region, mid, day0 + (leg.dep + leg.sailH / 2) / 24);
    if (hit && hit.nm < DANGER_NM * 1.3) {
      const sat = Math.round(Math.min(-3, -8 * ship.galeK * (ship.gm < 1 ? 1.3 : 1)));
      out.push({ id: 'stormSeas', t: leg.dep + leg.sailH * 0.5, key: 'event.stormSeas', vars: { storm: hit.storm.name }, sat, cost: 0, good: false });
      break;
    }
  }
  const closed = new Set<string>();
  for (const c of plan.calls) {
    const p = P[c.id];
    const hit = realHit(region, [p.lon, p.lat], day0 + c.arr / 24);
    if (hit) {
      closed.add(c.id);
      out.push({ id: 'stormClosed', t: c.arr, key: 'event.stormClosed', vars: { storm: hit.storm.name, port: p.name, refund: STORM_REFUND }, sat: -7, cost: booked * STORM_REFUND, good: false, cancelsCall: c.id });
    } else if (c.crowd >= CROWD_EVENT) {
      out.push({ id: 'crowded', t: c.arr + 2, key: 'event.crowded', vars: { port: p.name, n: c.crowd.toLocaleString('en-US') }, sat: -3, cost: 0, good: false });
    }
  }
  for (const c of plan.calls) {
    const p = P[c.id];
    if (closed.has(c.id)) continue;
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
