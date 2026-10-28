// Graduation crossings: long open-sea repositioning voyages between regions, with no guests aboard.
// The ship needs the range and the stability for the passage.
import type { Graduation, Port } from './data';
import type { ShipSpecs } from './ship';
import { CAPSIZE_DEG } from './trial';
import { FUEL_RESERVE } from './planner';
import type { Vars } from './strings';

export const ROUGH_HEEL = 20;

export interface CrossingCheck {
  ok: boolean; nm: number; speed: number; hours: number; fuel: number; fuelLeft: number; heel: number;
  issues: { lvl: 'err' | 'warn'; key: string; vars?: Vars }[];
}

export function checkCrossing(g: Graduation, from: string, ship: ShipSpecs, ports: Record<string, Port> = {}): CrossingCheck {
  const nm = g.nm?.[from] ?? 0;
  const speed = Math.min(ship.vmax, g.speed ?? 14);
  const hours = nm / speed;
  // Crew only, so the hotel runs at half load. With refuel stops, only the longest leg has to fit the tank.
  const leg = g.legNm ? Math.min(nm, g.legNm) : nm;
  const fuel = leg * ship.burnPerNm * Math.pow(speed / ship.vmax, 2) + ship.hotelTph * 0.5 * (leg / speed);
  const fuelLeft = (ship.fuelCap - fuel) / ship.fuelCap;
  const heel = ship.gm <= 0 ? 90 : Math.abs(ship.listDeg) + Math.min(40, ship.rollK / Math.sqrt(ship.gm)) * (g.swell ?? 1.8);
  const issues: CrossingCheck['issues'] = [];
  if (!nm) issues.push({ lvl: 'err', key: 'cross.wrongPort', vars: { ports: (g.from ?? []).map(id => ports[id]?.name ?? id).join(', ') } });
  const L = g.limits ?? {};
  if (L.maxAir && ship.air > L.maxAir) issues.push({ lvl: 'err', key: 'cross.tooTall', vars: { air: ship.air, max: L.maxAir } });
  if (L.maxBeam && ship.beam > L.maxBeam) issues.push({ lvl: 'err', key: 'cross.tooWide', vars: { beam: ship.beam, max: L.maxBeam } });
  if (L.maxLength && ship.length > L.maxLength) issues.push({ lvl: 'err', key: 'cross.tooLong', vars: { len: ship.length, max: L.maxLength } });
  if (fuelLeft < 0) issues.push({ lvl: 'err', key: 'cross.fuelOut', vars: { need: Math.round(fuel), cap: ship.fuelCap } });
  else if (fuelLeft < FUEL_RESERVE) issues.push({ lvl: 'err', key: 'cross.reserve', vars: { pct: Math.round(fuelLeft * 100) } });
  if (heel >= CAPSIZE_DEG) issues.push({ lvl: 'err', key: 'cross.unstable', vars: { deg: Math.round(heel) } });
  else if (heel >= ROUGH_HEEL) issues.push({ lvl: 'warn', key: 'cross.rough', vars: { deg: Math.round(heel) } });
  return { ok: !issues.some(i => i.lvl === 'err'), nm, speed, hours, fuel, fuelLeft, heel, issues };
}
