// Blueprints as short text codes, so players can share designs.
import { BLOCKS, HULLS } from './data';
import { canPlace, type Design, type Placed } from './ship';

const PREFIX = 'CLM1.';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export function encodeBlueprint(name: string, d: Design): string {
  const rows = d.blocks.map(b => {
    const t = BLOCKS[b.type];
    const rot = b.w !== t.w || b.h !== t.h ? 1 : 0;
    return b.type + ',' + b.deck + ',' + b.c + ',' + b.r + (rot ? ',1' : '');
  });
  const hull = d.hull + (d.options?.ice ? '+ice' : '');
  return PREFIX + toBase64Url(JSON.stringify([hull, name.slice(0, 40), rows.join(';')]));
}

/** Decode a share code. Blocks that don't fit are dropped rather than failing the whole code. */
export function decodeBlueprint(code: string): { name: string; design: Design; dropped: number } | null {
  const c = code.trim();
  if (!c.startsWith(PREFIX)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(fromBase64Url(c.slice(PREFIX.length))); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  const [hullTag, name, rows] = parsed as [string, string, string];
  if (typeof hullTag !== 'string') return null;
  const [hull, opt] = hullTag.split('+');
  if (!HULLS[hull] || typeof name !== 'string' || typeof rows !== 'string') return null;
  const design: Design = { hull, blocks: [], ...(opt === 'ice' ? { options: { ice: true } } : {}) };
  let dropped = 0, i = 0;
  for (const row of rows ? rows.split(';') : []) {
    const [type, deck, cc, r, rot] = row.split(',');
    const t = BLOCKS[type];
    if (!t || t.fixed) { dropped++; continue; }
    const w = rot ? t.h : t.w, h = rot ? t.w : t.h;
    const b: Placed = { uid: 'x' + (i++), type, deck: +deck, c: +cc, r: +r, w, h };
    if (!canPlace(design, type, b.deck, b.c, b.r, w, h).ok) { dropped++; continue; }
    design.blocks.push(b);
  }
  return { name: name || 'Shared design', design, dropped };
}
