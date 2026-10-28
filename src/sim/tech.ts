// Tech tree rules and the modifiers owned parts apply to every ship.
import { TECH, BLOCKS, type TechNode } from './data';

export interface TechMods {
  roll: number; gale: number; burn: number; portHotel: number; slowBurn: number;
  provisions: number; tenderPenalty: number; tenderCancel: number;
}

export const NO_TECH: TechMods = {
  roll: 1, gale: 1, burn: 1, portHotel: 1, slowBurn: 1, provisions: 1, tenderPenalty: 1, tenderCancel: 1,
};

export function techMods(owned: string[]): TechMods {
  const m: TechMods = { ...NO_TECH };
  for (const id of owned) {
    const n = TECH.nodes.find(x => x.id === id);
    if (!n?.effect) continue;
    for (const [k, v] of Object.entries(n.effect)) {
      // Later tiers replace earlier ones in the same family (fins replace bilge keels).
      if (k in m) (m as unknown as Record<string, number>)[k] = Math.min((m as unknown as Record<string, number>)[k], v);
    }
  }
  return m;
}

/** A tier opens when you own 2 parts from the tier below in the same branch. */
export function tierOpen(node: TechNode, owned: string[]): boolean {
  if (node.tier <= 1) return true;
  const below = TECH.nodes.filter(n => n.branch === node.branch && n.tier === node.tier - 1);
  const have = below.filter(n => owned.includes(n.id)).length;
  return have >= Math.min(2, below.length);
}

export type BuyCheck = { ok: true } | { ok: false; why: 'owned' | 'tier' | 'dp' };

export function canBuy(id: string, owned: string[], dp: number): BuyCheck {
  const n = TECH.nodes.find(x => x.id === id);
  if (!n) return { ok: false, why: 'tier' };
  if (owned.includes(id)) return { ok: false, why: 'owned' };
  if (!tierOpen(n, owned)) return { ok: false, why: 'tier' };
  if (dp < n.cost) return { ok: false, why: 'dp' };
  return { ok: true };
}

export function blockUnlocked(type: string, owned: string[], sandbox: boolean): boolean {
  const b = BLOCKS[type];
  if (!b || b.fixed) return false;
  if (!b.tech || sandbox) return true;
  return owned.includes(b.tech);
}

export function dpSpent(owned: string[]): number {
  return owned.reduce((s, id) => s + (TECH.nodes.find(n => n.id === id)?.cost ?? 0), 0);
}
