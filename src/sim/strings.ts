// All player-facing text lives in data/strings.en.json. This file only looks it up.
import stringsJson from '../../data/strings.en.json';

type Tree = { [k: string]: string | Tree };
const FLAT: Record<string, string> = {};
(function flatten(node: Tree, prefix: string) {
  for (const k of Object.keys(node)) {
    const v = node[k];
    const key = prefix ? prefix + '.' + k : k;
    if (typeof v === 'string') FLAT[key] = v;
    else flatten(v, key);
  }
})(stringsJson as Tree, '');

export type Vars = Record<string, string | number>;

export function has(key: string): boolean {
  return key in FLAT;
}

/**
 * Look up a string and fill {placeholders}. Missing keys show the key so they're easy to spot.
 * A var written as "@some.key" is itself looked up, so sim code can pass names by key.
 */
export function t(key: string, vars?: Vars): string {
  const s = FLAT[key];
  if (s === undefined) return '⟨' + key + '⟩';
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in vars)) return m;
    const v = vars[k];
    return typeof v === 'string' && v.startsWith('@') ? t(v.slice(1)) : String(v);
  });
}

/** Pick the singular or plural form: keys "x.one" and "x.other". */
export function tn(key: string, n: number, vars?: Vars): string {
  return t(key + (n === 1 ? '.one' : '.other'), { n, ...vars });
}

export function allStrings(): Readonly<Record<string, string>> {
  return FLAT;
}
