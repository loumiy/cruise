// Draws a region as a nautical chart: buff land, pale shallows, soundings, a compass rose and a scale bar.
import type { Region } from '../sim/data';
import { projector, mulberry, onLand } from '../sim/geo';
import { graphOf } from '../sim/route';
import { t } from '../sim/strings';
import { esc } from './dom';

export function ptsAttr(region: Region, arr: [number, number][]): string {
  const { proj } = projector(region);
  return arr.map(([lo, la]) => proj(lo, la).map(v => v.toFixed(1)).join(',')).join(' ');
}

export function chartSvg(region: Region): string {
  const { width: MW, height: MH, proj } = projector(region);
  const b = region.bounds;
  let s = '';
  for (let lo = Math.ceil(b.lon0 / 2) * 2; lo <= b.lon1; lo += 2) {
    const [x] = proj(lo, b.lat0);
    s += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + MH + '" stroke="var(--grat)" stroke-width="1"/><text x="' + (x + 3) + '" y="' + (MH - 6) + '" class="sound" style="font-style:normal">' + Math.abs(lo) + '°W</text>';
  }
  for (let la = Math.ceil(b.lat0) + 1; la < b.lat1; la += 1) {
    const [, y] = proj(b.lon0, la);
    s += '<line x1="0" y1="' + y + '" x2="' + MW + '" y2="' + y + '" stroke="var(--grat)" stroke-width="1"/><text x="' + (MW - 30) + '" y="' + (y - 3) + '" class="sound" style="font-style:normal">' + la + '°N</text>';
  }
  // Depth soundings in fathoms on open water, from a fixed seed so the chart never changes.
  const r = mulberry(46);
  let n = 0, tries = 0;
  while (n < 70 && tries < 3000) {
    tries++;
    const lo = b.lon0 + 1 + r() * (b.lon1 - b.lon0 - 1.5), la = b.lat0 + 0.3 + r() * (b.lat1 - b.lat0 - 0.8);
    const pad = 0.25;
    if ([[0, 0], [pad, 0], [-pad, 0], [0, pad * 0.7], [0, -pad * 0.7]].some(([dx, dy]) => onLand(region, [lo + dx, la + dy]))) continue;
    const [x, y] = proj(lo, la);
    const snd = region.soundings ?? { shallow: [12, 90] as [number, number], deep: [60, 1400] as [number, number] };
    const box = snd.deepBox;
    // Without a deep-water box, water far from any coast reads deep.
    const deep = box ? lo >= box[0] && la >= box[1] && lo <= box[2] && la <= box[3]
      : ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => onLand(region, [lo + dx, la + dy]));
    const [a0, a1] = deep ? snd.deep : snd.shallow;
    const v = Math.round(a0 + r() * (a1 - a0));
    s += '<text x="' + x.toFixed(0) + '" y="' + y.toFixed(0) + '" class="sound">' + v + '</text>';
    n++;
  }
  for (const k in region.land) s += '<polygon points="' + ptsAttr(region, region.land[k]) + '" fill="var(--shoal)" stroke="var(--shoal)" stroke-width="8" stroke-linejoin="round"/>';
  for (const k in region.land) s += '<polygon points="' + ptsAttr(region, region.land[k]) + '" fill="var(--land)" stroke="var(--land-edge)" stroke-width="1.2" stroke-linejoin="round"/>';
  for (const k in region.water ?? {}) {
    const pts = ptsAttr(region, region.water![k]);
    s += '<polygon points="' + pts + '" fill="var(--shoal)" stroke="var(--land-edge)" stroke-width="1.2" stroke-linejoin="round"/>';
    s += '<polygon points="' + pts + '" fill="var(--water)" stroke="var(--shoal)" stroke-width="6" stroke-linejoin="round"/>';
  }
  const g = graphOf(region);
  for (const e of g.edges) if (!e.canal) s += '<polyline points="' + ptsAttr(region, e.pts) + '" fill="none" stroke="var(--lane)" stroke-width="1" stroke-dasharray="2 4"/>';
  for (const e of g.edges) if (e.canal) s += '<polyline points="' + ptsAttr(region, e.pts) + '" fill="none" stroke="var(--ink-2)" stroke-width="2.5" stroke-dasharray="5 3"/>';
  for (const L of region.labels) {
    const [x, y] = proj(L.lon, L.lat);
    const cls = L.kind === 'land' ? 'land-lbl' : L.kind === 'water-sm' ? 'water-sm' : 'water-lbl';
    s += '<text x="' + x + '" y="' + y + '" class="' + cls + '" text-anchor="middle"' + (L.rot ? ' transform="rotate(' + L.rot + ' ' + x + ' ' + y + ')"' : '') + '>' + esc(L.text) + '</text>';
  }
  for (const [id, c] of Object.entries(region.canals)) {
    const [lo, la, dx, dy, anchor] = c.label;
    const [x, y] = proj(lo, la);
    s += '<text x="' + (x + dx) + '" y="' + (y + dy) + '" class="canal-lbl" text-anchor="' + anchor + '">' + esc(t('canal.' + id)) + '</text>';
  }
  const [rx, ry] = proj(region.compass.lon, region.compass.lat);
  s += '<g transform="translate(' + rx + ' ' + ry + ')" fill="none" stroke="var(--ink-2)"><circle r="44" stroke-width="1"/><circle r="36" stroke-width=".7"/>';
  for (let a = 0; a < 360; a += 10) {
    const L = a % 90 === 0 ? 10 : a % 30 === 0 ? 6 : 3, ra = a * Math.PI / 180;
    s += '<line x1="' + (Math.sin(ra) * 44).toFixed(1) + '" y1="' + (-Math.cos(ra) * 44).toFixed(1) + '" x2="' + (Math.sin(ra) * (44 - L)).toFixed(1) + '" y2="' + (-Math.cos(ra) * (44 - L)).toFixed(1) + '" stroke-width=".8"/>';
  }
  s += '<path d="M0 -34 L6 0 L0 34 L-6 0 Z M-34 0 L0 -5 L34 0 L0 5 Z" fill="var(--sheet)" stroke-width="1"/><path d="M0 -34 L6 0 L-6 0 Z" fill="var(--accent)" stroke="none"/><text y="-50" text-anchor="middle" fill="var(--ink-2)" stroke="none" font-family="IBM Plex Mono, monospace" font-size="11" font-weight="600">N</text></g>';
  // Scale bar. One minute of latitude is one nautical mile, so px per nm is scale / 60.
  const [sx, sy] = proj(region.scaleBar.lon, region.scaleBar.lat);
  const ppn = pxPerNm(region), step = ppn >= 0.8 ? 50 : 100, w = step * ppn;
  s += '<g transform="translate(' + sx + ' ' + sy + ')" font-family="IBM Plex Mono, monospace" font-size="10" fill="var(--ink-2)"><rect x="0" y="0" width="' + w + '" height="5" fill="var(--ink-2)"/><rect x="' + w + '" y="0" width="' + w + '" height="5" fill="var(--sheet)" stroke="var(--ink-2)"/><text x="0" y="17">0</text><text x="' + w + '" y="17" text-anchor="middle">' + step + '</text><text x="' + 2 * w + '" y="17" text-anchor="middle">' + 2 * step + ' nm</text></g>';
  s += '<g id="stormLayer"></g><g id="routeLayer"></g><g id="portLayer"></g><g id="shipLayer"></g>';
  return '<svg id="map" viewBox="0 0 ' + MW.toFixed(0) + ' ' + MH.toFixed(0) + '" role="img" aria-label="' + esc(t('chart.aria', { region: region.name })) + '">' + s + '</svg>';
}

export const pxPerNm = (region: Region) => region.bounds.scale / 60;

export function shipGlyph(x: number, y: number, ang: number): string {
  return '<g transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + ang.toFixed(0) + ')"><path d="M-11 -4 L7 -4 L12 0 L7 4 L-11 4 Z" fill="var(--sheet)" stroke="var(--ink)" stroke-width="1.6"/><rect x="-6" y="-2" width="7" height="4" fill="var(--accent)"/></g>';
}
