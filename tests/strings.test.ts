// The plain-language pass, automated. Budgets come from the design doc's writing rules.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { allStrings, has } from '../src/sim/strings';
import { BLOCKS, EVENTS, FIRST_DP, HULLS, MILESTONES, REGIONS, TECH } from '../src/sim/data';
import { STEPS } from '../src/ui/tutorial';

const S = allStrings();
const words = (s: string) => s.replace(/\{\w+\}/g, 'X').replace(/<[^>]+>/g, '').split(/\s+/).filter(w => /[\p{L}\p{N}$]/u.test(w));
const sentences = (s: string) => s.replace(/<[^>]+>/g, '').split(/(?<=[.!?…])\s+(?=[A-Z{$])/).map(x => x.trim()).filter(Boolean);

function srcFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? srcFiles(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []);
}
const SRC = srcFiles(path.join(__dirname, '../src')).map(f => fs.readFileSync(f, 'utf8')).join('\n');

describe('every string the code asks for exists', () => {
  it('literal keys', () => {
    const missing: string[] = [];
    for (const m of SRC.matchAll(/\b(t|tn)\('([a-zA-Z0-9.]+)'/g)) {
      const [, fn, key] = m;
      if (key.endsWith('.')) continue; // dynamic, checked below
      if (fn === 'tn') { if (!has(key + '.one') || !has(key + '.other')) missing.push(key + '.one/.other'); }
      else if (!has(key)) missing.push(key);
    }
    for (const m of SRC.matchAll(/(?:add\('(?:err|warn)', |\b[EWI]\(|key: |notes\.push\(|\[')(?:')?((?:drydock|plan|trial|chart|company)\.[a-zA-Z.]+)'/g)) {
      const key = m[1];
      if (key.endsWith('.')) continue;
      if (!has(key)) missing.push(key);
    }
    expect(missing).toEqual([]);
  });
  it('data-driven keys', () => {
    const need: string[] = [];
    for (const id of Object.keys(BLOCKS)) need.push('block.' + id + '.name', 'block.' + id + '.tip');
    for (const n of TECH.nodes) need.push('tech.' + n.id + '.name', 'tech.' + n.id + '.desc');
    for (const b of TECH.branches) need.push('tech.branch.' + b);
    for (const list of Object.values(MILESTONES)) for (const m of list) need.push(...['name', 'goal', 'reward'].map(k => 'milestone.' + m.id + '.' + k));
    for (const e of EVENTS) {
      if (e.scaleByHull) need.push(...['rough', 'lively', 'calm'].map(k => 'event.' + e.id + '.' + k));
      else need.push('event.' + e.id);
    }
    for (const k of Object.keys(FIRST_DP)) need.push('first.' + k);
    for (const h of Object.keys(HULLS)) need.push('hull.' + h);
    for (const r of Object.values(REGIONS)) {
      for (const s of r.seasons) need.push('season.' + s.id);
      for (const c of Object.keys(r.canals)) need.push('canal.' + c);
      for (const e of r.edges) if (e[2]?.scenic) need.push('scenic.' + e[2].scenic);
      for (const p of Object.values(r.ports)) need.push('country.' + p.country);
    }
    for (const s of STEPS) need.push('tutorial.' + s.id);
    for (const r of ['bottom', 'lower', 'middle', 'upper', 'top', 'boat', 'any']) need.push('role.' + r);
    for (const g of new Set(Object.values(BLOCKS).map(b => b.group))) if (g !== 'Fixed') need.push('drydock.group.' + g);
    for (const c of ['owned', 'tier', 'dp']) need.push('company.tech.cant.' + c);
    expect(need.filter(k => !has(k))).toEqual([]);
  });
});

describe('writing budgets', () => {
  const entries = Object.entries(S);
  it('no sentence runs over 20 words', () => {
    const long = entries.flatMap(([k, v]) => sentences(v).filter(x => words(x).length > 20).map(x => k + ': ' + x));
    expect(long).toEqual([]);
  });
  it('no semicolons or dashes joining two thoughts', () => {
    const bad = entries.filter(([, v]) => /;|\s[—–]\s/.test(v.replace(/<[^>]+>/g, '')));
    expect(bad.map(([k]) => k)).toEqual([]);
  });
  it('every warning and error names a fix', () => {
    const rules = entries.filter(([k]) => /^(drydock\.rule|plan)\./.test(k) && !/^plan\.(tender|canal)$/.test(k) && k !== 'plan.port.unknown');
    const noFix = rules.filter(([, v]) => sentences(v).length !== 2);
    expect(noFix.map(([k, v]) => k + ': ' + v)).toEqual([]);
  });
  it('voyage log events are one sentence of 20 words or fewer', () => {
    const bad = entries.filter(([k]) => k.startsWith('event.')).filter(([, v]) => sentences(v).length !== 1 || words(v).length > 20);
    expect(bad.map(([k, v]) => k + ': ' + v)).toEqual([]);
  });
  it('tooltips are one line of 12 words or fewer', () => {
    const bad = entries.filter(([k]) => /^block\..+\.tip$/.test(k) && words(S[k]).length > 12);
    expect(bad.map(([k]) => k)).toEqual([]);
  });
  it('tutorial steps are one sentence and one action', () => {
    const bad = STEPS.map(s => 'tutorial.' + s.id).filter(k => sentences(S[k]).length !== 1);
    expect(bad).toEqual([]);
  });
  it('milestone goals are 6 words or fewer', () => {
    const bad = entries.filter(([k]) => /^milestone\..+\.goal$/.test(k) && words(S[k]).length > 6);
    expect(bad.map(([k, v]) => k + ': ' + v)).toEqual([]);
  });
});
