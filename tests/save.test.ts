import { describe, expect, it } from 'vitest';
import { newGame, sail } from '../src/sim/game';
import { serialise, deserialise, writeSave, readSave, type Store } from '../src/sim/save';
import { encodeBlueprint, decodeBlueprint } from '../src/sim/share';
import { designHash } from '../src/sim/ship';

class MemStore implements Store {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('saves', () => {
  it('round-trips a game with its version number', () => {
    const s = newGame();
    s.plan.stops = ['BHB', 'HFX'];
    s.plan.fare = 260;
    sail(s);
    const txt = serialise(s);
    expect(JSON.parse(txt).version).toBe(1);
    expect(deserialise(txt)).toEqual(s);
  });
  it('writes and reads slots', () => {
    const st = new MemStore();
    const s = newGame();
    expect(writeSave('clm.slot1', s, st)).toBe(true);
    expect(readSave('clm.slot1', st)).toEqual(s);
    expect(readSave('clm.slot2', st)).toBeNull();
  });
  it('rejects junk and saves from a newer build', () => {
    expect(deserialise('nope')).toBeNull();
    expect(deserialise(JSON.stringify({ game: 'other' }))).toBeNull();
    expect(deserialise(JSON.stringify({ game: 'cruise-line-manager', version: 99, state: newGame() }))).toBeNull();
  });
  it('fills fields a newer build added', () => {
    const s = newGame() as unknown as Record<string, unknown>;
    delete s.demandBonus;
    const back = deserialise(JSON.stringify({ game: 'cruise-line-manager', version: 1, savedAt: '', state: s }))!;
    expect(back.demandBonus).toBe(0);
  });
});

describe('blueprint share codes', () => {
  it('round-trips a design', () => {
    const s = newGame();
    const bp = s.blueprints[1];
    const code = encodeBlueprint(bp.name, bp.design);
    expect(code.startsWith('CLM1.')).toBe(true);
    const back = decodeBlueprint(code)!;
    expect(back.name).toBe(bp.name);
    expect(back.dropped).toBe(0);
    expect(designHash(back.design)).toBe(designHash(bp.design));
  });
  it('rejects junk', () => {
    expect(decodeBlueprint('hello')).toBeNull();
    expect(decodeBlueprint('CLM1.!!!')).toBeNull();
  });
});
