// Game state and the actions that change it: build, commission, plan, sail, unlock.
// The sim modules stay pure; this layer applies their results to the save.
import { BLOCKS, FIRST_DP, HULLS, MILESTONES, REGIONS, TECH, type Region } from './data';
import starters from '../../data/starters.json';
import { analyse, designHash, refitCost, type Design, type DesignReport, type Placed, type ShipSpecs } from './ship';
import { seaTrial, type TrialResult, type TrialKind } from './trial';
import { planVoyage, turnarounds, type Plan } from './planner';
import { fairFare, finance, summarise, type Finance, type Market } from './economy';
import { planSeed, rollEvents, type VoyageEvent } from './events';
import { canBuy, dpSpent, techMods, type TechMods } from './tech';
import { nextOpenDay, seasonCloseDay, seasonOf } from './calendar';
import { checkCrossing, type CrossingCheck } from './crossing';
import type { Vars } from './strings';

export const SAVE_VERSION = 2;
export const SANDBOX_CASH = 999_999_999;
export const START_CASH = 300_000;
export const START_REP = 3.0;
export const BUILD_DAYS = 7;
export const REFIT_DAYS = 4;
export const LAYUP_NIGHTS = 10;
export const MAX_WAIT = 6;
export const ISLAND_LEASE = 1_500_000;
/** Bookings at or above this count as "booked full" for milestones. */
export const FULL_OCC = 0.95;

export interface Blueprint {
  id: string; name: string; design: Design;
  trial?: { hash: string; kind: TrialKind; maxHeel: number };
}
export interface ShipRec {
  id: string; name: string; blueprintId: string | null; design: Design;
  port: string; day: number; voyages: number; chartered?: boolean;
}
export interface LogEntry {
  n: number; day: number; region: string; season?: string; shipId: string; ship: string; route: string[]; nights: number;
  booked: number; pax: number; fare: number; profit: number; sat: number;
  events: { key: string; vars: Vars; good: boolean }[];
}
export interface PlanDraft { shipId: string; nights: number; wait: number; stops: string[]; end: string; fare: number }

export interface GameState {
  version: number;
  mode: 'campaign' | 'sandbox';
  company: string;
  region: string;
  cash: number; rep: number;
  dpEarned: number; tech: string[]; firsts: string[]; milestones: string[];
  unlocked: { drydock: boolean; hulls: string[]; portGroups: string[] };
  demandBonus: number;
  blueprints: Blueprint[]; ships: ShipRec[]; log: LogEntry[]; voyages: number;
  plan: PlanDraft;
  tutorial: { step: number; off: boolean };
  /** One-time prompts already shown for new mechanics. */
  hints: string[];
  seq: number;
}

type StarterBlock = [string, number, number, number, number];

export function placedFrom(raw: StarterBlock[], prefix = 'b'): Placed[] {
  return raw.map(([type, deck, c, r, rot], i) => {
    const t = BLOCKS[type];
    return { uid: prefix + i, type, deck, c, r, w: rot ? t.h : t.w, h: rot ? t.w : t.h };
  });
}

type StarterKey = 'puffin' | 'harbor' | 'crown' | 'majesty';
const STARTERS = starters as unknown as Record<StarterKey, { name: string; hull: string; blocks: StarterBlock[] }>;

function starter(key: StarterKey): Design {
  const s = STARTERS[key];
  return { hull: s.hull, blocks: placedFrom(s.blocks, key[0]) };
}

/** A hull unlock comes with a template design to start from. */
const HULL_TEMPLATE: Record<string, StarterKey> = { liner: 'crown', mega: 'majesty' };

function addTemplate(s: GameState, hull: string): void {
  const key = HULL_TEMPLATE[hull];
  if (!key || s.blueprints.some(b => b.name === STARTERS[key].name)) return;
  s.blueprints.push({ id: nextId(s, 'bp'), name: STARTERS[key].name, design: starter(key) });
}

export function cloneDesign(d: Design): Design {
  return { hull: d.hull, blocks: d.blocks.map(b => ({ ...b })) };
}

export function newGame(mode: 'campaign' | 'sandbox' = 'campaign'): GameState {
  const puffin = starter('puffin');
  const sandbox = mode === 'sandbox';
  const s: GameState = {
    version: SAVE_VERSION, mode, company: 'Harbor Light Cruise Co.', region: 'northeast',
    cash: sandbox ? SANDBOX_CASH : START_CASH, rep: START_REP,
    dpEarned: 0, tech: sandbox ? TECH.nodes.map(n => n.id) : [], firsts: [], milestones: [],
    unlocked: { drydock: sandbox, hulls: sandbox ? Object.keys(HULLS) : ['coastal'], portGroups: [] },
    demandBonus: 0,
    blueprints: [
      { id: 'bp1', name: 'MV Puffin', design: cloneDesign(puffin) },
      { id: 'bp2', name: 'MV Harbor Light', design: starter('harbor') },
    ],
    ships: [{ id: 's1', name: 'MV Puffin', blueprintId: 'bp1', design: cloneDesign(puffin), port: 'BOS', day: 0, voyages: 0, chartered: true }],
    log: [], voyages: 0,
    plan: { shipId: 's1', nights: 4, wait: 0, stops: [], end: 'BOS', fare: 400 },
    tutorial: { step: 0, off: sandbox },
    hints: [],
    seq: 10,
  };
  // The Puffin's trial is on file, so it can be copied and refit straight away.
  const r = analyse(puffin);
  const tr = seaTrial(r.specs);
  s.blueprints[0].trial = { hash: designHash(puffin), kind: tr.kind, maxHeel: tr.maxHeel };
  if (sandbox) for (const h of s.unlocked.hulls) addTemplate(s, h);
  return s;
}

export function nextId(s: GameState, prefix: string): string {
  s.seq += 1;
  return prefix + s.seq;
}

export const isSandbox = (s: GameState) => s.mode === 'sandbox';
export const regionOf = (s: GameState): Region => REGIONS[s.region];
export const mods = (s: GameState): TechMods => techMods(s.tech);
export const dpAvailable = (s: GameState) => s.dpEarned - dpSpent(s.tech);
export const shipById = (s: GameState, id: string) => s.ships.find(x => x.id === id);
export const bpById = (s: GameState, id: string) => s.blueprints.find(x => x.id === id);

const reportCache = new Map<string, DesignReport>();
export function report(s: GameState, d: Design): DesignReport {
  const key = designHash(d) + '|' + s.tech.join(',');
  let r = reportCache.get(key);
  if (!r) {
    r = analyse(d, mods(s));
    if (reportCache.size > 200) reportCache.clear();
    reportCache.set(key, r);
  }
  return r;
}
export const specsOf = (s: GameState, ship: ShipRec): ShipSpecs => report(s, ship.design).specs;

/** "Now" for the company: the day the next ship is free to sail. */
export function companyDay(s: GameState): number {
  return s.ships.length ? Math.min(...s.ships.map(x => x.day)) : 0;
}

// ---------- Drydock ----------

export function trialStatus(_s: GameState, bp: Blueprint): 'none' | 'stale' | 'passed' | 'failed' {
  if (!bp.trial) return 'none';
  if (bp.trial.hash !== designHash(bp.design)) return 'stale';
  return bp.trial.kind === 'err' ? 'failed' : 'passed';
}

export interface TrialRun { inspection: DesignReport; result: TrialResult | null; firsts: string[] }

/** Inspection gate, then the trial. A failed trial costs nothing but time. */
export function runTrial(s: GameState, bpId: string): TrialRun {
  const bp = bpById(s, bpId);
  if (!bp) throw new Error('No blueprint ' + bpId);
  const rep = report(s, bp.design);
  if (rep.errors) return { inspection: rep, result: null, firsts: [] };
  const result = seaTrial(rep.specs);
  bp.trial = { hash: designHash(bp.design), kind: result.kind, maxHeel: result.maxHeel };
  const firsts: string[] = [];
  if (!result.capsize) earnFirst(s, 'trial', firsts);
  return { inspection: rep, result, firsts };
}

export function commissionCost(s: GameState, d: Design): number {
  return HULLS[d.hull].commissionFee + report(s, d).fitOut;
}

export type Check = { ok: true } | { ok: false; key: string; vars?: Vars };

export function canCommission(s: GameState, bp: Blueprint): Check {
  if (!s.unlocked.hulls.includes(bp.design.hull)) return { ok: false, key: 'drydock.commission.hullLocked' };
  if (report(s, bp.design).errors) return { ok: false, key: 'drydock.commission.inspection' };
  if (trialStatus(s, bp) !== 'passed') return { ok: false, key: 'drydock.commission.trial' };
  const cost = commissionCost(s, bp.design);
  if (!isSandbox(s) && s.cash < cost) return { ok: false, key: 'drydock.commission.cash', vars: { cost } };
  return { ok: true };
}

export function commission(s: GameState, bpId: string, port: string): { ship: ShipRec; firsts: string[] } | Check {
  const bp = bpById(s, bpId);
  if (!bp) return { ok: false, key: 'drydock.commission.trial' };
  const c = canCommission(s, bp);
  if (!c.ok) return c;
  if (!isSandbox(s)) s.cash -= commissionCost(s, bp.design);
  const ship: ShipRec = {
    id: nextId(s, 's'), name: uniqueShipName(s, bp.name), blueprintId: bp.id, design: cloneDesign(bp.design),
    port, day: companyDay(s) + BUILD_DAYS, voyages: 0,
  };
  s.ships.push(ship);
  const firsts: string[] = [];
  earnFirst(s, 'commission', firsts);
  return { ship, firsts };
}

function uniqueShipName(s: GameState, name: string): string {
  if (!s.ships.some(x => x.name === name)) return name;
  for (let i = 2; ; i++) if (!s.ships.some(x => x.name === name + ' ' + toRoman(i))) return name + ' ' + toRoman(i);
}
function toRoman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}

export function refitQuote(s: GameState, ship: ShipRec): { bp: Blueprint; cost: number } | null {
  const bp = ship.blueprintId ? bpById(s, ship.blueprintId) : undefined;
  if (!bp || bp.design.hull !== ship.design.hull) return null;
  if (designHash(bp.design) === designHash(ship.design)) return null;
  return { bp, cost: refitCost(ship.design, bp.design) };
}

export function canRefit(s: GameState, ship: ShipRec): Check {
  const q = refitQuote(s, ship);
  if (!q) return { ok: false, key: 'drydock.refit.none' };
  if (report(s, q.bp.design).errors) return { ok: false, key: 'drydock.commission.inspection' };
  if (trialStatus(s, q.bp) !== 'passed') return { ok: false, key: 'drydock.commission.trial' };
  if (!isSandbox(s) && s.cash < q.cost) return { ok: false, key: 'drydock.commission.cash', vars: { cost: q.cost } };
  return { ok: true };
}

/** A refit takes one cruise slot and costs 30% of the changed blocks. */
export function refit(s: GameState, shipId: string): Check {
  const ship = shipById(s, shipId);
  if (!ship) return { ok: false, key: 'drydock.refit.none' };
  const c = canRefit(s, ship);
  if (!c.ok) return c;
  const q = refitQuote(s, ship)!;
  if (!isSandbox(s)) s.cash -= q.cost;
  ship.design = cloneDesign(q.bp.design);
  ship.day += REFIT_DAYS;
  return { ok: true };
}

// ---------- Chartroom ----------

export function openGroups(s: GameState): string[] {
  return s.unlocked.portGroups;
}

export function draftPlan(s: GameState, draft: PlanDraft = s.plan): Plan | null {
  const ship = shipById(s, draft.shipId);
  if (!ship) return null;
  return planVoyage({
    region: regionOf(s), ship: specsOf(s, ship), start: ship.port, stops: draft.stops, end: draft.end,
    nights: draft.nights, departDay: ship.day + draft.wait, openGroups: openGroups(s), sandbox: isSandbox(s), tech: mods(s),
  });
}

export const market = (s: GameState): Market => ({ rep: s.rep, demandBonus: s.demandBonus });

export function planFinance(s: GameState, plan: Plan, fare: number = s.plan.fare): Finance {
  return finance(regionOf(s), plan.input.ship, summarise(plan, s.plan.wait), fare, market(s));
}

/** Make the draft consistent after the ship or its port changes. */
export function normalisePlan(s: GameState): void {
  const p = s.plan;
  let ship = shipById(s, p.shipId);
  if (!ship) { ship = s.ships[0]; p.shipId = ship.id; }
  const region = regionOf(s);
  if (!region.ports[p.end]?.turnaround) p.end = region.ports[ship.port]?.turnaround ? ship.port : turnarounds(region)[0];
  p.wait = Math.max(0, Math.min(MAX_WAIT, p.wait));
}

export interface VoyageResult {
  plan: Plan; fin: Finance; events: VoyageEvent[]; sat: number; profit: number; extra: number;
  repBefore: number; repAfter: number; cashBefore: number; cashAfter: number;
  milestones: string[]; firsts: string[]; dp: number; shipId: string; logN: number;
}

/** Satisfaction comes from appeal, the ship's venues, fare against a fair price, and events. */
export function voyageSat(plan: Plan, fare: number, events: VoyageEvent[]): number {
  const ship = plan.input.ship;
  const fair = fairFare(plan.score, ship.luxury);
  let sat = 30 + plan.score * 0.4 + ship.shipSat * 0.35 - Math.max(0, (fare - fair) / 8);
  for (const e of events) sat += e.sat;
  return Math.max(0, Math.min(100, Math.round(sat)));
}

export function sail(s: GameState): VoyageResult | null {
  const plan = draftPlan(s);
  const ship = shipById(s, s.plan.shipId);
  if (!plan || !ship || plan.errors) return null;
  const fare = s.plan.fare;
  const fin = planFinance(s, plan, fare);
  const events = rollEvents(plan, plan.input.ship, fin.booked, planSeed(plan, ship.id), mods(s));
  const sat = voyageSat(plan, fare, events);
  const extra = events.reduce((a, e) => a + e.cost, 0);
  const profit = Math.round(fin.profit - extra);
  const repBefore = s.rep, cashBefore = s.cash;

  if (!isSandbox(s)) s.cash += profit;
  s.voyages += 1;
  s.rep = Math.round(Math.max(1, Math.min(5, s.rep + Math.max(-0.5, Math.min(0.5, (sat - 65) / 30)))) * 10) / 10;
  ship.port = plan.input.end;
  ship.day = plan.input.departDay + plan.input.nights;
  ship.voyages += 1;

  const cancelled = new Set(events.map(e => e.cancelsCall).filter(Boolean));
  const visited = plan.calls.map(c => c.id).filter(id => !cancelled.has(id));
  const region = regionOf(s);
  s.log.push({
    n: s.voyages, day: plan.input.departDay, region: region.id, season: plan.season?.id, shipId: ship.id, ship: ship.name,
    route: [plan.input.start, ...plan.calls.map(c => c.id), plan.input.end], nights: plan.input.nights,
    booked: fin.booked, pax: plan.input.ship.pax, fare, profit, sat,
    events: events.map(e => ({ key: e.key, vars: e.vars, good: e.good })),
  });
  if (s.log.length > 60) s.log.shift();

  // Firsts: the first time you do something notable earns design points.
  const firsts: string[] = [];
  earnFirst(s, 'region:' + region.id, firsts);
  for (const id of [...visited, plan.input.end]) earnFirst(s, 'port:' + id, firsts);
  if (fin.booked >= plan.input.ship.pax && plan.input.ship.pax > 0) earnFirst(s, 'soldout', firsts);
  if (fin.booked > 1000) earnFirst(s, 'thousand', firsts);
  if (plan.canals.length) earnFirst(s, 'canal', firsts);
  if (plan.scenic.length) earnFirst(s, 'scenic', firsts);
  if (plan.season?.id === 'fall') earnFirst(s, 'fall', firsts);
  if (plan.input.nights >= 7) earnFirst(s, 'long', firsts);
  if (plan.input.end !== plan.input.start) earnFirst(s, 'reposition', firsts);
  if (plan.calls.some(c => region.ports[c.id].berth === 'tender' && !cancelled.has(c.id))) earnFirst(s, 'tender', firsts);
  if (plan.calls.some(c => c.refuel)) earnFirst(s, 'refuel', firsts);
  if (profit >= 100000) earnFirst(s, 'sixfig', firsts);
  if (plan.season?.id === 'hurricane' && profit > 0) earnFirst(s, 'hurricane', firsts);

  const milestones = checkMilestones(s, {
    profit, visited: [...visited, plan.input.end], booked: fin.booked, pax: plan.input.ship.pax,
    season: plan.season?.id ?? '', day: plan.input.departDay,
  });
  normalisePlan(s);
  return {
    plan, fin, events, sat, profit, extra, repBefore, repAfter: s.rep, cashBefore, cashAfter: s.cash,
    milestones, firsts, dp: firsts.reduce((a, f) => a + firstDp(f), 0), shipId: ship.id, logN: s.voyages,
  };
}

export function firstDp(id: string): number {
  return FIRST_DP[id.split(':')[0]] ?? 0;
}

function earnFirst(s: GameState, id: string, into: string[]): void {
  if (s.firsts.includes(id)) return;
  s.firsts.push(id);
  s.dpEarned += firstDp(id);
  into.push(id);
}

export interface VoyageFacts { profit: number; visited: string[]; booked?: number; pax?: number; season?: string; day?: number }

/** Guests carried by full-booked cruises departing in the 7 days up to `day`, in this region. */
export function weekGuests(s: GameState, day: number): number {
  return s.log.filter(v => v.region === s.region && v.day <= day && v.day > day - 7 && v.pax > 0 && v.booked / v.pax >= FULL_OCC)
    .reduce((a, v) => a + v.booked, 0);
}

export function checkMilestones(s: GameState, v: VoyageFacts = { profit: -Infinity, visited: [] }): string[] {
  const gained: string[] = [];
  const list = MILESTONES[s.region] ?? [];
  // Two passes: a cash reward can complete a cash milestone.
  for (let pass = 0; pass < 2; pass++) {
    for (const m of list) {
      if (s.milestones.includes(m.id)) continue;
      const T = m.test;
      const ok = (T.voyages == null || s.voyages >= T.voyages)
        && (T.visit == null || v.visited.includes(T.visit))
        && (T.profit == null || v.profit >= T.profit)
        && (T.cash == null || s.cash >= T.cash)
        && (T.rep == null || s.rep >= T.rep)
        && (T.regionVoyages == null || s.log.filter(x => x.region === s.region).length >= T.regionVoyages)
        && (T.soldOutPax == null || (v.booked != null && v.pax != null && v.booked >= v.pax && v.booked >= T.soldOutPax))
        && (T.island == null || s.unlocked.portGroups.includes('island'))
        && (T.stormProfits == null || s.log.filter(x => x.region === s.region && x.season === 'hurricane' && x.profit > 0).length >= T.stormProfits)
        && (T.weekGuests == null || (v.day != null && weekGuests(s, v.day) >= T.weekGuests));
      if (!ok) continue;
      s.milestones.push(m.id);
      gained.push(m.id);
      const R = m.reward;
      if (R.cash && !isSandbox(s)) s.cash += R.cash;
      if (R.unlock === 'drydock') s.unlocked.drydock = true;
      if (R.unlockPorts && !s.unlocked.portGroups.includes(R.unlockPorts)) s.unlocked.portGroups.push(R.unlockPorts);
      if (R.unlockHull && !s.unlocked.hulls.includes(R.unlockHull)) { s.unlocked.hulls.push(R.unlockHull); addTemplate(s, R.unlockHull); }
      if (R.demand) s.demandBonus += R.demand;
    }
  }
  return gained;
}

/** The current goal for the title bar: the next open milestone, then the graduation voyage. */
export function currentGoal(s: GameState): string | null {
  const m = (MILESTONES[s.region] ?? []).find(x => !s.milestones.includes(x.id));
  if (m) return m.id;
  const g = regionOf(s).graduation;
  return g && !s.milestones.includes(g.id) ? g.id : null;
}

// ---------- Graduation: the voyage that ends a chapter ----------

export function graduationOpen(s: GameState): boolean {
  const g = regionOf(s).graduation;
  if (!g || g.locked || !g.toRegion) return false;
  return isSandbox(s) || !g.requires || s.milestones.includes(g.requires);
}

export function crossingFor(s: GameState, ship: ShipRec): CrossingCheck {
  const g = regionOf(s).graduation!;
  const c = checkCrossing(g, ship.port, specsOf(s, ship));
  if (ship.chartered) c.issues.unshift({ lvl: 'err', key: 'cross.chartered' }), c.ok = false;
  return c;
}

export interface GraduationResult {
  from: string; to: string; ships: string[]; left: string[];
  cashBefore: number; cashAfter: number; repBefore: number; repAfter: number; firsts: string[];
}

/**
 * Sail the chosen ships to the next region and start the next chapter. Tech, design points and
 * blueprints carry over. Most cash resets, reputation is pulled halfway back to 3.0, and leases on
 * ships left behind end.
 */
export function graduate(s: GameState, shipIds: string[]): GraduationResult | Check {
  if (!graduationOpen(s)) return { ok: false, key: 'cross.notYet' };
  const region = regionOf(s), g = region.graduation!;
  const going = s.ships.filter(x => shipIds.includes(x.id));
  if (!going.length) return { ok: false, key: 'cross.pickShip' };
  for (const sh of going) if (!crossingFor(s, sh).ok) return { ok: false, key: 'cross.notReady', vars: { ship: sh.name } };
  const res: GraduationResult = {
    from: region.id, to: g.toRegion!, ships: going.map(x => x.name), left: s.ships.filter(x => !shipIds.includes(x.id)).map(x => x.name),
    cashBefore: s.cash, cashAfter: s.cash, repBefore: s.rep, repAfter: s.rep, firsts: [],
  };
  for (const sh of going) {
    const c = crossingFor(s, sh);
    sh.day = sh.day + Math.ceil((17 + c.hours) / 24);
    sh.port = g.toPort!;
  }
  s.ships = going;
  s.milestones.push(g.id);
  if (!isSandbox(s)) s.cash = Math.round(s.cash * (g.keepCash ?? 0.25)) + (g.grant ?? 0);
  s.rep = Math.round((s.rep + START_REP) / 2 * 10) / 10;
  s.region = g.toRegion!;
  earnFirst(s, 'crossing', res.firsts);
  s.plan = { shipId: going[0].id, nights: 7, wait: 0, stops: [], end: g.toPort!, fare: 180 };
  res.cashAfter = s.cash;
  res.repAfter = s.rep;
  return res;
}

/** Sandbox only: move the whole fleet to another region's first turnaround port. */
export function moveRegion(s: GameState, regionId: string): Check {
  if (!isSandbox(s) || !REGIONS[regionId]) return { ok: false, key: 'cross.notYet' };
  const port = turnarounds(REGIONS[regionId])[0];
  s.region = regionId;
  for (const sh of s.ships) sh.port = port;
  s.plan.stops = [];
  s.plan.end = port;
  return { ok: true };
}

// ---------- Private island ----------

export function canLeaseIsland(s: GameState): Check {
  const region = regionOf(s);
  if (!Object.values(region.ports).some(p => p.lockedBy === 'island')) return { ok: false, key: 'company.island.none' };
  if (s.unlocked.portGroups.includes('island')) return { ok: false, key: 'company.island.owned' };
  if (!isSandbox(s) && s.cash < ISLAND_LEASE) return { ok: false, key: 'drydock.commission.cash', vars: { cost: ISLAND_LEASE } };
  return { ok: true };
}

export function leaseIsland(s: GameState): { milestones: string[]; firsts: string[] } | Check {
  const c = canLeaseIsland(s);
  if (!c.ok) return c;
  if (!isSandbox(s)) s.cash -= ISLAND_LEASE;
  s.unlocked.portGroups.push('island');
  const firsts: string[] = [];
  earnFirst(s, 'island', firsts);
  return { milestones: checkMilestones(s), firsts };
}

// ---------- Season ----------

/** True when the ship can't fit even a 3-night cruise before the season closes. */
export function seasonOver(s: GameState, ship: ShipRec): boolean {
  const region = regionOf(s);
  if (!seasonOf(region, ship.day)) return true;
  return ship.day + 3 > seasonCloseDay(region, ship.day);
}

export function layUpCost(_s: GameState, ship: ShipRec): number {
  return HULLS[ship.design.hull].leasePerNight * LAYUP_NIGHTS;
}

/** Winter lay-up: the ship waits in port until the season reopens. */
export function layUp(s: GameState, shipId: string): Check {
  const ship = shipById(s, shipId);
  if (!ship || !seasonOver(s, ship)) return { ok: false, key: 'chart.layup.notYet' };
  if (!isSandbox(s)) s.cash -= layUpCost(s, ship);
  ship.day = nextOpenDay(regionOf(s), ship.day);
  return { ok: true };
}

// ---------- Tech ----------

export function buyTech(s: GameState, id: string): Check {
  const c = canBuy(id, s.tech, dpAvailable(s));
  if (!c.ok) return { ok: false, key: 'company.tech.cant.' + c.why };
  s.tech.push(id);
  return { ok: true };
}

// ---------- Blueprints ----------

export function newBlueprint(s: GameState, hull: string, name: string): Blueprint {
  const bp: Blueprint = { id: nextId(s, 'bp'), name, design: { hull, blocks: [] } };
  s.blueprints.push(bp);
  return bp;
}

export function copyBlueprint(s: GameState, bpId: string, name: string): Blueprint | null {
  const src = bpById(s, bpId);
  if (!src) return null;
  const bp: Blueprint = { id: nextId(s, 'bp'), name, design: cloneDesign(src.design), trial: src.trial ? { ...src.trial } : undefined };
  s.blueprints.push(bp);
  return bp;
}

export function deleteBlueprint(s: GameState, bpId: string): void {
  s.blueprints = s.blueprints.filter(b => b.id !== bpId);
  for (const sh of s.ships) if (sh.blueprintId === bpId) sh.blueprintId = null;
}
