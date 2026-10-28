// Fleet mode: many ships across all four regions, planned by season, not by cruise.
// Each ship gets a deployment per season: a repeating round trip in one region. Run season plays
// about 13 weeks at once. Moving a ship between regions is a repositioning cruise.
import { HULLS, REGIONS, REGION_ORDER, type Graduation } from './data';
import repoJson from '../../data/repositioning.json';
import rivalsJson from '../../data/rivals.json';
import {
  newGame, draftPlan, specsOf, voyageSat, earnFirst, nextId, cloneDesign, report, runTrial, commission, mods, regionOf,
  type GameState, type ShipRec, type PlanDraft,
} from './game';
import { finance, summarise, bestFare, CREW_WAGE, FOOD_PER_GUEST } from './economy';
import { rollEvents, planSeed } from './events';
import { checkCrossing, type CrossingCheck } from './crossing';
import { dayOf, dateOf } from './calendar';
import { hashString, mulberry } from './geo';
import type { Vars } from './strings';

/** A repeating itinerary: a round trip from one home port, sailed back to back all season. */
export interface Deployment {
  region: string; from: string; stops: string[]; nights: number; fare: number;
  /** Days after the season's planning week to depart: picks the weekday. */
  wait: number;
  lowSulfur?: boolean; offset?: boolean;
}

/** What a ship does in one season. A deployment or a lay-up carries on into later seasons until changed. */
export interface Assignment { dep?: Deployment; layup?: boolean; dock?: boolean }

export interface ShipSeason {
  shipId: string; ship: string; region: string; cruises: number; guests: number; berths: number;
  profit: number; sat: number; notes: { key: string; vars?: Vars; bad?: boolean }[];
}
export interface SeasonReport {
  season: number; ships: ShipSeason[]; profit: number; overhead: number; repBefore: number; repAfter: number;
  fuel: number; cashAfter: number;
  /** What the rival lines did in answer. */
  rivalNews?: RivalNews[];
}

/** A rival line's ship in fleet mode: it sails one region on a weekly pattern of calls. */
export interface RivalShip { ship: string; line: string; guests: number; region: string; calls: Record<string, string> }
export interface RivalNews { key: string; vars: Vars; line: string }
export interface RivalState {
  ships: RivalShip[];
  /** Each region's rival fare, as a share of where it started. */
  fare: Record<string, number>;
  /** Rival berths per week in each region at the start, to measure growth against. */
  base: Record<string, number>;
}

export interface FleetState {
  /** The next season to run, as year × 4 + quarter (0 winter, 1 spring, 2 summer, 3 fall). */
  season: number;
  plans: Record<string, Record<number, Assignment>>;
  reports: SeasonReport[];
  /** The ship and season being planned in the Chartroom. */
  edit?: { shipId: string; season: number };
  /** The year the fleet started, for the 10-year goal. */
  startSeason: number;
  /** The three rival lines, and a counter that ticks whenever they change. */
  rivals?: RivalState; rivalsRev?: number;
  /** Tells one fleet game from another, for caches and seeds. */
  id?: string;
}

export const SEASON_NAMES = ['winter', 'spring', 'summer', 'fall'];
/** Ships reach drydock every two and a half years. */
export const DOCK_EVERY = 913;
export const DOCK_DAYS = 21;
export const DOCK_COST_SHARE = 0.15;
/** After this age, hotel blocks lose appeal and upkeep rises. */
export const OLD_AGE = 10;
/** Shoreside staff, sales and insurance per ship per season. */
export const OVERHEAD_PER_SHIP = 600_000;
/** A second ship in the same region shares its guests: each extra ship takes this much off everyone's reach. */
export const CROWDING = 0.15;
/** In fleet mode reputation drifts toward what guests think of the line: each cruise moves it a little. */
export const FLEET_REP_RATE = 0.04;
/** The reputation a satisfaction score earns over time: 65 holds at 3 stars, 90 reaches 5. */
export const repTarget = (sat: number) => Math.max(1, Math.min(5, 3 + (sat - 65) / 12.5));
export const REPO_SPEED = 16;
export const REPO_FARE = 95;
export const REPO_LOAD = 0.7;
export const LAYUP_SHARE = 0.25;
export const IDLE_SHARE = 0.5;

interface RepoRoute { a: string; b: string; nm: number; legNm: number; swell?: number; limits?: Graduation['limits'] }
const REPO = repoJson as unknown as { arrive: Record<string, string>; routes: RepoRoute[] };

// ---------- calendar ----------

export const seasonYear = (idx: number) => Math.floor(idx / 4);
export const seasonQuarter = (idx: number) => ((idx % 4) + 4) % 4;
export const seasonName = (idx: number) => SEASON_NAMES[seasonQuarter(idx)];

/** Winter runs December to February, so winter 2032 starts on 1 December 2031. */
export function seasonStart(idx: number): number {
  const y = seasonYear(idx), q = seasonQuarter(idx);
  return q === 0 ? dayOf(y - 1, 12, 1) : dayOf(y, q * 3, 1);
}
export const seasonEnd = (idx: number) => seasonStart(idx + 1);
/** The season a day falls in. */
export function seasonAt(day: number): number {
  const d = dateOf(day), m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  return m === 12 ? (y + 1) * 4 : y * 4 + Math.floor(m / 3);
}
/** Cruises are planned against the season's third week, after any repositioning. */
export const planningDay = (idx: number) => seasonStart(idx) + 14;

/** This season's fuel price, from a fixed seed: the same season always swings the same way. */
export function fuelIndex(idx: number): number {
  const r = mulberry(hashString('fuel:' + idx));
  return Math.round((0.85 + r() * 0.4) * 100) / 100;
}

// ---------- assignments ----------

const plansOf = (s: GameState, shipId: string) => (s.fleet!.plans[shipId] ??= {});

/** The assignment in force for a season: the latest deployment or lay-up set on or before it. Drydock is per season. */
export function assignmentFor(s: GameState, shipId: string, idx: number): Assignment & { carried: boolean } {
  const plans = s.fleet?.plans[shipId] ?? {};
  const keys = Object.keys(plans).map(Number).filter(k => k <= idx && (plans[k].dep || plans[k].layup)).sort((a, b) => b - a);
  const base = keys.length ? plans[keys[0]] : {};
  return { dep: base.layup ? undefined : base.dep, layup: !!base.layup, dock: !!plans[idx]?.dock, carried: !keys.length || keys[0] !== idx };
}

export function setDeployment(s: GameState, shipId: string, idx: number, dep: Deployment): void {
  const p = plansOf(s, shipId);
  p[idx] = { ...p[idx], dep, layup: false };
}
export function setLayup(s: GameState, shipId: string, idx: number): void {
  const p = plansOf(s, shipId);
  p[idx] = { ...p[idx], dep: undefined, layup: true };
}
export function toggleDock(s: GameState, shipId: string, idx: number): void {
  const p = plansOf(s, shipId);
  p[idx] = { ...p[idx], dock: !p[idx]?.dock };
}
/** Go back to carrying the previous season's plan forward. */
export function clearSeason(s: GameState, shipId: string, idx: number): void {
  const p = plansOf(s, shipId);
  const dock = p[idx]?.dock;
  delete p[idx];
  if (dock) p[idx] = { dock: true };
}

// ---------- ship life ----------

export const shipRegion = (s: GameState, ship: ShipRec) => ship.region ?? s.region;
export const ageYears = (ship: ShipRec, day: number) => Math.max(0, (day - (ship.built ?? 0)) / 365);
export const dockDue = (ship: ShipRec) => (ship.docked ?? ship.built ?? 0) + DOCK_EVERY;
export const dockCost = (ship: ShipRec) => Math.round(HULLS[ship.design.hull].commissionFee * DOCK_COST_SHARE / 1000) * 1000;

/** Satisfaction lost to an old interior. */
export const agePenalty = (age: number) => Math.min(15, Math.max(0, (age - OLD_AGE) * 1.5));
/** Upkeep as a share of the lease: rises with age. */
export const upkeepShare = (age: number) => Math.min(0.5, 0.01 * age + Math.max(0, age - OLD_AGE) * 0.02);

/** Odds a cruise is cancelled by a breakdown, once the ship is overdue for drydock. */
export function breakdownOdds(ship: ShipRec, day: number): number {
  const over = (day - dockDue(ship)) / 365;
  return over <= 0 ? 0 : Math.min(0.5, 0.06 + over * 0.12);
}

// ---------- repositioning ----------

export function repoRoute(a: string, b: string): RepoRoute | null {
  return REPO.routes.find(r => (r.a === a && r.b === b) || (r.a === b && r.b === a)) ?? null;
}
export const arrivalPort = (region: string) => REPO.arrive[region] ?? Object.keys(REGIONS[region].ports)[0];

/** The same range, size and stability checks as a graduation crossing. */
export function repoCheck(s: GameState, ship: ShipRec, to: string): CrossingCheck | null {
  const from = shipRegion(s, ship), r = repoRoute(from, to);
  if (!r) return null;
  const g: Graduation = { id: 'repo', nm: { [ship.port]: r.nm }, legNm: r.legNm, speed: REPO_SPEED, swell: r.swell ?? 1.8, limits: r.limits };
  return checkCrossing(g, ship.port, specsOf(s, ship), REGIONS[from].ports);
}

export interface RepoResult { ok: boolean; days: number; profit: number; check: CrossingCheck }

/** Sail the ship to another region with cheap seats sold to fill it. */
function reposition(s: GameState, ship: ShipRec, to: string, fuelMult: number): RepoResult | null {
  const c = repoCheck(s, ship, to);
  if (!c) return null;
  if (!c.ok) return { ok: false, days: 0, profit: 0, check: c };
  const sp = specsOf(s, ship), days = Math.ceil(c.hours / 24) + 1;
  const guests = Math.round(sp.pax * REPO_LOAD);
  const rev = guests * (REPO_FARE + sp.spend) * days;
  const fuelT = c.nm * sp.burnPerNm * Math.pow(Math.min(REPO_SPEED, sp.vmax) / sp.vmax, 2) + sp.hotelTph * days * 24;
  const cost = fuelT * REGIONS[to].fuelPrice * fuelMult + sp.lease * days + sp.crew * CREW_WAGE * days + guests * FOOD_PER_GUEST * days;
  ship.region = to;
  ship.port = arrivalPort(to);
  return { ok: true, days, profit: Math.round(rev - cost), check: c };
}

// ---------- running a season ----------

/** Run fn with the chart set to a region, then put it back. Planning reads the region from the state. */
function withRegion<T>(s: GameState, region: string, fn: () => T): T {
  const was = s.region;
  s.region = region;
  try { return fn(); } finally { s.region = was; }
}

/** Ships of yours deployed in each region this season. They share the region's guests. */
export function regionLoad(s: GameState, idx: number): Record<string, number> {
  const n: Record<string, number> = {};
  for (const sh of s.ships) {
    const a = assignmentFor(s, sh.id, idx);
    if (a.dep) n[a.dep.region] = (n[a.dep.region] ?? 0) + 1;
  }
  return n;
}
export const crowdShare = (n: number) => 1 / (1 + CROWDING * Math.max(0, n - 1));

/** Plan a deployment's cruise for a given day, as the Chartroom would. */
export function deploymentPlan(s: GameState, ship: ShipRec, dep: Deployment, day: number) {
  const draft: PlanDraft = { shipId: ship.id, nights: dep.nights, wait: 0, stops: dep.stops, end: dep.from, fare: dep.fare, lowSulfur: dep.lowSulfur, offset: dep.offset, from: dep.from, day };
  return withRegion(s, dep.region, () => draftPlan(s, draft));
}

/** Play out one season for the whole fleet. */
export function runSeason(s: GameState): SeasonReport {
  const F = s.fleet!, idx = F.season, start = seasonStart(idx), end = seasonEnd(idx);
  const fuelMult = fuelIndex(idx), load = regionLoad(s, idx);
  const repBefore = s.rep, firsts: string[] = [];
  const rows: ShipSeason[] = [];
  let total = 0;
  for (const ship of s.ships) {
    const a = assignmentFor(s, ship.id, idx);
    const row: ShipSeason = { shipId: ship.id, ship: ship.name, region: shipRegion(s, ship), cruises: 0, guests: 0, berths: 0, profit: 0, sat: 0, notes: [] };
    const sp = specsOf(s, ship);
    let day = Math.max(start, ship.day);
    if (a.dock) {
      row.profit -= dockCost(ship) + Math.round(sp.lease * DOCK_DAYS * LAYUP_SHARE);
      day += DOCK_DAYS;
      ship.docked = day;
      row.notes.push({ key: 'fleet.note.docked', vars: { cost: dockCost(ship) } });
    }
    if (a.dep && a.dep.region !== shipRegion(s, ship)) {
      const from = shipRegion(s, ship);
      const r = reposition(s, ship, a.dep.region, fuelMult);
      if (!r) row.notes.push({ key: 'fleet.note.noRoute', vars: { to: '@region.' + a.dep.region }, bad: true });
      else if (!r.ok) row.notes.push({ key: 'fleet.note.repoBlocked', vars: { to: '@region.' + a.dep.region }, bad: true });
      else {
        row.profit += r.profit; day += r.days;
        row.notes.push({ key: 'fleet.note.repositioned', vars: { from: '@region.' + from, to: '@region.' + a.dep.region, days: r.days } });
        earnFirst(s, 'region:' + a.dep.region, firsts);
      }
      row.region = shipRegion(s, ship);
    }
    const dep = a.dep && a.dep.region === shipRegion(s, ship) ? a.dep : undefined;
    let sats = 0, skipped = 0, broke = 0, idle = 0;
    if (dep) {
      // Line the first departure up with the deployment's weekday.
      const want = (planningDay(idx) + dep.wait) % 7;
      while (((day % 7) + 7) % 7 !== ((want % 7) + 7) % 7) day++;
      ship.port = dep.from;
      const share = crowdShare(load[dep.region] ?? 1) * rivalShare(s, dep.region);
      const region = withRegion(s, dep.region, () => regionOf(s));
      while (day + dep.nights <= end) {
        const plan = deploymentPlan(s, ship, dep, day);
        if (!plan || plan.errors) { skipped++; idle += 7; day += 7; continue; }
        const fin = finance(region, plan.input.ship, summarise(plan), dep.fare, { rep: s.rep, demandBonus: s.demandBonus, fuelMult, share });
        const events = rollEvents(plan, plan.input.ship, fin.booked, planSeed(plan, ship.id), mods(s));
        const age = ageYears(ship, day);
        const upkeep = Math.round(sp.lease * dep.nights * upkeepShare(age));
        const rnd = mulberry(planSeed(plan, ship.id + ':bd'));
        let profit: number, sat: number;
        if (rnd() < breakdownOdds(ship, day)) {
          // A breakdown cancels the cruise: fares go back, costs stay.
          broke++;
          profit = -Math.round(fin.cost - fin.ports) - upkeep;
          sat = 25;
        } else {
          sat = Math.max(0, voyageSat(plan, dep.fare, events) - agePenalty(age));
          profit = Math.round(fin.profit - events.reduce((x, e) => x + e.cost, 0)) - upkeep;
          row.guests += fin.booked;
          for (const c of plan.calls) earnFirst(s, 'port:' + c.id, firsts);
        }
        row.berths += plan.input.ship.pax;
        row.profit += profit; row.cruises++; sats += sat;
        s.rep = Math.round((s.rep + FLEET_REP_RATE * (repTarget(sat) - s.rep)) * 100) / 100;
        s.voyages++; ship.voyages++;
        s.log.push({
          n: s.voyages, day, region: dep.region, season: plan.season?.id, shipId: ship.id, ship: ship.name,
          route: [dep.from, ...dep.stops, dep.from], nights: dep.nights, booked: fin.booked, pax: plan.input.ship.pax, fare: dep.fare, profit, sat,
          events: events.map(e => ({ key: e.key, vars: e.vars, good: e.good })),
        });
        if (s.log.length > 120) s.log.shift();
        day += dep.nights;
      }
      idle += Math.max(0, end - day);
      if (skipped) row.notes.push({ key: 'fleet.note.skipped', vars: { n: skipped }, bad: true });
      if (broke) row.notes.push({ key: 'fleet.note.breakdown', vars: { n: broke }, bad: true });
      if ((load[dep.region] ?? 1) > 1) row.notes.push({ key: 'fleet.note.crowded', vars: { n: load[dep.region], pct: Math.round((1 - share) * 100) } });
    } else {
      idle = end - day;
      if (a.layup) row.notes.push({ key: 'fleet.note.laidUp' });
      else if (!a.dep) row.notes.push({ key: 'fleet.note.noPlan', bad: true });
    }
    row.profit -= Math.round(sp.lease * Math.max(0, idle) * (a.layup ? LAYUP_SHARE : IDLE_SHARE));
    if (day > dockDue(ship) && !a.dock) row.notes.push({ key: 'fleet.note.dockOverdue', bad: true });
    row.sat = row.cruises ? Math.round(sats / row.cruises) : 0;
    ship.day = Math.max(end, ship.day);
    total += row.profit;
    rows.push(row);
  }
  const overhead = OVERHEAD_PER_SHIP * s.ships.length;
  s.cash += total - overhead;
  const rep: SeasonReport = { season: idx, ships: rows, profit: total - overhead, overhead, repBefore, repAfter: s.rep, fuel: fuelMult, cashAfter: s.cash };
  rep.rivalNews = rivalTurn(s, rep);
  F.reports.push(rep);
  if (F.reports.length > 12) F.reports.shift();
  F.season = idx + 1;
  return rep;
}

// ---------- rival lines ----------

interface LineStyle { cut: number; move: number; launch: number; guests: [number, number]; prefer: string[]; names: string[] }
const RIVALS = rivalsJson as unknown as {
  lines: Record<string, { name: string; style: string }>;
  fleet: { lines: string[]; remap: Record<string, string>; style: Record<string, LineStyle> };
} & Record<string, { ship: string; line: string; guests: number; calls: Record<string, string> }[]>;
export const RIVAL_LINE_IDS = RIVALS.fleet.lines;
export const lineStyle = (id: string) => RIVALS.fleet.style[id];
/** A line's ships never number more than this. */
export const LINE_CAP = 14;
/** A line this size retires a ship for each one it launches. */
export const RETIRE_AT = 8;
/** Rival fares never drop below this share of where they started. */
export const FARE_FLOOR = 0.75;
/** Your guests in a region against the rivals' season capacity: above this, the rivals feel it. */
export const PRESSURE = 0.06;

/** Three lines across all regions, from the regions' own rival ships. Smaller lines fold into the big three. */
export function initRivals(): RivalState {
  const ships: RivalShip[] = [], base: Record<string, number> = {}, fare: Record<string, number> = {};
  for (const id of REGION_ORDER) {
    fare[id] = 1;
    for (const r of RIVALS[id] ?? []) {
      ships.push({ ship: r.ship, line: RIVALS.fleet.remap[r.line] ?? r.line, guests: r.guests, region: id, calls: { ...r.calls } });
      base[id] = (base[id] ?? 0) + r.guests;
    }
  }
  return { ships, base, fare };
}

const rivalsOf = (s: GameState): RivalState => (s.fleet!.rivals ??= initRivals());
const weekBerths = (R: RivalState, region: string) => R.ships.filter(x => x.region === region).reduce((a, x) => a + x.guests, 0);

/** More rival berths in a region than at the start means fewer guests for you, and fewer means more. */
export function rivalShare(s: GameState, region: string): number {
  const R = s.fleet?.rivals;
  if (!R || !R.base[region]) return 1;
  return Math.min(1.15, Math.pow(R.base[region] / Math.max(1, weekBerths(R, region)), 0.35));
}

/** Port and weekday of every call your deployed ships make in a season. */
function playerCalls(s: GameState, idx: number): Set<string> {
  const out = new Set<string>();
  for (const sh of s.ships) {
    const a = assignmentFor(s, sh.id, idx);
    if (!a.dep) continue;
    const p = deploymentPlan(s, sh, a.dep, planningDay(idx) + a.dep.wait);
    if (!p || p.broken) continue;
    for (const c of p.calls) out.add(a.dep.region + '|' + c.id + '|' + c.weekday);
  }
  return out;
}

/**
 * The rivals answer the season. Crowd one of their port days and they may move the call, cut their
 * fares where you take a big share, or once a year launch a bigger ship where you are strongest.
 */
export function rivalTurn(s: GameState, rep: SeasonReport): RivalNews[] {
  const F = s.fleet!, R = rivalsOf(s), idx = rep.season;
  const rnd = mulberry(hashString('rivals:' + idx + ':' + F.startSeason));
  const news: RivalNews[] = [];
  const name = (line: string) => RIVALS.lines[line]?.name ?? line;
  const mine = playerCalls(s, idx);
  // Moves: a call that shares a port day with yours may shift to a free weekday.
  for (const r of R.ships) {
    const st = lineStyle(r.line);
    for (const [wd, port] of Object.entries(r.calls)) {
      if (!mine.has(r.region + '|' + port + '|' + wd) || rnd() >= st.move) continue;
      const P = REGIONS[r.region].ports[port];
      const free = [1, 2, 3, 4, 5, 6].map(k => (Number(wd) + k) % 7).find(d =>
        !r.calls[String(d)] && !mine.has(r.region + '|' + port + '|' + d) &&
        R.ships.filter(o => o.region === r.region && o.calls[String(d)] === port).length < (P?.berths ?? 99));
      if (free == null) continue;
      delete r.calls[wd];
      r.calls[String(free)] = port;
      news.push({ key: 'fleet.rival.move', line: r.line, vars: { line: name(r.line), ship: r.ship, port: P?.name ?? port, from: '@weekday.' + wd, to: '@weekday.' + free } });
    }
  }
  // Fares: where you carry a big share of the region's guests, the region's biggest line cuts.
  const guests: Record<string, number> = {};
  for (const x of rep.ships) guests[x.region] = (guests[x.region] ?? 0) + x.guests;
  for (const region of REGION_ORDER) {
    const cap = weekBerths(R, region) * 13;
    if (!cap) continue;
    const lead = RIVAL_LINE_IDS.map(l => ({ l, g: R.ships.filter(x => x.region === region && x.line === l).reduce((a, x) => a + x.guests, 0) })).sort((a, b) => b.g - a.g)[0].l;
    const pressure = (guests[region] ?? 0) / cap;
    // The harder you press, the likelier a cut, and each cut makes the next one harder for them to afford.
    const odds = Math.min(0.6, (pressure - PRESSURE) * 6) * ((R.fare[region] ?? 1) <= 0.85 ? 0.4 : 1);
    if (pressure > PRESSURE && rnd() < odds) {
      const before = R.fare[region] ?? 1;
      R.fare[region] = Math.max(FARE_FLOOR, Math.round(before * lineStyle(lead).cut * 100) / 100);
      if (R.fare[region] < before) news.push({ key: 'fleet.rival.cut', line: lead, vars: { line: name(lead), region: '@region.' + region, pct: Math.round((1 - R.fare[region] / before) * 100) } });
    } else if ((R.fare[region] ?? 1) < 1) {
      R.fare[region] = Math.min(1, Math.round(((R.fare[region] ?? 1) + 0.03) * 100) / 100);
      if (R.fare[region] === 1) news.push({ key: 'fleet.rival.recover', line: lead, vars: { line: name(lead), region: '@region.' + region } });
    }
  }
  // Launches: once a year, after the fall season, each line may add a bigger ship where you are strongest.
  if (seasonQuarter(idx) === 3) {
    const yearGuests: Record<string, number> = {};
    for (const r of F.reports.slice(-4)) for (const x of r.ships) yearGuests[x.region] = (yearGuests[x.region] ?? 0) + x.guests;
    for (const line of RIVAL_LINE_IDS) {
      const st = lineStyle(line), fleet = R.ships.filter(x => x.line === line);
      if (fleet.length >= LINE_CAP || rnd() >= st.launch) continue;
      const choices = st.prefer.filter(r => R.ships.some(x => x.region === r));
      if (!choices.length) continue;
      const region = choices.slice().sort((a, b) => (yearGuests[b] ?? 0) - (yearGuests[a] ?? 0))[0];
      const pattern = R.ships.filter(x => x.region === region);
      const model = pattern[Math.floor(rnd() * pattern.length)];
      const shift = 1 + Math.floor(rnd() * 6);
      const calls: Record<string, string> = {};
      for (const [wd, port] of Object.entries(model.calls)) calls[String((Number(wd) + shift) % 7)] = port;
      const used = new Set(R.ships.map(x => x.ship));
      const shipName = st.names.find(n => !used.has(n)) ?? name(line) + ' ' + (fleet.length + 1);
      const g = Math.round((st.guests[0] + rnd() * (st.guests[1] - st.guests[0])) / 100) * 100;
      R.ships.push({ ship: shipName, line, guests: g, region, calls });
      news.push({ key: 'fleet.rival.launch', line, vars: { line: name(line), ship: shipName, guests: g.toLocaleString('en-US'), region: '@region.' + region } });
      // A bigger line retires its smallest ship in the region to make room.
      const old = fleet.filter(x => x.region === region).sort((a, b) => a.guests - b.guests)[0];
      if (old && fleet.length >= RETIRE_AT && old.guests < g) {
        R.ships.splice(R.ships.indexOf(old), 1);
        news.push({ key: 'fleet.rival.retire', line, vars: { line: name(line), ship: old.ship } });
      }
    }
  }
  F.rivalsRev = (F.rivalsRev ?? 0) + 1;
  return news;
}

/** Ships, berths and the fare stance of each line, for the Fleet board. */
export function lineSummary(s: GameState) {
  const R = rivalsOf(s);
  return RIVAL_LINE_IDS.map(line => {
    const ships = R.ships.filter(x => x.line === line);
    const regions = [...new Set(ships.map(x => x.region))];
    return { line, name: RIVALS.lines[line].name, style: RIVALS.lines[line].style, ships: ships.length, berths: ships.reduce((a, x) => a + x.guests, 0), regions };
  });
}

// ---------- goals ----------

/** Cash plus what the fleet is worth: each ship at its build cost, losing a twentieth a year. */
export function companyValue(s: GameState): number {
  const day = seasonStart(s.fleet?.season ?? 0);
  return Math.round(s.cash + s.ships.reduce((a, sh) => a + HULLS[sh.design.hull].commissionFee * 4 * Math.max(0.2, 1 - ageYears(sh, day) / 20), 0));
}

export interface FleetGoal { id: string; done: boolean; vars: Vars }
export function fleetGoals(s: GameState): FleetGoal[] {
  const F = s.fleet!, years = (F.season - F.startSeason) / 4, value = companyValue(s);
  const regions = new Set(s.ships.map(sh => assignmentFor(s, sh.id, F.season - 1).dep?.region).filter(Boolean));
  return [
    { id: 'size', done: s.ships.length >= 12, vars: { n: s.ships.length, of: 12 } },
    { id: 'rep', done: s.rep >= 4.8, vars: { have: s.rep.toFixed(1), want: '4.8' } },
    { id: 'world', done: regions.size >= REGION_ORDER.length, vars: { n: regions.size, of: REGION_ORDER.length } },
    { id: 'value', done: value >= 500_000_000, vars: { have: '$' + Math.round(value / 1e6) + 'M', want: '$500M' } },
    { id: 'decade', done: years >= 10, vars: { n: Math.floor(years), of: 10 } },
  ];
}

// ---------- starting a fleet game ----------

export function initFleet(s: GameState, season: number): void {
  s.fleet = { season, plans: {}, reports: [], startSeason: season, id: Math.random().toString(36).slice(2, 10), rivalsRev: 0 };
  s.fleet.rivals = initRivals();
  for (const sh of s.ships) {
    sh.region ??= s.region;
    sh.built ??= 0;
    sh.docked ??= sh.built;
    sh.day = Math.max(sh.day, seasonStart(season));
  }
}

/** Carry a finished campaign on into fleet mode. */
export function toFleet(s: GameState): void {
  s.mode = 'fleet';
  s.tutorial.off = true;
  // The chartered Puffin goes back to its owner, unless it is all the company has.
  if (s.ships.some(sh => !sh.chartered)) s.ships = s.ships.filter(sh => !sh.chartered);
  for (const sh of s.ships) sh.chartered = false;
  initFleet(s, seasonAt(Math.max(...s.ships.map(x => x.day))) + 1);
}

/** A fresh fleet game: five ships, one in each region plus a veteran, and money to grow. */
export function newFleetGame(): GameState {
  const s = newGame('campaign');
  s.mode = 'fleet';
  s.company = 'Harbor Light Cruise Co.';
  s.tutorial.off = true;
  s.unlocked.drydock = true;
  s.unlocked.hulls = Object.keys(HULLS);
  s.unlocked.fleet = true;
  s.dpEarned = 30;
  s.rep = 3.5;
  s.cash = 40_000_000;
  const sb = newGame('sandbox');
  for (const name of ['MS Northern Crown', 'MS Harbor Majesty', 'MV Northern Tern', 'MS Atlantic Sovereign']) {
    if (s.blueprints.some(b => b.name === name)) continue;
    const bp = sb.blueprints.find(b => b.name === name)!;
    s.blueprints.push({ id: nextId(s, 'bp'), name, design: cloneDesign(bp.design) });
  }
  const season = seasonAt(dayOf(2032, 1, 15));
  const day0 = seasonStart(season) - 1;
  s.ships = [];
  const add = (bpName: string, region: string, port: string, age: number) => {
    const bp = s.blueprints.find(b => b.name === bpName)!;
    report(s, bp.design);
    runTrial(s, bp.id);
    s.region = region;
    const r = commission(s, bp.id, port);
    if (!('ship' in r)) throw new Error('fleet start: ' + bpName);
    r.ship.built = day0 - Math.round(age * 365);
    r.ship.docked = day0 - Math.round(Math.min(age, 2) * 365);
    r.ship.day = day0;
    r.ship.region = region;
  };
  add('MV Puffin', 'northeast', 'BOS', 12);
  add('MS Northern Crown', 'caribbean', 'MIA', 6);
  add('MS Harbor Majesty', 'caribbean', 'MIA', 1);
  add('MV Northern Tern', 'alaska', 'YVR', 2);
  add('MS Atlantic Sovereign', 'europe', 'BCN', 0);
  s.cash = 40_000_000;
  s.region = 'caribbean';
  s.plan = { shipId: s.ships[0].id, nights: 7, wait: 0, stops: [], end: s.ships[0].port, fare: 200 };
  initFleet(s, season);
  starterPlans(s);
  return s;
}

/** A first year pencilled in, so the board opens ready to run: winter in the sun, summer up north. */
const STARTER_PLANS: Record<string, [number, string, string, string[], number][] | 'layup'> = {
  'MV Puffin': [[0, 'layup', '', [], 0], [2, 'northeast', 'BOS', ['BHB', 'HFX'], 4]],
  'MS Northern Crown': [[0, 'caribbean', 'MIA', ['NAS', 'CZM', 'GCM'], 7], [2, 'northeast', 'BOS', ['BHB', 'HFX'], 4]],
  'MS Harbor Majesty': [[0, 'caribbean', 'MIA', ['NAS', 'CZM', 'GCM'], 7], [2, 'europe', 'BCN', ['PMI', 'MRS', 'VFR', 'LIV'], 7]],
  'MV Northern Tern': [[0, 'caribbean', 'MIA', ['NAS', 'EYW'], 4], [2, 'alaska', 'YVR', ['KTN', 'JNU', 'SGY'], 7], [3, 'caribbean', 'MIA', ['NAS', 'EYW'], 4]],
  'MS Atlantic Sovereign': [[0, 'layup', '', [], 0], [1, 'europe', 'BCN', ['PMI', 'MRS', 'VFR', 'LIV'], 7]],
};

export function starterPlans(s: GameState): void {
  const idx0 = s.fleet!.season;
  for (const sh of s.ships) {
    const list = STARTER_PLANS[sh.name];
    if (!list || list === 'layup') continue;
    for (const [k, region, from, stops, nights] of list) {
      if (region === 'layup') { setLayup(s, sh.id, idx0 + k); continue; }
      const dep: Deployment = { region, from, stops, nights, fare: REGIONS[region].market.rivalFare, wait: 0, lowSulfur: true };
      const p = deploymentPlan(s, sh, dep, planningDay(idx0 + k));
      const share = crowdShare(regionLoad(s, idx0 + k)[region] ?? 1);
      // A starter plan that breaks a rule other than the season being closed would only teach the wrong thing.
      if (!p || p.issues.some(i => i.lvl === 'err' && i.key !== 'plan.offSeason' && i.key !== 'plan.seasonEnds')) continue;
      if (!p.errors) dep.fare = bestFare(REGIONS[region], p.input.ship, summarise(p), { rep: s.rep, demandBonus: s.demandBonus, share }).fare;
      setDeployment(s, sh.id, idx0 + k, dep);
    }
    // Ships due for drydock this year go in during spring, before the busy summer.
    if (dockDue(sh) < seasonStart(idx0 + 2)) toggleDock(s, sh.id, idx0 + 1);
  }
}
