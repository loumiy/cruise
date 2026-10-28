import { newGame, report, bpById, shipById, type GameState } from '../src/sim/game';
import { REGIONS } from '../src/sim/data';
import type { Placed } from '../src/sim/ship';

export const NE = REGIONS.northeast;

/** The tutorial fix: one lifeboat on the empty starboard rail of deck 3. */
export function fixHarborLight(s: GameState): void {
  const bp = bpById(s, 'bp2')!;
  const lb: Placed = { uid: 'fix1', type: 'LB', deck: 3, c: 9, r: 4, w: 2, h: 1 };
  bp.design.blocks.push(lb);
}

export function freshGame(): GameState {
  const s = newGame('campaign');
  s.plan.fare = 240;
  return s;
}

export { report, shipById };
