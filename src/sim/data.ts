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
import rivalsJson from '../../data/rivals.json';

export type Role = 'bottom' | 'lower' | 'middle' | 'upper' | 'top' | 'boat' | 'any';
export type Cat = 'cabin' | 'venue' | 'service' | 'machine' | 'access' | 'safety';

export interface BlockType {
  code: string; w: number; h: number; cat: Cat; group: string; roles: Role[];
  wt: number; cost: number;
  kw?: number; pax?: number; view?: number; seats?: number; staff?: number; sat?: number; spend?: number;
  noisy?: boolean; freeSurface?: number; supply?: number; tank?: number; provisions?: number;
  souls?: number; beds?: number; outer?: 'any' | 'all'; scenic?: number; hi?: boolean;
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
  decks: DeckDef[]; fixed: FixedDef[];
}

export interface Port {
  name: string; country: string; lon: number; lat: number; appeal: number[]; tags: string[];
  berth: 'pier' | 'tender'; maxDraft?: number; maxLength?: number; maxBeam?: number; fuel?: boolean; turnaround?: boolean;
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
  label: [number, number, string];
}

export interface EdgeOpts {
  canal?: string; maxDraft?: number; maxAir?: number; maxBeam?: number; toll?: number;
  via?: [number, number][]; scenic?: string; pilotage?: number;
}

export interface SeasonDef { id: string; months: number[]; appealIdx: number; demand: number; galeOdds: number; fogOdds: number; storms?: number }

export interface Graduation {
  id: string; locked?: boolean; toRegion?: string; toPort?: string; from?: string[]; nm?: Record<string, number>;
  speed?: number; swell?: number; requires?: string; grant?: number; keepCash?: number;
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
}

export interface MilestoneDef {
  id: string;
  test: {
    voyages?: number; visit?: string; profit?: number; cash?: number; rep?: number;
    regionVoyages?: number; soldOutPax?: number; island?: boolean; stormProfits?: number; weekGuests?: number;
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
};

export const REGION_ORDER = ['northeast', 'caribbean'];
export const HULL_ORDER = ['coastal', 'liner', 'mega'];
