// Saves: autosave, three manual slots, and file export/import. Each save stores a version number.
import { SAVE_VERSION, newGame, type GameState } from './game';

export const AUTOSAVE = 'clm.autosave';
export const SLOTS = ['clm.slot1', 'clm.slot2', 'clm.slot3'];

export interface SaveFile { game: 'cruise-line-manager'; version: number; savedAt: string; state: GameState }

export function serialise(state: GameState): string {
  const f: SaveFile = { game: 'cruise-line-manager', version: SAVE_VERSION, savedAt: new Date().toISOString(), state };
  return JSON.stringify(f);
}

/** Upgrade code for old saves goes here, one step per version. */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: Chapter 2. Voyage logs record their region; one-time hints are tracked.
  1: s => ({
    ...s,
    hints: (s.hints as string[] | undefined) ?? [],
    log: ((s.log as Record<string, unknown>[] | undefined) ?? []).map(v => ({ region: 'northeast', ...v })),
  }),
};

export function deserialise(text: string): GameState | null {
  let f: SaveFile;
  try { f = JSON.parse(text); } catch { return null; }
  if (!f || f.game !== 'cruise-line-manager' || typeof f.version !== 'number' || !f.state) return null;
  if (f.version > SAVE_VERSION) return null;
  let s = f.state as unknown as Record<string, unknown>;
  for (let v = f.version; v < SAVE_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (m) s = m(s);
  }
  // Fill any field a newer build added, from a fresh game.
  const base = newGame((s.mode as GameState['mode']) ?? 'campaign') as unknown as Record<string, unknown>;
  const merged = { ...base, ...s, version: SAVE_VERSION } as unknown as GameState;
  if (!Array.isArray(merged.ships) || !merged.ships.length) return null;
  return merged;
}

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function storage(): Store | null {
  try {
    const s = globalThis.localStorage;
    const k = '__clm_probe';
    s.setItem(k, '1'); s.removeItem(k);
    return s;
  } catch { return null; }
}

export function writeSave(key: string, state: GameState, store = storage()): boolean {
  if (!store) return false;
  try { store.setItem(key, serialise(state)); return true; } catch { return false; }
}

export function readSave(key: string, store = storage()): GameState | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? deserialise(raw) : null;
  } catch { return null; }
}

export interface SlotInfo { key: string; savedAt: string | null; voyages: number; cash: number; mode: string }

export function slotInfo(key: string, store = storage()): SlotInfo {
  const empty = { key, savedAt: null, voyages: 0, cash: 0, mode: '' };
  if (!store) return empty;
  try {
    const raw = store.getItem(key);
    if (!raw) return empty;
    const f = JSON.parse(raw) as SaveFile;
    return { key, savedAt: f.savedAt, voyages: f.state.voyages, cash: f.state.cash, mode: f.state.mode };
  } catch { return empty; }
}
