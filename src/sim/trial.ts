// The sea trial: a ship rolls in a 2.5 m beam swell. Roll size depends on GM and list.
import type { ShipSpecs } from './ship';
import { GM_MIN, LIST_MAX } from './ship';

export const CAPSIZE_DEG = 32;
export const ROUGH_DEG = 15;

export type TrialKind = 'ok' | 'warn' | 'err';
export interface TrialResult {
  kind: TrialKind; capsize: boolean; amp: number; period: number; maxHeel: number; list: number;
  notes: string[]; // string keys
}

export function seaTrial(s: Pick<ShipSpecs, 'gm' | 'listDeg' | 'rollK'>): TrialResult {
  const list = s.listDeg;
  if (s.gm <= 0) {
    return { kind: 'err', capsize: true, amp: 0, period: 0, maxHeel: 90, list, notes: ['trial.note.negativeGm'] };
  }
  const amp = Math.min(40, s.rollK / Math.sqrt(s.gm));
  const period = 16 / Math.sqrt(s.gm);
  const maxHeel = Math.abs(list) + amp;
  const capsize = maxHeel >= CAPSIZE_DEG;
  const notes: string[] = [];
  if (capsize) notes.push('trial.note.capsize');
  else {
    notes.push('trial.note.peak');
    if (s.gm < GM_MIN) notes.push('trial.note.lowGm');
    if (maxHeel >= ROUGH_DEG) notes.push('trial.note.rough');
    if (Math.abs(list) > LIST_MAX) notes.push('trial.note.list');
  }
  const kind: TrialKind = capsize ? 'err' : (maxHeel >= ROUGH_DEG || s.gm < GM_MIN) ? 'warn' : 'ok';
  return { kind, capsize, amp, period, maxHeel, list, notes };
}
