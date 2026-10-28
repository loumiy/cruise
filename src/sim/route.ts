// Sea lanes as a graph. Ships follow lanes and never sail through a port without stopping.
import type { EdgeOpts, Region } from './data';
import { nmBetween, type LonLat } from './geo';

export interface Edge extends EdgeOpts { a: string; b: string; pts: LonLat[]; len: number }
export interface Graph { edges: Edge[]; adj: Record<string, { to: string; e: Edge }[]> }
export interface ShipSize { draft: number; air: number; beam: number }
export interface Route {
  ids: string[]; pts: LonLat[]; nm: number; tolls: number; pilotage: number;
  canals: string[]; scenic: string[];
}

const cache = new Map<string, Graph>();

export function coordOf(region: Region, id: string): LonLat {
  const p = region.ports[id];
  if (p) return [p.lon, p.lat];
  const n = region.nodes[id];
  if (!n) throw new Error('Unknown lane node ' + id);
  return n;
}

export function graphOf(region: Region): Graph {
  const hit = cache.get(region.id);
  if (hit) return hit;
  const adj: Graph['adj'] = {};
  const edges = region.edges.map(([a, b, o]) => {
    const pts: LonLat[] = [coordOf(region, a), ...(o?.via ?? []), coordOf(region, b)];
    const len = pts.slice(1).reduce((s, p, i) => s + nmBetween(pts[i], p), 0);
    const e: Edge = { a, b, ...(o ?? {}), pts, len };
    (adj[a] ??= []).push({ to: b, e });
    (adj[b] ??= []).push({ to: a, e });
    return e;
  });
  const g = { edges, adj };
  cache.set(region.id, g);
  return g;
}

export type EdgeBlock = null | 'draft' | 'air' | 'beam';
export function edgeBlock(e: Edge, s: ShipSize): EdgeBlock {
  if (e.maxDraft && s.draft > e.maxDraft) return 'draft';
  if (e.maxAir && s.air > e.maxAir) return 'air';
  if (e.maxBeam && s.beam > e.maxBeam) return 'beam';
  return null;
}

/** Shortest legal route between two ports for a ship of this size. */
export function route(region: Region, a: string, b: string, s: ShipSize): Route | null {
  if (a === b) return null;
  const g = graphOf(region);
  const dist: Record<string, number> = {}, prev: Record<string, string> = {}, pe: Record<string, Edge> = {};
  const Q = new Set(Object.keys(g.adj));
  for (const k of Q) dist[k] = Infinity;
  if (!(a in dist) || !(b in dist)) return null;
  dist[a] = 0;
  while (Q.size) {
    let u: string | null = null, best = Infinity;
    for (const k of Q) if (dist[k] < best) { best = dist[k]; u = k; }
    if (u === null) break;
    Q.delete(u);
    if (u === b) break;
    if (region.ports[u] && u !== a) continue;
    for (const { to, e } of g.adj[u]) {
      if (edgeBlock(e, s)) continue;
      const nd = dist[u] + e.len;
      if (nd < dist[to]) { dist[to] = nd; prev[to] = u; pe[to] = e; }
    }
  }
  if (dist[b] === Infinity) return null;
  const ids = [b], es: Edge[] = [];
  let c = b;
  while (c !== a) { es.unshift(pe[c]); c = prev[c]; ids.unshift(c); }
  let pts: LonLat[] = [coordOf(region, a)];
  let tolls = 0, pilotage = 0;
  const canals: string[] = [], scenic: string[] = [];
  es.forEach((e, i) => {
    const fwd = e.a === ids[i];
    const p = fwd ? e.pts : e.pts.slice().reverse();
    pts = pts.concat(p.slice(1));
    if (e.toll) tolls += e.toll;
    if (e.pilotage) pilotage += e.pilotage;
    if (e.canal && !canals.includes(e.canal)) canals.push(e.canal);
    if (e.scenic && !scenic.includes(e.scenic)) scenic.push(e.scenic);
  });
  return { ids, pts, nm: dist[b], tolls, pilotage, canals, scenic };
}

/** Canals a ship is too big for, for the "sails around" hint. */
export function blockedCanals(region: Region, s: ShipSize): { canal: string; why: EdgeBlock }[] {
  return graphOf(region).edges
    .filter(e => e.canal && edgeBlock(e, s))
    .map(e => ({ canal: e.canal as string, why: edgeBlock(e, s) }));
}
