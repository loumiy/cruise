// Small DOM and formatting helpers shared by every screen.
import { t, tn } from '../sim/strings';

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ESC[c]);

export const money = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export const kmoney = (n: number) => {
  const a = Math.abs(n);
  const body = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? Math.round(a / 1000) + 'k' : String(Math.round(a));
  return (n < 0 ? '−$' : '$') + body;
};
export const signed = (n: number, d = 0) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d);

export function stars(rep: number): string {
  const full = Math.floor(rep), half = rep - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '');
}

/** Shape before words: every state has an icon as well as a colour. */
export const ICON = { err: '✕', warn: '!', info: 'i', ok: '✓' } as const;

export function el(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
}

export function gauge(label: string, valTxt: string, frac: number, state: 'ok' | 'warn' | 'err', sub?: string, markFrac?: number): string {
  const icon = ICON[state];
  return '<div class="gauge s-' + state + '"><div class="top"><span class="label">' + esc(label) + '</span><span class="val">' + icon + ' ' + esc(valTxt) + '</span></div>' +
    '<div class="bar"><b style="width:' + Math.max(2, Math.min(100, frac * 100)) + '%"></b>' +
    (markFrac != null ? '<span class="mk" style="left:' + Math.min(99, Math.max(0, markFrac * 100)) + '%"></span>' : '') + '</div>' +
    (sub ? '<div class="sub2">' + esc(sub) + '</div>' : '') + '</div>';
}

export function issueRow(lvl: 'err' | 'warn' | 'info', text: string, extra = '', attrs = ''): string {
  return '<button type="button" class="issue ' + lvl + '" ' + attrs + '><span class="ic" aria-label="' + esc(t('ui.level.' + lvl)) + '">' + ICON[lvl] + '</span><span>' + esc(text) + extra + '</span></button>';
}

export function plural(key: string, n: number) {
  return tn(key, n);
}

export const SVGNS = 'http://www.w3.org/2000/svg';

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
