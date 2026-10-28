// Chart projection and nautical distances.
import type { Region } from './data';

export type LonLat = [number, number];

export function projector(region: Region) {
  const { lon0, lon1, lat0, lat1, refLat, scale } = region.bounds;
  const kx = Math.cos(refLat * Math.PI / 180);
  return {
    width: (lon1 - lon0) * kx * scale,
    height: (lat1 - lat0) * scale,
    proj: (lon: number, lat: number): [number, number] => [(lon - lon0) * kx * scale, (lat1 - lat) * scale],
  };
}

/** Great-circle distance in nautical miles. */
export function nmBetween(a: LonLat, b: LonLat): number {
  const R = 3440.065, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pointInPolygon(pt: LonLat, poly: LonLat[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

/** Land, minus any water cut out of it (a gulf drawn inside a big coastline polygon). */
export function onLand(region: Region, pt: LonLat): boolean {
  if (Object.values(region.water ?? {}).some(poly => pointInPolygon(pt, poly))) return false;
  return Object.values(region.land).some(poly => pointInPolygon(pt, poly));
}

/** Deterministic PRNG, so the same seed always rolls the same events. */
export function mulberry(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
