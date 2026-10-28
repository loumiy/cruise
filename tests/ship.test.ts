import { describe, expect, it } from 'vitest';
import { analyse, canPlace, fixedBlocks, hullOf, inShape, designHash, refitCost, type Design } from '../src/sim/ship';
import { seaTrial } from '../src/sim/trial';
import { HULLS, BLOCKS } from '../src/sim/data';
import { newGame, bpById, runTrial, commission, trialStatus, cloneDesign, refit, canCommission, placedFrom } from '../src/sim/game';
import starters from '../data/starters.json';
import { fixHarborLight } from './helpers';

const starter = (k: 'puffin' | 'harbor' | 'crown'): Design => {
  const s = (starters as unknown as Record<string, { hull: string; blocks: [string, number, number, number, number][] }>)[k];
  return { hull: s.hull, blocks: placedFrom(s.blocks, k[0]) };
};

describe('hulls', () => {
  for (const [id, h] of Object.entries(HULLS)) {
    it(id + ': masks match the grid and fixed cells sit inside the hull', () => {
      expect(h.decks.length).toBeGreaterThan(0);
      for (const d of h.decks) {
        expect(d.mask.length).toBe(h.rows);
        for (const row of d.mask) expect(row.length).toBe(h.cols);
      }
      for (const f of fixedBlocks(h)) for (let i = 0; i < f.w; i++) for (let j = 0; j < f.h; j++) expect(inShape(h, f.deck, f.c + i, f.r + j)).toBe(true);
    });
    it(id + ': upper decks are no larger than lower ones', () => {
      const cells = h.decks.map(d => d.mask.join('').split('#').length - 1);
      for (let i = 1; i < cells.length; i++) expect(cells[i]).toBeLessThanOrEqual(cells[i - 1]);
    });
  }
});

describe('placement', () => {
  const d: Design = { hull: 'coastal', blocks: [] };
  it('blocks the wrong deck, outside the hull and overlaps', () => {
    expect(canPlace(d, 'PO', 1, 5, 1, 2, 2).ok).toBe(false); // pool is top deck only
    expect(canPlace(d, 'PO', 4, 5, 1, 2, 2).ok).toBe(true);
    expect(canPlace(d, 'IN', 1, 15, 0, 1, 1).ok).toBe(false); // bow taper
    expect(canPlace(d, 'IN', 1, 0, 0, 1, 1).ok).toBe(false); // engine room
    const d2: Design = { hull: 'coastal', blocks: [{ uid: 'a', type: 'IN', deck: 2, c: 5, r: 2, w: 1, h: 1 }] };
    expect(canPlace(d2, 'IN', 2, 5, 2, 1, 1).ok).toBe(false);
    expect(canPlace(d2, 'IN', 2, 5, 2, 1, 1, 'a').ok).toBe(true);
  });
});

describe('inspection rules', () => {
  it('the Puffin passes with no red items and a calm trial', () => {
    const r = analyse(starter('puffin'));
    expect(r.errors).toBe(0);
    expect(seaTrial(r.specs).kind).toBe('ok');
  });
  it('Harbor Light has exactly one red problem: too few lifeboats', () => {
    const r = analyse(starter('harbor'));
    expect(r.issues.filter(i => i.lvl === 'err').map(i => i.key)).toEqual(['drydock.rule.lifeboats']);
  });
  it('the tutorial fix clears it', () => {
    const s = newGame();
    fixHarborLight(s);
    const r = analyse(bpById(s, 'bp2')!.design);
    expect(r.errors).toBe(0);
    expect(Math.abs(r.listDeg ?? 0)).toBeLessThan(3);
  });
  it('the liner template has no red items', () => {
    const r = analyse(starter('crown'));
    expect(r.errors).toBe(0);
    expect(r.pax).toBeGreaterThanOrEqual(600);
    expect(r.pax).toBeLessThanOrEqual(950);
  });
  it('flags galley, stairs, power, walls and crew', () => {
    const d: Design = {
      hull: 'coastal', blocks: [
        { uid: 'g', type: 'GA', deck: 2, c: 8, r: 2, w: 2, h: 1 },
        { uid: 'o', type: 'OV', deck: 2, c: 8, r: 3, w: 1, h: 1 },
        { uid: 's', type: 'SW', deck: 3, c: 8, r: 1, w: 1, h: 1 },
        { uid: 'p', type: 'TH', deck: 2, c: 3, r: 0, w: 3, h: 2 },
      ],
    };
    const keys = analyse(d).issues.map(i => i.key);
    expect(keys).toContain('drydock.rule.galleyAlone');
    expect(keys).toContain('drydock.rule.needsWall');
    expect(keys).toContain('drydock.rule.stairAlign');
    expect(keys).toContain('drydock.rule.noStairs');
  });
  it('top-deck weight lowers GM until the trial capsizes', () => {
    const d = cloneDesign(starter('puffin'));
    const base = analyse(d).gm;
    let k = 0;
    for (let c = 2; c <= 12; c += 2) for (const r of [0, 2]) {
      if (canPlace(d, 'PO', 4, c, r, 2, 2).ok) d.blocks.push({ uid: 'p' + k++, type: 'PO', deck: 4, c, r, w: 2, h: 2 });
    }
    const r = analyse(d);
    expect(r.gm).toBeLessThan(base);
    expect(seaTrial(r.specs).capsize).toBe(true);
  });
  it('an off-centre load makes the ship list', () => {
    const d: Design = { hull: 'coastal', blocks: [] };
    for (let c = 3; c <= 11; c += 2) d.blocks.push({ uid: 't' + c, type: 'TK', deck: 1, c, r: 0, w: 2, h: 1 });
    const r = analyse(d);
    expect(r.listDeg!).toBeLessThan(-LIST_LIMIT);
  });
});
const LIST_LIMIT = 3;

describe('trial, commission and refit', () => {
  it('a trial is tied to the exact layout', () => {
    const s = newGame();
    s.unlocked.drydock = true;
    fixHarborLight(s);
    const bp = bpById(s, 'bp2')!;
    expect(trialStatus(s, bp)).toBe('none');
    const run = runTrial(s, 'bp2');
    expect(run.result?.capsize).toBe(false);
    expect(trialStatus(s, bp)).toBe('passed');
    bp.design.blocks.pop();
    expect(trialStatus(s, bp)).toBe('stale');
    expect(canCommission(s, bp).ok).toBe(false);
  });
  it('commissioning costs money and adds a ship a week later', () => {
    const s = newGame();
    fixHarborLight(s);
    runTrial(s, 'bp2');
    const cash = s.cash;
    const r = commission(s, 'bp2', 'BOS');
    expect('ship' in r).toBe(true);
    expect(s.ships.length).toBe(2);
    expect(s.cash).toBeLessThan(cash);
    expect(s.ships[1].day).toBe(7);
  });
  it('a refit costs 30% of the changed blocks and takes 4 days', () => {
    const s = newGame();
    const before = cloneDesign(bpById(s, 'bp1')!.design);
    const bp = bpById(s, 'bp1')!;
    bp.design.blocks.push({ uid: 'z', type: 'BA', deck: 3, c: 2, r: 0, w: 1, h: 1 });
    expect(refitCost(before, bp.design)).toBe(Math.round(BLOCKS.BA.cost * 0.3));
    runTrial(s, 'bp1');
    const cash = s.cash;
    expect(refit(s, 's1').ok).toBe(true);
    expect(s.cash).toBe(cash - Math.round(BLOCKS.BA.cost * 0.3));
    expect(s.ships[0].day).toBe(4);
    expect(designHash(s.ships[0].design)).toBe(designHash(bp.design));
  });
});

describe('hull data', () => {
  it('coastal and liner match the design doc', () => {
    expect(hullOf('coastal')).toMatchObject({ decks: expect.any(Array), cols: 16, rows: 5, length: 118, beam: 19, draft: 4.8, airDraft: 27 });
    expect(hullOf('liner')).toMatchObject({ cols: 24, rows: 7, length: 228, beam: 30.5, draft: 7.9, airDraft: 46 });
    expect(hullOf('coastal').decks.length).toBe(4);
    expect(hullOf('liner').decks.length).toBe(6);
  });
});
