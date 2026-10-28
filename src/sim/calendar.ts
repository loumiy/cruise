// Game calendar. Day 0 is the first day of the campaign.
import type { Region, SeasonDef } from './data';

export const START = Date.UTC(2027, 5, 5); // Sat 5 June 2027
const DAY_MS = 86400000;

export function dateOf(day: number): Date {
  return new Date(START + Math.floor(day) * DAY_MS);
}

export function dayOf(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - START) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(day: number, withYear = true): string {
  const d = dateOf(day);
  return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + (withYear ? ' ' + d.getUTCFullYear() : '');
}

export function weekday(day: number): string {
  return WEEKDAYS[dateOf(day).getUTCDay()];
}

/** 0 = Sunday. */
export function weekdayOf(day: number): number {
  return dateOf(day).getUTCDay();
}

export function seasonOf(region: Region, day: number): SeasonDef | null {
  const m = dateOf(day).getUTCMonth() + 1;
  return region.seasons.find(s => s.months.includes(m)) ?? null;
}

/** Last day (inclusive) the region's season is open, for the season containing `day`. */
export function seasonCloseDay(region: Region, day: number): number {
  if (region.season.yearRound) return Infinity;
  const y = dateOf(day).getUTCFullYear();
  return dayOf(y, region.season.closeMonth + 1, 1) - 1;
}

/** First open day of next season, counting from `day`. */
export function nextOpenDay(region: Region, day: number): number {
  const y = dateOf(day).getUTCFullYear();
  const thisYear = dayOf(y, region.season.openMonth, 1);
  return day < thisYear ? thisYear : dayOf(y + 1, region.season.openMonth, 1);
}

/** Hours on a 24h clock, shown as "D2 07:00" relative to departure day. */
export function fmtClock(h: number): string {
  const total = Math.round(h * 60);
  const d = Math.floor(total / 1440) + 1;
  const rem = total - (d - 1) * 1440;
  return 'D' + d + ' ' + String(Math.floor(rem / 60)).padStart(2, '0') + ':' + String(rem % 60).padStart(2, '0');
}
