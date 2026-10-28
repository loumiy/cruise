// Typed access to the content files in /data. Content changes never need new code.
import hullsJson from '../../data/hulls.json';
import blocksJson from '../../data/blocks.json';
import techJson from '../../data/tech.json';
import eventsJson from '../../data/events.json';
import firstsJson from '../../data/firsts.json';
import milestonesJson from '../../data/milestones.json';
import neRegion from '../../data/regions/northeast.json';
import nePorts from '../../data/ports/northeast.json';
import neLanes from '../../data/lanes/northeast.json';
import caRegion from '../../data/regions/caribbean.json';
import caPorts from '../../data/ports/caribbean.json';
import caLanes from '../../data/lanes/caribbean.json';
import akRegion from '../../data/regions/alaska.json';
import akPorts from '../../data/ports/alaska.json';
import akLanes from '../../data/lanes/alaska.json';
import euRegion from '../../data/regions/europe.json';
import euPorts from '../../data/ports/europe.json';
import euLanes from '../../data/lanes/europe.json';
import rivalsJson from '../../data/rivals.json';

export type Role = 'bottom' | 'lower' | 'middle' | 'upper' | 'top' | 'boat' | 'any';
export type Cat = 'cabin' | 'venue' | 'service' | 'machine' | 'access' | 'safety';

export interface BlockType {
  code: string; w: number; h: number; cat: Cat; group: string; roles: Role[];
  wt: number; cost: number;
  kw?: number; pax?: number; view?: number; seats?: number; staff?: number; sat?: number; spend?: number;
  noisy?: boolean; freeSurface?: number; supply?: number; tank?: number; provisions?: number;
  souls?: number; beds?: number; outer?: 'any' | 'all'; scenic?: number; hi?: boolean;
  scrubber?: number; lng?: number; zodiac?: number;
  /** Battery bank: miles of zero-emission running, scaled by the hull's power use. */
  battery?: number;
  fixed?: boolean; tech?: string;
}

export interface DeckDef { name: string; z: number; roles: Role[]; mask: string[] }
export interface FixedDef { type: string; deck: number; c: number; r: number; w: number; h: number; wt?: number }

export interface Hull {
  name: string; guests: string; cols: number; rows: number; length: number; beam: number;
  draft: number; airDraft: number; vmax: number; burnPerNm: number;
  lightship: { weight: number; kg: number }; km: number; rollK: number; galeK: number;
  baseSupplyKw: number; baseFuelT: number; tankT: number; baseCrew: number;
  leasePerNight: number; commissionFee: number; bridgeZ: number;
  /** Built with an ice belt. */
  ice?: boolean;
  decks: DeckDef[]; fixed: FixedDef[];
}

export interface Port {
  name: string; country: string; lon: number; lat: number; appeal: number[]; tags: string[];
  /** scenic: cruise past, no landing. landing: guests go ashore by zodiac. */
  berth: 'pier' | 'tender' | 'scenic' | 'landing'; maxDraft?: number; maxLength?: number; maxBeam?: number; fuel?: boolean; turnaround?: boolean;
  callFee: number; headTax: number; tenderFee?: number; lockedBy?: string; closed?: boolean;
  /** Ship berths at the pier. Rivals fill them on set weekdays. */
  berths?: number;
  /** When the piers are full, ships can anchor and tender instead. */
  tenderOk?: boolean;
  privateIsland?: boolean;
  /** Extra onboard spending per guest on the day of the call. */
  spend?: number;
  /** Toll for a partial canal transit made as part of the call. */
  canalCall?: number;
  /** Ice at the glacier face: only ice-belted ships get close. */
  ice?: boolean;
  /** Bridges or bans: the tallest ship allowed in. */
  maxAir?: number;
  /** The size limits are a ban on big ships, not the size of the pier. */
  ban?: boolean;
  /** Zero-emission waters: miles the ship must run on batteries to make the call and leave. */
  zeroNm?: number;
  /** Europe: which of the chart's four areas the port is in. */
  area?: string;
  /** Turnaround near a big airport, 0 to 1: fly-in guests book more readily. */
  airport?: number;
  label: [number, number, string];
}

export interface EdgeOpts {
  canal?: string; maxDraft?: number; maxAir?: number; maxBeam?: number; maxLength?: number; toll?: number;
  via?: [number, number][]; scenic?: string; pilotage?: number;
  /** Passable only near slack water: hours between slacks, window width in hours, phase offset in hours. */
  tide?: { period: number; window: number; phase: number };
  narrows?: string;
}

export interface SeasonDef { id: string; months: number[]; appealIdx: number; demand: number; galeOdds: number; fogOdds: number; storms?: number }

export interface Graduation {
  id: string; locked?: boolean; toRegion?: string; toPort?: string; from?: string[]; nm?: Record<string, number>;
  speed?: number; swell?: number; requires?: string; grant?: number; keepCash?: number;
  /** Longest leg with no fuel, when the passage has refuel stops on the way. */
  legNm?: number;
  /** Size limits on the way, e.g. canal locks and bridges. */
  limits?: { maxAir?: number; maxBeam?: number; maxLength?: number };
  unlockHull?: string;
  /** Part of the passage sails with guests aboard: it has to fit this many days. */
  guestLeg?: { nm: number; days: number };
  /** A qualifying cruise instead of a crossing: the campaign's final test. */
  cruise?: { nights: number; areas: number; zeroEmission: boolean; rep: number };
}

export interface Rival { ship: string; line: string; guests: number; calls: Record<string, string> }

export interface Region {
  id: string; name: string; chapter: number;
  bounds: { lon0: number; lon1: number; lat0: number; lat1: number; refLat: number; scale: number };
  tint: string; season: { openMonth: number; closeMonth: number; yearRound?: boolean }; seasons: SeasonDef[];
  market: { mass: number; massSens: number; premium: number; premiumSens: number; rivalFare: number };
  fuelPrice: number; scenicBonus: number;
  /** Air conditioning: multiplies hotel fuel use. */
  hotelMult?: number;
  /** Emissions control area: burn low-sulfur fuel, fit a scrubber or LNG, or risk a fine. */
  eca?: { lowSulfurPrice: number; lngPrice: number; fine: number; fineOdds: number };
  /** Carbon charged per tonne of fuel burned; LNG emits a share of that. Offsets buy the rest back. */
  carbon?: { price: number; lngShare: number; offset: number; offsetDemand: number };
  /** Cruise lengths on offer, when not the usual 3–7 nights. */
  nights?: number[];
  /** Appeal for each country visited after the first. */
  countryBonus?: number;
  /** Fly-in guests: bookings swing this much with how close the turnarounds are to a big airport. */
  flyIn?: number;
  /** Chart areas, for itineraries that span several. */
  areas?: string[];
  soundings?: { shallow: [number, number]; deep: [number, number]; deepBox?: [number, number, number, number] };
  graduation?: Graduation;
  stormNames?: string[];
  rivals: Rival[];
  land: Record<string, [number, number][]>;
  /** Water cut out of the land polygons, drawn on top of them. */
  water?: Record<string, [number, number][]>;
  labels: { lon: number; lat: number; text: string; kind: string; rot?: number }[];
  compass: { lon: number; lat: number }; scaleBar: { lon: number; lat: number };
  nodes: Record<string, [number, number]>;
  zones: Record<string, string[]>;
  ports: Record<string, Port>;
  edges: [string, string, EdgeOpts?][];
  canals: Record<string, { label: [number, number, number, number, string] }>;
}

export interface TechNode {
  id: string; branch: string; tier: number; cost: number;
  effect?: Record<string, number>; unlocks?: string[];
}

export interface EventDef {
  id: string; on: 'leg' | 'call'; zone?: string; odds: number | string; fallOdds?: number;
  sat: number; once?: boolean; minNm?: number; scaleByHull?: boolean; berth?: string; refund?: number;
  cancelsCall?: boolean; port?: string; season?: string; tag?: string; minAppeal?: number; revenue?: number;
  /** Only rolls in this region. */
  region?: string;
}

export interface MilestoneDef {
  id: string;
  test: {
    voyages?: number; visit?: string; profit?: number; cash?: number; rep?: number;
    regionVoyages?: number; soldOutPax?: number; island?: boolean; stormProfits?: number; weekGuests?: number;
    visitAny?: string[]; permit?: boolean; wildlife?: number; cleanSeason?: number;
    canal?: string; offset?: boolean; areaSummer?: { areas: string[]; n: number };
  };
  reward: { cash?: number; unlock?: string; unlockPorts?: string; unlockHull?: string; demand?: number };
}

export const HULLS = hullsJson as unknown as Record<string, Hull>;
export const BLOCKS = blocksJson as unknown as Record<string, BlockType>;
export const TECH = techJson as unknown as { branches: string[]; nodes: TechNode[] };
export const EVENTS = eventsJson as unknown as EventDef[];
export const FIRST_DP = firstsJson as Record<string, number>;
export const MILESTONES = milestonesJson as unknown as Record<string, MilestoneDef[]>;

export const RIVAL_LINES = (rivalsJson as unknown as { lines: Record<string, { name: string; style: string }> }).lines;
const rivalsOf = (id: string) => ((rivalsJson as unknown as Record<string, Rival[]>)[id] ?? []);

function region(r: unknown, ports: unknown, lanes: { edges: unknown; canals: unknown }): Region {
  const base = r as Omit<Region, 'ports' | 'edges' | 'canals' | 'rivals'>;
  return {
    ...base,
    ports: ports as Record<string, Port>,
    edges: lanes.edges as [string, string, EdgeOpts?][],
    canals: lanes.canals as Region['canals'],
    rivals: rivalsOf(base.id),
  };
}

export const REGIONS: Record<string, Region> = {
  northeast: region(neRegion, nePorts, neLanes),
  caribbean: region(caRegion, caPorts, caLanes),
  alaska: region(akRegion, akPorts, akLanes),
  europe: region(euRegion, euPorts, euLanes),
};

export const REGION_ORDER = ['northeast', 'caribbean', 'alaska', 'europe'];
export const HULL_ORDER = ['coastal', 'expedition', 'liner', 'grand', 'mega'];
