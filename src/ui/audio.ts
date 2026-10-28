// Soft interface sounds, made in code: a click, a ship's horn on departure, a low tone when a rule turns red,
// and a quiet surf bed. Nothing plays until the player has interacted with the page.
import type { Settings } from './settings';

let ctx: AudioContext | null = null;
let ambience: { gain: GainNode; src: AudioBufferSourceNode } | null = null;

function ac(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new C();
  } catch { ctx = null; }
  return ctx;
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', glide?: number) {
  const a = ac();
  if (!a || vol <= 0) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (glide) o.frequency.linearRampToValueAtTime(glide, a.currentTime + dur);
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(vol, a.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur + 0.05);
}

export const sound = {
  click(s: Settings) { tone(880, 0.05, 0.05 * s.effects, 'triangle'); },
  horn(s: Settings) {
    tone(110, 1.4, 0.18 * s.effects, 'sawtooth');
    tone(138.6, 1.4, 0.1 * s.effects, 'sawtooth');
  },
  red(s: Settings) { tone(196, 0.35, 0.12 * s.effects, 'sine', 160); },
  good(s: Settings) { tone(660, 0.12, 0.08 * s.effects, 'triangle'); setTimeout(() => tone(880, 0.18, 0.08 * s.effects, 'triangle'), 110); },
  setAmbience(s: Settings) {
    const a = ac();
    if (!a) return;
    if (s.ambience <= 0) {
      if (ambience) { ambience.src.stop(); ambience = null; }
      return;
    }
    if (!ambience) {
      // Brown noise through a slow low-pass: a calm surf bed.
      const len = a.sampleRate * 4, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const lfo = a.createOscillator(), lfoGain = a.createGain();
      lfo.frequency.value = 0.08; lfoGain.gain.value = 250;
      lfo.connect(lfoGain).connect(lp.frequency); lfo.start();
      const gain = a.createGain();
      src.connect(lp).connect(gain).connect(a.destination);
      src.start();
      ambience = { gain, src };
    }
    ambience.gain.gain.value = 0.25 * s.ambience;
  },
  resume() { void ctx?.resume(); },
};
