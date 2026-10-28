// The lane checker: no sea lane crosses land, and every waypoint is at sea.
import { describe, expect, it } from 'vitest';
import { REGIONS } from '../src/sim/data';
import { graphOf, coordOf } from '../src/sim/route';
import { onLand } from '../src/sim/geo';

for (const region of Object.values(REGIONS)) {
  describe(region.name, () => {
    it('every waypoint is at sea', () => {
      const wet = Object.entries(region.nodes).filter(([, p]) => onLand(region, p)).map(([k]) => k);
      expect(wet).toEqual([]);
    });
    it('no lane crosses land', () => {
      const bad: string[] = [];
      for (const e of graphOf(region).edges) {
        if (e.canal || e.scenic) continue; // canals and rivers run through land by design
        for (let i = 1; i < e.pts.length; i++) {
          const [a, b] = [e.pts[i - 1], e.pts[i]];
          // Ports sit on the coast, so skip the stretch right next to them.
          const skipA = i === 1 && e.a in region.ports ? 0.2 : 0, skipB = i === e.pts.length - 1 && e.b in region.ports ? 0.8 : 1;
          for (let k = 1; k < 40; k++) {
            const f = k / 40;
            if (f < skipA || f > skipB) continue;
            const p: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            if (onLand(region, p)) { bad.push(e.a + '–' + e.b + ' at ' + p.map(x => x.toFixed(2)).join(',')); break; }
          }
        }
      }
      expect(bad).toEqual([]);
    });
    it('every port is reachable', () => {
      const g = graphOf(region);
      for (const id of Object.keys(region.ports)) { expect(g.adj[id]?.length ?? 0).toBeGreaterThan(0); coordOf(region, id); }
    });
  });
}
