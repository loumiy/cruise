// Per-player settings. These live in browser storage, separate from the save game.
export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  textScale: number; // 0.9 – 1.5
  motion: 'auto' | 'reduce';
  instant: boolean;
  speed: 1 | 2 | 4;
  effects: number; // 0 – 1
  ambience: number; // 0 – 1
}

const KEY = 'clm.settings';
export const DEFAULTS: Settings = { theme: 'auto', textScale: 1, motion: 'auto', instant: false, speed: 1, effects: 0.6, ambience: 0 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* private window or blocked storage */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function applySettings(s: Settings): void {
  const root = document.documentElement;
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.style.setProperty('--text-scale', String(Math.max(0.9, Math.min(1.5, s.textScale))));
  if (s.motion === 'reduce') root.setAttribute('data-motion', 'reduce');
  else root.removeAttribute('data-motion');
}

export function reducedMotion(s: Settings): boolean {
  if (s.motion === 'reduce') return true;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
