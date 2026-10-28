// The sea trial animation: a bow-on view of the ship rolling in a 2.5 m beam swell.
import { t } from '../sim/strings';
import { BLOCKS } from '../sim/data';
import type { Design, DesignReport } from '../sim/ship';
import { hullOf } from '../sim/ship';
import type { TrialResult } from '../sim/trial';
import { GM_MIN } from '../sim/ship';
import { cssVar } from './dom';

export interface TrialAnim { stop(): void }

export function playTrial(canvas: HTMLCanvasElement, design: Design, rep: DesignReport, res: TrialResult, reduced: boolean, onDone: () => void): TrialAnim {
  const dur = reduced ? 0 : 6500;
  const t0 = performance.now();
  let raf = 0, stopped = false;
  const omega = 2 * Math.PI / Math.max(1.2, res.period / 4); // time-compressed roll
  const step = (now: number) => {
    if (stopped) return;
    const tt = (now - t0) / 1000;
    let ang: number;
    if (res.capsize) {
      const k = Math.min(1, tt / 4.5);
      ang = res.list + (rep.gm <= 0 ? 6 : res.amp) * Math.sin(omega * tt) * (1 - k) + Math.sign(res.list || 1) * Math.pow(k, 2.2) * 120;
    } else ang = res.list + res.amp * Math.sin(omega * tt) * Math.min(1, tt / 1.2);
    draw(canvas, design, rep, ang, tt, res.capsize ? Math.max(0, (tt - 3.8) * 30) : 0);
    if (now - t0 < dur) raf = requestAnimationFrame(step);
    else onDone();
  };
  if (reduced) {
    draw(canvas, design, rep, res.list + (res.capsize ? 120 : res.amp), 0, 0);
    onDone();
  } else raf = requestAnimationFrame(step);
  return { stop() { stopped = true; cancelAnimationFrame(raf); } };
}

export function drawStill(canvas: HTMLCanvasElement, design: Design, rep: DesignReport) {
  draw(canvas, design, rep, 0, 0, 0);
}

function draw(cv: HTMLCanvasElement, design: Design, rep: DesignReport, angDeg: number, tt: number, sink: number) {
  const x = cv.getContext('2d');
  if (!x) return;
  const hull = hullOf(design);
  const W = cv.width, H = cv.height;
  x.fillStyle = cssVar('--sky'); x.fillRect(0, 0, W, H);
  const water = H * 0.62;
  const wave = (px: number) => water + Math.sin(px / 90 + tt * 1.6) * 10;
  x.save();
  x.translate(W / 2, water + sink);
  x.rotate(angDeg * Math.PI / 180);
  const nd = hull.decks.length;
  const bw = 300, deckH = Math.min(34, 150 / nd), keel = 70;
  x.lineWidth = 3; x.strokeStyle = cssVar('--ink'); x.fillStyle = cssVar('--sheet');
  x.beginPath(); x.moveTo(-bw / 2, -40); x.lineTo(bw / 2, -40); x.lineTo(bw / 2 - 20, keel - 20); x.quadraticCurveTo(0, keel + 10, -bw / 2 + 20, keel - 20); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = cssVar('--err'); x.globalAlpha = .75; x.fillRect(-bw / 2 + 22, keel - 50, bw - 44, 12); x.globalAlpha = 1;
  for (let d = 1; d <= nd; d++) {
    // Deck width follows the mask: count the widest row.
    const rows = hull.decks[d - 1].mask.filter(r => r.includes('#')).length;
    const w = bw * rows / hull.rows * (d > nd - 1 ? 0.75 : d > nd - 2 ? 0.9 : 1);
    const y = -40 - d * deckH;
    const filled = design.blocks.some(b => b.deck === d);
    x.fillStyle = filled ? cssVar('--c-cabin') : cssVar('--sheet');
    x.fillRect(-w / 2, y, w, deckH); x.strokeRect(-w / 2, y, w, deckH);
    const boats = design.blocks.filter(b => b.deck === d && BLOCKS[b.type].souls);
    if (boats.length) {
      x.fillStyle = cssVar('--c-safety');
      const port = (b: { r: number; h: number }) => b.r + b.h / 2 < hull.rows / 2;
      if (boats.some(port)) { x.fillRect(-w / 2 - 26, y + 6, 24, deckH - 12); x.strokeRect(-w / 2 - 26, y + 6, 24, deckH - 12); }
      if (boats.some(b => !port(b))) { x.fillRect(w / 2 + 2, y + 6, 24, deckH - 12); x.strokeRect(w / 2 + 2, y + 6, 24, deckH - 12); }
    }
    if (design.blocks.some(b => b.deck === d && b.type === 'PO')) { x.fillStyle = cssVar('--sea-2'); x.fillRect(-30, y - 8, 60, 8); }
  }
  // Centre of gravity, scaled from keel height.
  const top = hull.decks[nd - 1].z + 1.5;
  const gy = keel - (rep.kg / top) * (keel + 40 + nd * deckH);
  x.fillStyle = rep.gm >= GM_MIN ? cssVar('--ok') : rep.gm > 0 ? cssVar('--warn') : cssVar('--err');
  x.beginPath(); x.arc(0, gy, 7, 0, 7); x.fill(); x.stroke();
  x.restore();
  x.fillStyle = cssVar('--sea'); x.globalAlpha = .88;
  x.beginPath(); x.moveTo(0, H);
  for (let px = 0; px <= W; px += 12) x.lineTo(px, wave(px));
  x.lineTo(W, H); x.closePath(); x.fill(); x.globalAlpha = 1;
  x.strokeStyle = cssVar('--sea-2'); x.lineWidth = 2; x.beginPath();
  for (let px = 0; px <= W; px += 12) x.lineTo(px, wave(px));
  x.stroke();
  x.fillStyle = cssVar('--ink'); x.font = '600 26px "IBM Plex Mono", monospace';
  x.fillText(t('trial.heel', { deg: Math.abs(angDeg) > 99 ? '—' : Math.abs(angDeg).toFixed(1) + '°' }), 24, 44);
  x.font = '500 20px "IBM Plex Mono", monospace';
  x.fillText(t('trial.gm', { gm: rep.gm.toFixed(2) }), 24, 74);
}
