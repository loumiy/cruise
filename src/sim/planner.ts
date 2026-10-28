// The Chartroom planner: schedule, speed, fuel, port rules, the PVSA and appeal.
import type { Port, Region, Rival, SeasonDef } from './data';
import type { ShipSpecs } from './ship';
import { route, type Route } from './route';
import { seasonOf, seasonCloseDay, weekdayOf } from './calendar';
import { forecastHit } from './storms';
import { NO_TECH, type TechMods } from './tech';
import type { Vars } from './strings';

export const DEPART_HOUR = 17;
export const ARRIVE_BY = 7;
export const LATEST_ARRIVAL = 11;
export const MIN_STAY = 8;
export const MIN_SPEED = 10;
export const FUEL_RESERVE = 0.15;
export const NIGHT_OPTIONS = [3, 4, 5, 6, 7];

export interface PlanInput {
  region: Region;
  ship: ShipSpecs;
  start: string;
  stops: string[];
  end: string;
  nights: number;
  departDay: number;
  openGroups: string[];
  sandbox?: boolean;
  tech?: TechMods;
}

export type PlanLevel = 'err' | 'warn' | 'info';
export interface PlanIssue { lvl: PlanLevel; key: string; vars?: Vars; at?: string }

export interface Leg { from: string; to: string; r: Route; dep: number; arr: number; speed: number; sailH: number; idleH: number; fuel: number }
export interface Call {
  id: string; arr: number; dep: number; refuel: boolean;
  /** 0 = Sunday. */
  weekday: number;
  rivals: Rival[];
  /** Rival guests ashore that day. */
  crowd: number;
  /** Piers were full, so the ship anchors and tenders. */
  tender: boolean;
}

/** Rival ships calling at a port on a weekday. */
export function rivalsAt(region: Region, port: string, weekday: number): Rival[] {
  return region.rivals.filter(r => r.calls[String(weekday)] === port);
}

/** Piers left for us at a port on a weekday. Infinity when the port has no berth limit. */
export function piersFree(region: Region, port: string, weekday: number): number {
  const p = region.ports[port];
  if (p.berths == null) return Infinity;
  return p.berths - rivalsAt(region, port, weekday).length;
}

/** Crowds cost appeal: up to 4 points when 8,000 rival guests are ashore. */
export const crowdPenalty = (crowd: number) => Math.min(4, Math.round(crowd / 2000 * 10) / 10);

export interface Plan {
  input: PlanInput;
  season: SeasonDef | null;
  legs: Leg[]; calls: Call[];
  ret: number; deadline: number;
  fuelPts: [number, number][]; minFuel: number; minFuelAt: string | null; burned: number;
  tolls: number; pilotage: number; canals: string[]; scenic: string[];
  seaDays: number; nm: number;
  score: number; parts: { key: string; vars?: Vars; v: number }[]; tags: string[];
  issues: PlanIssue[]; broken: boolean; errors: number; warnings: number;
}

export type PortCheck = { ok: true } | { ok: false; key: string; vars?: Vars; locked?: boolean };

export function portStatus(region: Region, id: string, ship: Pick<ShipSpecs, 'draft' | 'length'> & { beam?: number }, openGroups: string[], sandbox = false): PortCheck {
  const p = region.ports[id];
  if (!p) return { ok: false, key: 'plan.port.unknown' };
  if (p.closed) return { ok: false, key: 'plan.port.closed', vars: { port: p.name } };
  if (p.lockedBy && !sandbox && !openGroups.includes(p.lockedBy)) return { ok: false, key: 'plan.port.locked', vars: { port: p.name }, locked: true };
  if (p.berth === 'pier' && p.maxDraft != null && ship.draft > p.maxDraft) {
    return { ok: false, key: 'plan.port.tooDeep', vars: { port: p.name, max: p.maxDraft, draft: ship.draft } };
  }
  if (p.berth === 'pier' && p.maxLength != null && ship.length > p.maxLength) {
    return { ok: false, key: 'plan.port.tooLong', vars: { port: p.name, max: p.maxLength, len: ship.length } };
  }
  if (p.maxBeam != null && ship.beam != null && ship.beam > p.maxBeam) {
    return { ok: false, key: 'plan.port.tooWide', vars: { port: p.name, max: p.maxBeam, beam: ship.beam } };
  }
  return { ok: true };
}

export function turnarounds(region: Region): string[] {
  return Object.keys(region.ports).filter(k => region.ports[k].turnaround);
}

const isUS = (p: Port) => p.country === 'US';

export function planVoyage(input: PlanInput): Plan {
  const { region, ship, start, end, nights } = input;
  const tech = input.tech ?? NO_TECH;
  const season = seasonOf(region, input.departDay);
  const sIdx = season?.appealIdx ?? 0;
  const P = region.ports;
  const seq = [start, ...input.stops, end];
  const issues: PlanIssue[] = [];
  const E = (key: string, vars?: Vars, at?: string) => issues.push({ lvl: 'err', key, vars, at });
  const W = (key: string, vars?: Vars, at?: string) => issues.push({ lvl: 'warn', key, vars, at });
  const I = (key: string, vars?: Vars, at?: string) => issues.push({ lvl: 'info', key, vars, at });

  const legs: Leg[] = [], calls: Call[] = [];
  let t = DEPART_HOUR, fuel = ship.fuelCap, minFuel = fuel, minFuelAt: string | null = null, burned = 0;
  let tolls = 0, pilotage = 0, broken = false, nm = 0;
  const fuelPts: [number, number][] = [[t, fuel]];
  const deadline = nights * 24 + ARRIVE_BY;
  const canals: string[] = [], scenic: string[] = [];
  const size = { draft: ship.draft, air: ship.air, beam: ship.beam };
  // Air conditioning in hot regions raises the hotel load.
  const hotel = ship.hotelTph * (region.hotelMult ?? 1);

  // With no stops there is nothing to schedule yet; the "no stops" error says what to do.
  for (let i = 0; input.stops.length && i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1], last = i === seq.length - 2;
    if (a === b) { E('plan.twoInRow', { port: P[b].name }, b); broken = true; break; }
    const r = route(region, a, b, size);
    if (!r) { E('plan.noRoute', { from: P[a].name, to: P[b].name }, b); broken = true; break; }
    tolls += r.tolls; pilotage += r.pilotage; nm += r.nm;
    r.canals.forEach(c => { if (!canals.includes(c)) canals.push(c); });
    r.scenic.forEach(c => { if (!scenic.includes(c)) scenic.push(c); });
    const earliest = t + r.nm / ship.vmax;
    let arr: number;
    if (last) arr = Math.max(earliest, deadline);
    else {
      const d = Math.floor(earliest / 24), tod = earliest - d * 24;
      arr = tod <= ARRIVE_BY ? d * 24 + ARRIVE_BY : tod <= LATEST_ARRIVAL ? earliest : (d + 1) * 24 + ARRIVE_BY;
    }
    // As slow as the schedule allows, because slower sailing burns less fuel.
    let speed = r.nm / Math.max(0.01, arr - t);
    speed = Math.min(ship.vmax, Math.max(Math.min(MIN_SPEED, ship.vmax), speed));
    const sailH = r.nm / speed, idleH = Math.max(0, arr - t - sailH);
    const slow = speed < ship.vmax * 0.75 ? tech.slowBurn : 1;
    const f = r.nm * ship.burnPerNm * slow * Math.pow(speed / ship.vmax, 2) + hotel * (sailH + idleH);
    fuel -= f; burned += f; fuelPts.push([arr, fuel]);
    if (fuel < minFuel) { minFuel = fuel; minFuelAt = b; }
    legs.push({ from: a, to: b, r, dep: t, arr, speed, sailH, idleH, fuel: f });
    if (!last) {
      const d = Math.floor(arr / 24), dep = Math.max(arr + MIN_STAY, d * 24 + DEPART_HOUR);
      const pf = hotel * 0.6 * tech.portHotel * (dep - arr);
      fuel -= pf; burned += pf; fuelPts.push([dep, fuel]);
      if (fuel < minFuel) { minFuel = fuel; minFuelAt = b; }
      const refuel = !!P[b].fuel && fuel >= 0;
      if (refuel) { fuel = ship.fuelCap; fuelPts.push([dep, fuel]); }
      const weekday = weekdayOf(input.departDay + Math.floor(arr / 24));
      const rivals = P[b].privateIsland ? [] : rivalsAt(region, b, weekday);
      const full = P[b].berths != null && rivals.length >= P[b].berths!;
      calls.push({ id: b, arr, dep, refuel, weekday, rivals, crowd: rivals.reduce((a, r) => a + r.guests, 0), tender: full && !!P[b].tenderOk });
      if (P[b].canalCall) { tolls += P[b].canalCall!; if (!canals.includes('panama')) canals.push('panama'); }
      t = dep;
    } else t = arr;
  }
  const ret = t;

  // Rules.
  if (!season) E('plan.offSeason');
  else if (!region.season.yearRound && input.departDay + nights > seasonCloseDay(region, input.departDay)) E('plan.seasonEnds');
  if (!input.stops.length) E('plan.noStops');
  input.stops.forEach(id => {
    const s = portStatus(region, id, ship, input.openGroups, input.sandbox);
    if (!s.ok) E(s.key, s.vars, id);
  });
  if (!P[end].turnaround) E('plan.notTurnaround', { port: P[end].name }, end);
  const sUS = isUS(P[start]), eUS = isUS(P[end]);
  if (sUS && eUS && start !== end) E('plan.pvsaOneWay', { start: P[start].name });
  else if (sUS && eUS && !input.stops.some(id => !isUS(P[id]))) E('plan.pvsaForeign');
  if (nights > Math.floor(ship.foodDays)) E('plan.food', { days: Math.floor(ship.foodDays) });
  if (!broken && input.stops.length) {
    const late = ret - deadline;
    if (late > 0.05) E('plan.late', { hours: late.toFixed(1), port: P[end].name }, end);
    if (minFuel < 0 && minFuelAt) E('plan.fuelOut', { port: P[minFuelAt].name, short: Math.ceil(-minFuel), cap: ship.fuelCap }, minFuelAt);
    else if (minFuelAt && minFuel / ship.fuelCap < FUEL_RESERVE) W('plan.fuelLow', { pct: Math.round(minFuel / ship.fuelCap * 100), port: P[minFuelAt].name }, minFuelAt);
  }
  const seen = new Set<string>();
  input.stops.forEach(id => { if (seen.has(id)) W('plan.repeat', { port: P[id].name }, id); seen.add(id); });

  let seaDays = 0;
  for (let k = 2; k <= nights; k++) if (!calls.some(c => c.arr < k * 24 && c.dep > (k - 1) * 24)) seaDays++;
  if (input.stops.length && nights <= 5 && seaDays > 1) W('plan.seaDays', { n: seaDays, nights });
  calls.filter(c => P[c.id].berth === 'tender').forEach(c => I('plan.tender', { port: P[c.id].name }, c.id));
  for (const c of calls) {
    const p = P[c.id];
    const day = '@weekday.' + c.weekday;
    if (p.berths != null && c.rivals.length >= p.berths) {
      if (c.tender) W('plan.piersFullTender', { port: p.name, day }, c.id);
      else E('plan.piersFull', { port: p.name, day }, c.id);
    }
    if (c.crowd >= 6000) W('plan.crowd', { port: p.name, n: c.crowd.toLocaleString('en-US'), day }, c.id);
    const hit = forecastHit(region, [p.lon, p.lat], input.departDay + c.arr / 24, input.departDay);
    if (hit) W('plan.storm', { storm: hit.storm.name, port: p.name }, c.id);
  }
  canals.forEach(c => I('plan.canal', { canal: '@canal.' + c }));

  // Appeal: each new port adds its appeal, each theme adds 2.5, on a curve.
  let raw = 0;
  const parts: Plan['parts'] = [];
  const tags = new Set<string>(), done = new Set<string>();
  for (const c of calls) {
    if (done.has(c.id)) continue;
    done.add(c.id);
    const p = P[c.id];
    const a = p.appeal[sIdx] - (p.berth === 'tender' || c.tender ? tech.tenderPenalty : 0);
    raw += a; parts.push({ key: 'appeal.port', vars: { port: p.name }, v: a });
    const cp = crowdPenalty(c.crowd);
    if (cp) { raw -= cp; parts.push({ key: 'appeal.crowd', vars: { port: p.name }, v: -cp }); }
    p.tags.forEach(x => tags.add(x));
  }
  if (tags.size) { const tb = tags.size * 2.5; raw += tb; parts.push({ key: 'appeal.variety', vars: { n: tags.size }, v: tb }); }
  if (scenic.length) {
    const sb = region.scenicBonus + ship.scenic;
    raw += sb; parts.push({ key: 'appeal.scenic', vars: { name: '@scenic.' + scenic[0] }, v: sb });
  }
  const sp = nights <= 5 ? Math.max(0, seaDays - 1) * 6 : Math.max(0, seaDays - 2) * 4;
  if (sp) { raw -= sp; parts.push({ key: 'appeal.seaDays', v: -sp }); }
  const score = Math.max(0, Math.round(100 * (1 - Math.exp(-raw / 38))));

  const errors = issues.filter(i => i.lvl === 'err').length;
  return {
    input, season, legs, calls, ret, deadline, fuelPts, minFuel, minFuelAt, burned,
    tolls, pilotage, canals, scenic, seaDays, nm, score, parts, tags: [...tags],
    issues, broken, errors, warnings: issues.filter(i => i.lvl === 'warn').length,
  };
}
