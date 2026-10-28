// Hurricanes. Each week of the season may spawn one named storm. The forecast track is what the
// planner shows; the real track drifts from it on a fixed seed, so a replay sees the same storm.
import type { Region } from './data';
import { seasonOf, dateOf } from './calendar';
import { hashString, mulberry, nmBetween, type LonLat } from './geo';

/** Ports within this distance of the storm's centre close for the day. */
export const DANGER_NM = 150;
/** Forecast cone radius: grows with how far ahead the forecast looks. */
export const coneNm = (daysAhead: number) => 60 + 55 * Math.max(0, daysAhead);
const LIFE_DAYS = 11;

export interface Storm {
  id: string; name: string; t0: number; start: LonLat;
  /** Degrees per day, forecast and real. */
  vel: LonLat; realVel: LonLat;
}

function stormForWeek(region: Region, week: number): Storm | null {
  const day = week * 7;
  const season = seasonOf(region, day);
  const odds = season?.storms ?? 0;
  if (!odds) return null;
  const rnd = mulberry(hashString(region.id + ':storm:' + week));
  if (rnd() >= odds) return null;
  const names = region.stormNames ?? ['Storm'];
  const year = dateOf(day).getUTCFullYear();
  const b = region.bounds;
  // Storms form out in the Atlantic to the east and track west-northwest.
  const start: LonLat = [b.lon1 + 1 + rnd() * 3, 11 + rnd() * 6];
  const heading = (275 + rnd() * 30) * Math.PI / 180; // compass degrees, west-northwest
  const speed = 3.2 + rnd() * 1.6; // degrees per day
  const vel: LonLat = [Math.sin(heading) * speed, Math.cos(heading) * speed];
  const turn = (rnd() - 0.5) * 0.5, stretch = 0.85 + rnd() * 0.3;
  const realVel: LonLat = [
    (vel[0] * Math.cos(turn) - vel[1] * Math.sin(turn)) * stretch,
    (vel[0] * Math.sin(turn) + vel[1] * Math.cos(turn)) * stretch,
  ];
  return { id: year + '-' + week, name: names[(week + year) % names.length], t0: day + rnd() * 6, start, vel, realVel };
}

/** Storms alive at any time between two game days (inclusive). */
export function stormsBetween(region: Region, fromDay: number, toDay: number): Storm[] {
  const out: Storm[] = [];
  for (let w = Math.floor((fromDay - LIFE_DAYS) / 7); w <= Math.floor(toDay / 7); w++) {
    const s = stormForWeek(region, w);
    if (s && s.t0 <= toDay && s.t0 + LIFE_DAYS >= fromDay) out.push(s);
  }
  return out;
}

export function stormAt(s: Storm, day: number, real: boolean): LonLat | null {
  const dt = day - s.t0;
  if (dt < 0 || dt > LIFE_DAYS) return null;
  const v = real ? s.realVel : s.vel;
  return [s.start[0] + v[0] * dt, s.start[1] + v[1] * dt];
}

export interface StormHit { storm: Storm; nm: number }

/** The forecast, made on `forecastDay`: is this point inside the cone at `day`? */
export function forecastHit(region: Region, p: LonLat, day: number, forecastDay: number): StormHit | null {
  for (const s of stormsBetween(region, day, day)) {
    const c = stormAt(s, day, false);
    if (!c) continue;
    const d = nmBetween(p, c);
    if (d < DANGER_NM + coneNm(day - forecastDay)) return { storm: s, nm: d };
  }
  return null;
}

/** What actually happens: is this point inside the danger zone at `day`? */
export function realHit(region: Region, p: LonLat, day: number): StormHit | null {
  for (const s of stormsBetween(region, day, day)) {
    const c = stormAt(s, day, true);
    if (!c) continue;
    const d = nmBetween(p, c);
    if (d < DANGER_NM) return { storm: s, nm: d };
  }
  return null;
}
