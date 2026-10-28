// Ship design rules and readouts. Pure functions: same design in, same report out.
import { BLOCKS, HULLS, type Hull, type Role } from './data';
import { NO_TECH, type TechMods } from './tech';
import type { Vars } from './strings';

export interface Placed { uid: string; type: string; deck: number; c: number; r: number; w: number; h: number }
export interface Design { hull: string; blocks: Placed[]; options?: { ice?: boolean } }

/** An ice belt fitted to a hull that wasn't built with one: weight low in the hull, and a cost. */
export const ICE_BELT_SHARE = 0.06;
export const ICE_BELT_COST = 250000;

export type Level = 'err' | 'warn';
export interface Issue { lvl: Level; key: string; vars?: Vars; uids: string[]; deck: number | null }

/** Everything the Chartroom and the economy need to know about a built ship. */
export interface ShipSpecs {
  hull: string; pax: number; crew: number; draft: number; air: number; length: number; beam: number;
  vmax: number; burnPerNm: number; fuelCap: number; hotelTph: number; foodDays: number;
  gm: number; listDeg: number; rollK: number; galeK: number;
  shipSat: number; spend: number; luxury: number; scenic: number; lease: number;
  souls: number; fitOut: number;
  /** Can approach glacier faces through ice. */
  ice: boolean;
  /** Exhaust is clean enough for an emissions control area without low-sulfur fuel. */
  scrubber: boolean; lng: boolean;
  /** Guests the zodiacs can land in a day. */
  zodiacSeats: number;
}

export interface DesignReport {
  issues: Issue[]; flags: Map<string, Level>; errors: number; warnings: number;
  pax: number; beds: number; crewNeed: number; souls: number;
  supply: number; demand: number; lifeboatSeats: number; seats: number;
  weight: number; kg: number; km: number; gm: number; listDeg: number | null;
  fuelCap: number; fuelDays: number; provisions: number; foodDays: number; endurance: number;
  sat: number; spend: number; luxury: number; fitOut: number;
  specs: ShipSpecs;
}

export const STAIR_REACH = 5;
export const GM_MIN = 0.6;
export const LIST_MAX = 3;
/** Tonnes of fuel per kW of hotel load per hour. */
export const HOTEL_T_PER_KWH = 0.00011;
export const BASE_SPEND = 55;
/** Guests one venue serves before a second one is needed. */
export const VENUE_SERVES = 300;

const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function hullOf(d: Design | string): Hull {
  const id = typeof d === 'string' ? d : d.hull;
  const h = HULLS[id];
  if (!h) throw new Error('Unknown hull ' + id);
  return h;
}

export function inShape(hull: Hull, deck: number, c: number, r: number): boolean {
  const dk = hull.decks[deck - 1];
  if (!dk || r < 0 || r >= hull.rows || c < 0 || c >= hull.cols) return false;
  return dk.mask[r][c] === '#';
}

export function isOuter(hull: Hull, deck: number, c: number, r: number): boolean {
  return N4.some(([dc, dr]) => !inShape(hull, deck, c + dc, r + dr));
}

export function roleFits(hull: Hull, type: string, deck: number): boolean {
  const roles = BLOCKS[type].roles;
  if (roles.includes('any')) return true;
  const dk = hull.decks[deck - 1];
  return !!dk && roles.some(r => dk.roles.includes(r as Role));
}

export function decksFor(hull: Hull, type: string): number[] {
  return hull.decks.map((_, i) => i + 1).filter(d => roleFits(hull, type, d));
}

export function fixedBlocks(hull: Hull): Placed[] {
  return hull.fixed.map((f, i) => ({ uid: 'F' + i, type: f.type, deck: f.deck, c: f.c, r: f.r, w: f.w, h: f.h }));
}

function fixedWeight(hull: Hull, b: Placed): number {
  const i = Number(b.uid.slice(1));
  return hull.fixed[i]?.wt ?? BLOCKS[b.type].wt;
}

export function cellsOf(b: Placed): [number, number][] {
  const a: [number, number][] = [];
  for (let i = 0; i < b.w; i++) for (let j = 0; j < b.h; j++) a.push([b.c + i, b.r + j]);
  return a;
}

export function occupancy(blocks: Placed[], deck: number, ignoreUid?: string | null): Map<string, Placed> {
  const m = new Map<string, Placed>();
  for (const b of blocks) {
    if (b.deck !== deck || b.uid === ignoreUid) continue;
    for (const [c, r] of cellsOf(b)) m.set(c + ',' + r, b);
  }
  return m;
}

export type PlaceCheck = { ok: true } | { ok: false; key: string; vars?: Vars };

/** Can this block go here? Red, can't place: outside the hull, overlapping, or the wrong deck. */
export function canPlace(design: Design, type: string, deck: number, c: number, r: number, w: number, h: number, ignoreUid?: string | null): PlaceCheck {
  const hull = hullOf(design);
  if (!roleFits(hull, type, deck)) {
    return { ok: false, key: 'drydock.place.wrongDeck', vars: { name: '@block.' + type + '.name', decks: decksFor(hull, type).join(', ') } };
  }
  const occ = occupancy(fixedBlocks(hull).concat(design.blocks), deck, ignoreUid);
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
    if (!inShape(hull, deck, c + i, r + j)) return { ok: false, key: 'drydock.place.outside' };
    if (occ.has((c + i) + ',' + (r + j))) return { ok: false, key: 'drydock.place.taken' };
  }
  return { ok: true };
}

function touchesType(occ: Map<string, Placed>, b: Placed, pred: (o: Placed) => boolean): boolean {
  return cellsOf(b).some(([c, r]) => N4.some(([dc, dr]) => {
    const o = occ.get((c + dc) + ',' + (r + dr));
    return !!o && o.uid !== b.uid && pred(o);
  }));
}

/** Run every inspection rule and compute the live readouts. */
export function analyse(design: Design, tech: TechMods = NO_TECH): DesignReport {
  const hull = hullOf(design);
  const fixed = fixedBlocks(hull);
  const all = fixed.concat(design.blocks);
  const issues: Issue[] = [];
  const flags = new Map<string, Level>();
  const add = (lvl: Level, key: string, vars: Vars | undefined, uids: string[] = [], deck: number | null = null) => {
    issues.push({ lvl, key, vars, uids, deck });
    for (const u of uids) if (lvl === 'err' || !flags.has(u)) flags.set(u, lvl);
  };
  const occ: Record<number, Map<string, Placed>> = {};
  for (let d = 1; d <= hull.decks.length; d++) occ[d] = occupancy(all, d);

  let pax = 0, viewSum = 0, beds = 0, staff = 0, seats = 0, supply = hull.baseSupplyKw, demand = 0;
  let lifeboatSeats = 0, tanks = 0, provisions = 0, fsMoment = 0, scenic = 0, fitOut = 0;
  let scrubber = false, lng = false, zodiacSeats = 0;
  let W = hull.lightship.weight, Mz = W * hull.lightship.kg, My = 0;
  const ice = !!hull.ice || !!design.options?.ice;
  if (design.options?.ice && !hull.ice) {
    const w = hull.lightship.weight * ICE_BELT_SHARE;
    W += w; Mz += w * Math.max(1, hull.decks[0].z - 2);
    fitOut += ICE_BELT_COST;
  }
  const cellW = hull.beam / hull.rows;
  const venueCount: Record<string, number> = {};
  for (const b of all) {
    const t = BLOCKS[b.type];
    const wt = t.fixed ? fixedWeight(hull, b) : t.wt;
    const z = b.type === 'BR' ? hull.bridgeZ : hull.decks[b.deck - 1].z;
    const y = (b.r + b.h / 2 - hull.rows / 2) * cellW; // metres off the centreline, + is starboard
    W += wt; Mz += wt * z; My += wt * y;
    pax += t.pax ?? 0; viewSum += (t.pax ?? 0) * (t.view ?? 0);
    beds += t.beds ?? 0; staff += t.staff ?? 0; seats += t.seats ?? 0;
    demand += t.kw ?? 0; supply += t.supply ?? 0; lifeboatSeats += t.souls ?? 0;
    tanks += t.tank ?? 0; provisions += t.provisions ?? 0; fsMoment += t.freeSurface ?? 0;
    scenic = Math.max(scenic, t.scenic ?? 0);
    if (t.scrubber) scrubber = true;
    if (t.lng) lng = true;
    zodiacSeats += t.zodiac ?? 0;
    fitOut += t.cost;
    if (t.sat) venueCount[b.type] = (venueCount[b.type] ?? 0) + 1;
  }
  provisions *= tech.provisions;
  const crewNeed = hull.baseCrew + Math.ceil(pax / 5) + staff;
  const souls = pax + crewNeed;
  const kg = Mz / W;
  const gm = hull.km - kg - fsMoment / W;
  const listDeg = gm > 0 ? Math.atan(My / (W * gm)) * 180 / Math.PI : null;

  // Venues: one serves about 300 guests; a ship with more guests needs more of them.
  let sat = pax ? 40 : 0, spend = BASE_SPEND;
  const cover = (n: number) => n * VENUE_SERVES / Math.max(pax, VENUE_SERVES);
  for (const [type, n] of Object.entries(venueCount)) {
    const t = BLOCKS[type];
    const cv = cover(n);
    sat += (t.sat ?? 0) * (Math.min(1, cv) + 0.15 * Math.min(1, Math.max(0, cv - 1)));
    spend += (t.spend ?? 0) * Math.min(1, cv);
  }

  // Per-block placement rules.
  const noisy: Record<number, string[]> = {};
  for (const b of design.blocks) {
    const t = BLOCKS[b.type];
    const cells = cellsOf(b);
    if (t.outer === 'any' && !cells.some(([c, r]) => isOuter(hull, b.deck, c, r))) {
      add('err', 'drydock.rule.needsWall', { name: '@block.' + b.type + '.name' }, [b.uid], b.deck);
    }
    if (t.outer === 'all' && !cells.every(([c, r]) => isOuter(hull, b.deck, c, r))) {
      add('err', 'drydock.rule.boatRail', undefined, [b.uid], b.deck);
    }
    if (b.type === 'GA' || b.type === 'DI') {
      const want = b.type === 'GA' ? 'DI' : 'GA';
      if (!touchesType(occ[b.deck], b, o => o.type === want)) {
        add('err', b.type === 'GA' ? 'drydock.rule.galleyAlone' : 'drydock.rule.diningAlone', undefined, [b.uid], b.deck);
      }
    }
    if (t.cat === 'cabin' && touchesType(occ[b.deck], b, o => !!BLOCKS[o.type].noisy)) {
      (noisy[b.deck] ??= []).push(b.uid);
    }
  }
  for (const [d, uids] of Object.entries(noisy)) {
    add('warn', uids.length === 1 ? 'drydock.rule.noise.one' : 'drydock.rule.noise.other', { n: uids.length }, uids, Number(d));
    sat -= Math.min(10, uids.length * 1.5);
  }

  // Stairwells: reach and alignment.
  for (let d = 1; d <= hull.decks.length; d++) {
    const stairs = design.blocks.filter(b => b.deck === d && b.type === 'SW');
    const needy = design.blocks.filter(b => b.deck === d && b.type !== 'SW' && BLOCKS[b.type].cat !== 'machine');
    const far = needy.filter(b => !cellsOf(b).some(([c, r]) => stairs.some(s => Math.abs(s.c - c) + Math.abs(s.r - r) <= STAIR_REACH)));
    if (far.length) {
      if (!stairs.length) add('err', 'drydock.rule.noStairs', undefined, far.map(b => b.uid), d);
      else add('err', far.length === 1 ? 'drydock.rule.farStairs.one' : 'drydock.rule.farStairs.other', { n: far.length, reach: STAIR_REACH }, far.map(b => b.uid), d);
    }
    if (d > 1) for (const s of stairs) {
      const below = occ[d - 1].get(s.c + ',' + s.r);
      if (!below || below.type !== 'SW') add('err', 'drydock.rule.stairAlign', undefined, [s.uid], d);
    }
  }

  // Ship-wide rules.
  const uidsOf = (...types: string[]) => design.blocks.filter(b => types.includes(b.type)).map(b => b.uid);
  if (demand > supply) add('err', 'drydock.rule.power', { short: demand - supply }, uidsOf('GE', 'GE2'));
  if (lifeboatSeats < souls) add('err', 'drydock.rule.lifeboats', { have: lifeboatSeats, need: souls }, uidsOf('LB', 'LB2'));
  if (beds < crewNeed) add('err', 'drydock.rule.crew', { have: beds, need: crewNeed }, uidsOf('CQ'));
  if (pax === 0) add('err', 'drydock.rule.noCabins', undefined);
  if (gm <= 0) add('warn', 'drydock.rule.negativeGm', undefined);
  else if (gm < GM_MIN) add('warn', 'drydock.rule.lowGm', { gm: gm.toFixed(2), min: GM_MIN });
  if (listDeg !== null && Math.abs(listDeg) > LIST_MAX) {
    add('warn', listDeg > 0 ? 'drydock.rule.listStbd' : 'drydock.rule.listPort', { deg: Math.abs(listDeg).toFixed(1) });
  }
  if (pax > 0 && seats * 2 < pax) {
    add('warn', 'drydock.rule.dining', { seats, covered: seats * 2, pax }, uidsOf('DI'));
    sat -= Math.min(20, (pax - seats * 2) / 8);
  }
  sat = Math.max(0, Math.min(100, sat));

  const fuelCap = hull.baseFuelT + tanks * hull.tankT;
  const hotelTph = demand * HOTEL_T_PER_KWH;
  const fuelDays = fuelRange({ fuelCap, vmax: hull.vmax, burnPerNm: hull.burnPerNm * tech.burn, hotelTph }, hull.vmax * SERVICE_SPEED).days;
  const foodDays = souls ? provisions / souls : 0;
  const endurance = Math.min(fuelDays, foodDays);
  const luxury = pax ? viewSum / pax : 0;

  const errors = issues.filter(i => i.lvl === 'err').length;
  const specs: ShipSpecs = {
    hull: design.hull, pax, crew: crewNeed, draft: hull.draft, air: hull.airDraft, length: hull.length, beam: hull.beam,
    vmax: hull.vmax, burnPerNm: hull.burnPerNm * tech.burn, fuelCap, hotelTph, foodDays,
    gm, listDeg: listDeg ?? 0, rollK: hull.rollK * tech.roll, galeK: hull.galeK * tech.gale,
    shipSat: sat, spend, luxury, scenic, lease: hull.leasePerNight, souls, fitOut, ice, scrubber, lng, zodiacSeats,
  };
  return {
    issues, flags, errors, warnings: issues.length - errors,
    pax, beds, crewNeed, souls, supply, demand, lifeboatSeats, seats,
    weight: W, kg, km: hull.km, gm, listDeg, fuelCap, fuelDays, provisions, foodDays, endurance,
    sat, spend, luxury, fitOut, specs,
  };
}

/** Cruising speed the endurance readout assumes, as a share of top speed. */
export const SERVICE_SPEED = 0.8;

/**
 * How long the tank lasts at a given speed, using the planner's own fuel model: burn per mile
 * rises with the square of speed, and hotel load burns by the hour (times any air conditioning).
 */
export function fuelRange(s: Pick<ShipSpecs, 'fuelCap' | 'vmax' | 'burnPerNm' | 'hotelTph'>, speed: number, hotelMult = 1): { days: number; nm: number } {
  const v = Math.min(speed, s.vmax);
  const perHour = v * s.burnPerNm * Math.pow(v / s.vmax, 2) + s.hotelTph * hotelMult;
  const hours = perHour > 0 ? s.fuelCap / perHour : Infinity;
  return { days: hours / 24, nm: hours * v };
}

/** A stable fingerprint of a layout, so a sea trial result is tied to the exact design it tested. */
export function designHash(d: Design): string {
  const parts = d.blocks.map(b => [b.type, b.deck, b.c, b.r, b.w, b.h].join('|')).sort();
  let h = 2166136261;
  const s = d.hull + (d.options?.ice ? '+ice' : '') + '|' + parts.join(',');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Cost of a refit: 30% of every block added or removed. */
export function refitCost(from: Design, to: Design): number {
  const key = (b: Placed) => [b.type, b.deck, b.c, b.r, b.w, b.h].join('|');
  const a = new Map<string, number>(), z = new Map<string, number>();
  for (const b of from.blocks) a.set(key(b), (a.get(key(b)) ?? 0) + 1);
  for (const b of to.blocks) z.set(key(b), (z.get(key(b)) ?? 0) + 1);
  let changed = 0;
  const keys = new Set([...a.keys(), ...z.keys()]);
  for (const k of keys) {
    const diff = Math.abs((a.get(k) ?? 0) - (z.get(k) ?? 0));
    if (!diff) continue;
    const type = k.split('|')[0];
    changed += diff * (BLOCKS[type]?.cost ?? 0);
  }
  if (!!from.options?.ice !== !!to.options?.ice && !HULLS[to.hull]?.ice) changed += ICE_BELT_COST;
  return Math.round(changed * 0.3);
}
