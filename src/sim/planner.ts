// The Chartroom planner: schedule, speed, fuel, port rules, the PVSA and appeal.
import type { Port, Region, Rival, SeasonDef } from './data';
import type { ShipSpecs } from './ship';
import { route, type Route, type TideGate } from './route';
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
/** Cruise lengths a region offers. Europe runs longer cruises with fly-in guests. */
export const nightOptions = (region: Region) => region.nights ?? NIGHT_OPTIONS;
/** Scenic stops: cruise past in daylight for a few hours. */
export const SCENIC_STAY = 4;
export const DAYLIGHT = [6, 16];
/** Each zodiac seat makes about six landings a day. */
export const ZODIAC_TRIPS = 6;
/** Without an ice belt a ship stays back from the glacier face. */
export const NO_ICE_PENALTY = 4;

export type FuelMode = 'standard' | 'lowSulfur' | 'scrubber' | 'lng';

/** Hours to wait before a tide gate opens, if the ship arrives at `absHour` (hours since day 0). */
export function tideWait(g: Pick<TideGate, 'period' | 'window' | 'phase'>, absHour: number): number {
  const x = ((absHour - g.phase) % g.period + g.period) % g.period;
  const half = g.window / 2;
  if (x <= half || x >= g.period - half) return 0;
  return g.period - half - x;
}

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
  /** In an emissions control area, without a scrubber or LNG: pay for low-sulfur fuel, or risk a fine. */
  lowSulfur?: boolean;
  /** Where carbon is charged: also buy offsets for the rest, for a carbon-neutral cruise. */
  offset?: boolean;
}

export type PlanLevel = 'err' | 'warn' | 'info';
export interface PlanIssue { lvl: PlanLevel; key: string; vars?: Vars; at?: string }

export interface Leg { from: string; to: string; r: Route; dep: number; arr: number; speed: number; sailH: number; idleH: number; fuel: number; tideWait: number }
export interface Call {
  id: string; arr: number; dep: number; refuel: boolean;
  /** 0 = Sunday. */
  weekday: number;
  rivals: Rival[];
  /** Rival guests ashore that day. */
  crowd: number;
  /** Piers were full, so the ship anchors and tenders. */
  tender: boolean;
  /** A scenic stop: cruise past, nobody goes ashore. */
  scenic: boolean;
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
  /** How the ship meets emissions rules, when the region has them. */
  fuelMode: FuelMode | null;
  /** Carbon charged per tonne of fuel burned, offsets included; 0 where there is no carbon charge. */
  carbonPrice: number;
  /** Offsets bought: the cruise counts as carbon-neutral. */
  offset: boolean;
  /** Bookings multiplier from the turnarounds' airports. */
  flyIn: number;
  /** Chart areas the cruise touches, start and end included. */
  areas: string[];
  /** Calls made in zero-emission waters. */
  zeroCalls: string[];
  score: number; parts: { key: string; vars?: Vars; v: number }[]; tags: string[];
  issues: PlanIssue[]; broken: boolean; errors: number; warnings: number;
}

export type PortCheck = { ok: true } | { ok: false; key: string; vars?: Vars; locked?: boolean };

export function portStatus(region: Region, id: string, ship: Pick<ShipSpecs, 'draft' | 'length'> & { beam?: number; air?: number; zeroNm?: number }, openGroups: string[], sandbox = false): PortCheck {
  const p = region.ports[id];
  if (!p) return { ok: false, key: 'plan.port.unknown' };
  if (p.closed) return { ok: false, key: 'plan.port.closed', vars: { port: p.name } };
  if (p.lockedBy && !sandbox && !openGroups.includes(p.lockedBy)) return { ok: false, key: 'plan.port.locked.' + p.lockedBy, vars: { port: p.name }, locked: true };
  // A ban (Venice's lagoon) bars big ships outright, whatever the pier could take.
  if (p.ban && ((p.maxLength != null && ship.length > p.maxLength) || (p.maxAir != null && ship.air != null && ship.air > p.maxAir))) {
    return { ok: false, key: 'plan.port.banned', vars: { port: p.name, len: p.maxLength ?? '—', air: p.maxAir ?? '—' } };
  }
  if (p.berth === 'pier' && p.maxDraft != null && ship.draft > p.maxDraft) {
    return { ok: false, key: 'plan.port.tooDeep', vars: { port: p.name, max: p.maxDraft, draft: ship.draft } };
  }
  if ((p.berth === 'pier' || p.berth === 'scenic') && p.maxLength != null && ship.length > p.maxLength) {
    return { ok: false, key: 'plan.port.tooLong', vars: { port: p.name, max: p.maxLength, len: ship.length } };
  }
  if (p.maxBeam != null && ship.beam != null && ship.beam > p.maxBeam) {
    return { ok: false, key: 'plan.port.tooWide', vars: { port: p.name, max: p.maxBeam, beam: ship.beam } };
  }
  if (p.maxAir != null && ship.air != null && ship.air > p.maxAir) {
    return { ok: false, key: 'plan.port.tooTall', vars: { port: p.name, max: p.maxAir, air: ship.air } };
  }
  if (p.zeroNm != null && ship.zeroNm != null && ship.zeroNm < p.zeroNm) {
    return { ok: false, key: 'plan.port.zeroEmission', vars: { port: p.name, need: p.zeroNm, have: Math.floor(ship.zeroNm) } };
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
  const size = { draft: ship.draft, air: ship.air, beam: ship.beam, length: ship.length };
  // Air conditioning in hot regions raises the hotel load.
  const hotel = ship.hotelTph * (region.hotelMult ?? 1);

  // With no stops there is nothing to schedule yet; the "no stops" error says what to do.
  for (let i = 0; input.stops.length && i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1], last = i === seq.length - 2;
    if (a === b) { E('plan.twoInRow', { port: P[b].name }, b); broken = true; break; }
    // A tide-timed narrows can hold the ship for hours. Take the outside route if that gets there sooner.
    const startAbs = input.departDay * 24 + t;
    const waitOn = (rt: Route, speed: number) => rt.tides.reduce((w, g) => w + tideWait(g, startAbs + w + g.atNm / speed), 0);
    let r = route(region, a, b, size);
    if (r?.tides.length) {
      const alt = route(region, a, b, size, { avoidTide: true });
      if (alt && alt.nm / ship.vmax < r.nm / ship.vmax + waitOn(r, ship.vmax)) {
        I('plan.outsideRoute', { narrows: '@narrows.' + r.tides[0].narrows, nm: Math.round(alt.nm - r.nm) }, b);
        r = alt;
      }
    }
    if (!r) { E('plan.noRoute', { from: P[a].name, to: P[b].name }, b); broken = true; break; }
    // Too big for a canal on the shortest way: say so, since the long way round costs time and fuel.
    const any = route(region, a, b, { draft: 0, air: 0, beam: 0, length: 0 });
    for (const c of any?.canals ?? []) if (!r.canals.includes(c)) I('plan.canalAround', { canal: '@canal.' + c, nm: Math.round(r.nm - any!.nm) }, b);
    tolls += r.tolls; pilotage += r.pilotage; nm += r.nm;
    r.canals.forEach(c => { if (!canals.includes(c)) canals.push(c); });
    r.scenic.forEach(c => { if (!scenic.includes(c)) scenic.push(c); });
    const scenicStop = !last && P[b].berth === 'scenic';
    const earliest = t + r.nm / ship.vmax + waitOn(r, ship.vmax);
    let arr: number;
    if (last) arr = Math.max(earliest, deadline);
    else if (scenicStop) {
      // Scenic stops happen in daylight, any time between 06:00 and 16:00.
      const d = Math.floor(earliest / 24), tod = earliest - d * 24;
      arr = tod < DAYLIGHT[0] ? d * 24 + DAYLIGHT[0] : tod <= DAYLIGHT[1] ? earliest : (d + 1) * 24 + DAYLIGHT[0];
    } else {
      const d = Math.floor(earliest / 24), tod = earliest - d * 24;
      arr = tod <= ARRIVE_BY ? d * 24 + ARRIVE_BY : tod <= LATEST_ARRIVAL ? earliest : (d + 1) * 24 + ARRIVE_BY;
    }
    // As slow as the schedule allows, because slower sailing burns less fuel. A tide wait eats into the time.
    const minV = Math.min(MIN_SPEED, ship.vmax);
    let speed = r.nm / Math.max(0.01, arr - t), tw = 0;
    for (let k = 0; k < 3; k++) {
      speed = Math.min(ship.vmax, Math.max(minV, speed));
      tw = waitOn(r, speed);
      speed = r.nm / Math.max(0.01, arr - t - tw);
    }
    speed = Math.min(ship.vmax, Math.max(minV, speed));
    tw = waitOn(r, speed);
    if (last) arr = Math.max(arr, t + r.nm / speed + tw);
    const sailH = r.nm / speed, idleH = Math.max(0, arr - t - sailH);
    const slow = speed < ship.vmax * 0.75 ? tech.slowBurn : 1;
    const f = r.nm * ship.burnPerNm * slow * Math.pow(speed / ship.vmax, 2) + hotel * (sailH + idleH);
    fuel -= f; burned += f; fuelPts.push([arr, fuel]);
    if (fuel < minFuel) { minFuel = fuel; minFuelAt = b; }
    legs.push({ from: a, to: b, r, dep: t, arr, speed, sailH, idleH, fuel: f, tideWait: tw });
    if (tw > 0.3) I('plan.tideWait', { h: tw.toFixed(1), narrows: '@narrows.' + r.tides[0].narrows }, b);
    if (!last) {
      const d = Math.floor(arr / 24), dep = scenicStop ? arr + SCENIC_STAY : Math.max(arr + MIN_STAY, d * 24 + DEPART_HOUR);
      const pf = hotel * 0.6 * tech.portHotel * (dep - arr);
      fuel -= pf; burned += pf; fuelPts.push([dep, fuel]);
      if (fuel < minFuel) { minFuel = fuel; minFuelAt = b; }
      const refuel = !!P[b].fuel && fuel >= 0;
      if (refuel) { fuel = ship.fuelCap; fuelPts.push([dep, fuel]); }
      const weekday = weekdayOf(input.departDay + Math.floor(arr / 24));
      const rivals = P[b].privateIsland ? [] : rivalsAt(region, b, weekday);
      const full = P[b].berths != null && rivals.length >= P[b].berths!;
      calls.push({ id: b, arr, dep, refuel: refuel && !scenicStop, weekday, rivals, crowd: rivals.reduce((a, r) => a + r.guests, 0), tender: full && !!P[b].tenderOk, scenic: scenicStop });
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
    if (p.berth === 'landing' && !ship.zodiacSeats) E('plan.noZodiacs', { port: p.name }, c.id);
    if (p.ice && !ship.ice) I('plan.noIce', { port: p.name }, c.id);
  }
  let fuelMode: FuelMode | null = null;
  if (region.eca) {
    fuelMode = ship.lng ? 'lng' : ship.scrubber ? 'scrubber' : input.lowSulfur ? 'lowSulfur' : 'standard';
    if (fuelMode === 'standard') W('plan.ecaRisk', { fine: '$' + Math.round(region.eca.fine / 1000) + 'k' });
  }
  canals.forEach(c => I('plan.canal', { canal: '@canal.' + c }));
  // Carbon: charged on every tonne burned. LNG emits less; offsets buy the rest back.
  let carbonPrice = 0;
  const offset = !!region.carbon && !!input.offset;
  if (region.carbon) {
    const share = ship.lng ? region.carbon.lngShare : 1;
    carbonPrice = region.carbon.price * share + (offset ? region.carbon.offset * share : 0);
  }
  // Fly-in guests: turnarounds near a big airport book better.
  let flyIn = 1;
  if (region.flyIn) {
    const air = ((P[start].airport ?? 0) + (P[end].airport ?? 0)) / 2;
    flyIn = 1 + region.flyIn * (air - 0.5) * 2;
    if (input.stops.length) I('plan.flyIn', { pct: (flyIn >= 1 ? '+' : '−') + Math.round(Math.abs(flyIn - 1) * 100) + '%' });
  }
  const areas: string[] = [];
  for (const id of [start, ...calls.map(c => c.id), end]) { const ar = P[id].area; if (ar && !areas.includes(ar)) areas.push(ar); }
  const zeroCalls = calls.filter(c => P[c.id].zeroNm != null).map(c => c.id);
  zeroCalls.forEach(id => I('plan.zeroCall', { port: P[id].name, nm: P[id].zeroNm! }, id));

  // Appeal: each new port adds its appeal, each theme adds 2.5, on a curve.
  let raw = 0;
  const parts: Plan['parts'] = [];
  const tags = new Set<string>(), done = new Set<string>();
  for (const c of calls) {
    if (done.has(c.id)) continue;
    done.add(c.id);
    const p = P[c.id];
    let a = p.appeal[sIdx] - (p.berth === 'tender' || c.tender ? tech.tenderPenalty : 0);
    if (p.ice && !ship.ice) a -= NO_ICE_PENALTY;
    // A landing is only as good as the share of guests the zodiacs can take ashore.
    if (p.berth === 'landing') a = Math.round(a * Math.min(1, ship.zodiacSeats * ZODIAC_TRIPS / Math.max(1, ship.pax)) * 10) / 10;
    raw += a; parts.push({ key: 'appeal.port', vars: { port: p.name }, v: a });
    const cp = crowdPenalty(c.crowd);
    if (cp) { raw -= cp; parts.push({ key: 'appeal.crowd', vars: { port: p.name }, v: -cp }); }
    p.tags.forEach(x => tags.add(x));
  }
  if (tags.size) { const tb = tags.size * 2.5; raw += tb; parts.push({ key: 'appeal.variety', vars: { n: tags.size }, v: tb }); }
  if (region.countryBonus) {
    const countries = new Set(calls.map(c => P[c.id].country));
    const cb = Math.max(0, countries.size - 1) * region.countryBonus;
    if (cb) { raw += cb; parts.push({ key: 'appeal.countries', vars: { n: countries.size }, v: cb }); }
  }
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
    tolls, pilotage, canals, scenic, seaDays, nm, fuelMode, carbonPrice, offset, flyIn, areas, zeroCalls, score, parts, tags: [...tags],
    issues, broken, errors, warnings: issues.filter(i => i.lvl === 'warn').length,
  };
}
