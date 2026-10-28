import { describe, expect, it } from 'vitest';
import { REGIONS } from '../src/sim/data';
import { dateOf } from '../src/sim/calendar';
import { serialise, deserialise } from '../src/sim/save';
import { bestFare, summarise } from '../src/sim/economy';
import { newGame, regionOf } from '../src/sim/game';
import {
  newFleetGame, toFleet, runSeason, assignmentFor, setDeployment, setLayup, toggleDock, clearSeason, repoCheck,
  seasonStart, seasonAt, seasonName, seasonYear, planningDay, deploymentPlan, crowdShare, regionLoad, breakdownOdds,
  dockDue, agePenalty, ageYears, companyValue, fleetGoals, repTarget, lineSummary, rivalShare, type Deployment,
} from '../src/sim/fleet';

const named = (s: ReturnType<typeof newFleetGame>, name: string) => s.ships.find(x => x.name === name)!;

describe('fleet calendar', () => {
  it('four seasons a year; winter starts on 1 December', () => {
    const idx = 2032 * 4;
    expect(seasonName(idx)).toBe('winter');
    expect(seasonYear(idx)).toBe(2032);
    const d = dateOf(seasonStart(idx));
    expect([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]).toEqual([2031, 12, 1]);
    for (let k = 0; k < 8; k++) {
      expect(seasonAt(seasonStart(idx + k))).toBe(idx + k);
      expect(seasonAt(seasonStart(idx + k + 1) - 1)).toBe(idx + k);
    }
    const len = seasonStart(idx + 1) - seasonStart(idx);
    expect(len).toBeGreaterThanOrEqual(89);
    expect(len).toBeLessThanOrEqual(92);
  });
});

describe('a new fleet game', () => {
  it('starts with five ships across the regions and a first year planned', () => {
    const s = newFleetGame();
    expect(s.mode).toBe('fleet');
    expect(s.ships.length).toBe(5);
    expect(new Set(s.ships.map(x => x.region)).size).toBeGreaterThanOrEqual(3);
    for (const sh of s.ships) {
      const a = assignmentFor(s, sh.id, s.fleet!.season);
      expect(!!a.dep || a.layup).toBe(true);
    }
  });
  it('plans carry into later seasons until changed; drydock is per season', () => {
    const s = newFleetGame(), sh = named(s, 'MS Harbor Majesty'), idx = s.fleet!.season;
    const first = assignmentFor(s, sh.id, idx);
    expect(assignmentFor(s, sh.id, idx + 1).dep).toEqual(first.dep);
    expect(assignmentFor(s, sh.id, idx + 1).carried).toBe(true);
    setLayup(s, sh.id, idx + 1);
    expect(assignmentFor(s, sh.id, idx + 1).layup).toBe(true);
    clearSeason(s, sh.id, idx + 1);
    expect(assignmentFor(s, sh.id, idx + 1).dep).toEqual(first.dep);
    toggleDock(s, sh.id, idx + 1);
    expect(assignmentFor(s, sh.id, idx + 1).dock).toBe(true);
    expect(assignmentFor(s, sh.id, idx + 2).dock).toBe(false);
  });
});

describe('repositioning', () => {
  it('uses the crossing checks: the Mega is too tall for Panama, the Liner crosses the Atlantic', () => {
    const s = newFleetGame();
    const maj = named(s, 'MS Harbor Majesty'), crown = named(s, 'MS Northern Crown');
    expect(repoCheck(s, maj, 'alaska')!.issues.map(i => i.key)).toContain('cross.tooTall');
    expect(repoCheck(s, crown, 'europe')!.ok).toBe(true);
  });
  it('a season in a new region starts with the repositioning cruise', () => {
    const s = newFleetGame(), crown = named(s, 'MS Northern Crown'), idx = s.fleet!.season;
    const dep: Deployment = { region: 'europe', from: 'BCN', stops: ['PMI', 'MRS', 'VFR', 'LIV'], nights: 7, fare: 200, wait: 0 };
    setDeployment(s, crown.id, idx, dep);
    const r = runSeason(s);
    expect(crown.region).toBe('europe');
    const row = r.ships.find(x => x.shipId === crown.id)!;
    expect(row.notes.map(n => n.key)).toContain('fleet.note.repositioned');
  });
});

describe('running a season', () => {
  it('plays out about 13 weeks for every ship and books the profit', () => {
    const s = newFleetGame(), idx = s.fleet!.season, cash = s.cash, voyages = s.voyages;
    const r = runSeason(s);
    expect(s.fleet!.season).toBe(idx + 1);
    expect(s.cash).toBe(cash + r.profit);
    expect(s.voyages).toBeGreaterThan(voyages + 20);
    for (const sh of s.ships) expect(sh.day).toBeGreaterThanOrEqual(seasonStart(idx + 1));
    expect(r.ships.find(x => x.ship === 'MV Puffin')!.notes.map(n => n.key)).toContain('fleet.note.laidUp');
  });
  it('a closed season cancels departures: Alaska in winter', () => {
    const s = newFleetGame(), tern = named(s, 'MV Northern Tern'), idx = s.fleet!.season;
    setDeployment(s, tern.id, idx, { region: 'alaska', from: 'YVR', stops: ['KTN', 'JNU', 'SGY'], nights: 7, fare: 400, wait: 0, lowSulfur: true });
    const r = runSeason(s);
    const row = r.ships.find(x => x.shipId === tern.id)!;
    expect(row.cruises).toBe(0);
    expect(row.notes.map(n => n.key)).toContain('fleet.note.skipped');
  });
  it('your own ships in one region share its guests', () => {
    expect(crowdShare(1)).toBe(1);
    expect(crowdShare(3)).toBeLessThan(crowdShare(2));
    const s = newFleetGame();
    expect(regionLoad(s, s.fleet!.season).caribbean).toBeGreaterThanOrEqual(3);
  });
  it('reputation drifts toward what guests think', () => {
    expect(repTarget(65)).toBe(3);
    expect(repTarget(90)).toBe(5);
    const s = newFleetGame();
    for (let i = 0; i < 4; i++) runSeason(s);
    expect(s.rep).toBeGreaterThan(1);
    expect(s.rep).toBeLessThan(5);
  });
});

describe('ship life', () => {
  it('old ships lose appeal; overdue ships break down', () => {
    expect(agePenalty(5)).toBe(0);
    expect(agePenalty(14)).toBeGreaterThan(0);
    const s = newFleetGame(), puffin = named(s, 'MV Puffin');
    expect(ageYears(puffin, seasonStart(s.fleet!.season))).toBeGreaterThan(10);
    expect(breakdownOdds(puffin, dockDue(puffin) - 1)).toBe(0);
    expect(breakdownOdds(puffin, dockDue(puffin) + 365)).toBeGreaterThan(0.1);
  });
  it('a drydock resets the clock', () => {
    const s = newFleetGame(), crown = named(s, 'MS Northern Crown'), idx = s.fleet!.season;
    const due = dockDue(crown);
    toggleDock(s, crown.id, idx);
    runSeason(s);
    expect(dockDue(crown)).toBeGreaterThan(due);
  });
});

describe('carrying a campaign into fleet mode', () => {
  it('keeps the company, drops the charter and starts the clock next season', () => {
    const s = newGame('campaign');
    s.ships.push({ ...s.ships[0], id: 'own', name: 'MS Own', chartered: false, day: 40 });
    const day = 40;
    toFleet(s);
    expect(s.mode).toBe('fleet');
    expect(s.ships.some(x => x.chartered)).toBe(false);
    expect(s.fleet!.season).toBeGreaterThan(seasonAt(day));
  });
  it('fleet state survives a save', () => {
    const s = newFleetGame();
    runSeason(s);
    const back = deserialise(serialise(s))!;
    expect(back.mode).toBe('fleet');
    expect(back.fleet!.season).toBe(s.fleet!.season);
    expect(back.fleet!.reports.length).toBe(1);
  });
});

/** Ten years, planned sensibly each season: sun in winter, the north in summer, docks on time. */
describe('a 10-year fleet game', () => {
  const plans: Record<string, Record<string, [string, string[], number][]>> = {
    northeast: { any: [['BOS', ['BHB', 'HFX'], 4]] },
    caribbean: { any: [['MIA', ['NAS', 'CZM', 'GCM'], 7], ['MIA', ['NAS', 'EYW'], 4]] },
    alaska: { any: [['YVR', ['KTN', 'JNU', 'SGY'], 7]] },
    europe: { any: [['BCN', ['PMI', 'MRS', 'VFR', 'LIV'], 7]] },
  };
  const route: Record<string, string[]> = {
    'MV Puffin': ['layup', 'layup', 'northeast', 'northeast'],
    'MS Northern Crown': ['caribbean', 'caribbean', 'northeast', 'northeast'],
    'MS Harbor Majesty': ['caribbean', 'caribbean', 'europe', 'caribbean'],
    'MV Northern Tern': ['caribbean', 'caribbean', 'alaska', 'caribbean'],
    'MS Atlantic Sovereign': ['caribbean', 'europe', 'europe', 'europe'],
  };
  it('runs 40 seasons without balance breaks', () => {
    const s = newFleetGame();
    let docks = 0, repos = 0, worst = Infinity, best = -Infinity;
    for (let i = 0; i < 40; i++) {
      const idx = s.fleet!.season;
      for (const sh of s.ships) {
        const want = route[sh.name][idx % 4];
        if (want === 'layup') { setLayup(s, sh.id, idx); continue; }
        for (const [from, stops, nights] of plans[want].any) {
          const dep: Deployment = { region: want, from, stops, nights, fare: 200, wait: 0, lowSulfur: true };
          const p = deploymentPlan(s, sh, dep, planningDay(idx));
          if (!p || p.issues.some(x => x.lvl === 'err' && x.key !== 'plan.offSeason' && x.key !== 'plan.seasonEnds')) continue;
          if (!p.errors) dep.fare = bestFare(p.input.region, p.input.ship, summarise(p), { rep: s.rep, demandBonus: s.demandBonus, share: crowdShare(3) }).fare;
          setDeployment(s, sh.id, idx, dep);
          break;
        }
        if (assignmentFor(s, sh.id, idx).dock === false && dockDue(sh) < seasonStart(idx + 1) + 60) toggleDock(s, sh.id, idx);
      }
      const r = runSeason(s);
      for (const x of r.ships) {
        if (x.notes.some(n => n.key === 'fleet.note.docked')) docks++;
        if (x.notes.some(n => n.key === 'fleet.note.repositioned')) repos++;
      }
      worst = Math.min(worst, r.profit); best = Math.max(best, r.profit);
      expect(Number.isFinite(s.cash)).toBe(true);
    }
    // Money grows but doesn't run away, and no single season breaks the company.
    expect(s.cash).toBeGreaterThan(40_000_000);
    expect(s.cash).toBeLessThan(1_000_000_000);
    expect(worst).toBeGreaterThan(-40_000_000);
    expect(best).toBeLessThan(80_000_000);
    expect(docks).toBeGreaterThan(10);
    expect(repos).toBeGreaterThan(20);
    expect(s.rep).toBeGreaterThan(2);
    expect(fleetGoals(s).find(g => g.id === 'decade')!.done).toBe(true);
    expect(companyValue(s)).toBeGreaterThan(s.cash);
  });
});

describe('rival lines', () => {
  it('three lines sail every region that has rivals, starting from the regions’ own ships', () => {
    const s = newFleetGame(), R = s.fleet!.rivals!;
    expect(new Set(R.ships.map(x => x.line))).toEqual(new Set(['azure', 'tradewind', 'coral']));
    const lines = lineSummary(s);
    expect(lines.map(l => l.line)).toEqual(['azure', 'tradewind', 'coral']);
    expect(lines.every(l => l.ships > 0)).toBe(true);
  });
  it('the chart shows the rivals’ current schedules and fares', () => {
    const s = newFleetGame();
    s.region = 'caribbean';
    const before = regionOf(s);
    expect(before.rivals.length).toBe(s.fleet!.rivals!.ships.filter(x => x.region === 'caribbean').length);
    s.fleet!.rivals!.fare.caribbean = 0.8;
    s.fleet!.rivalsRev! += 1;
    expect(regionOf(s).market.rivalFare).toBe(Math.round(REGIONS.caribbean.market.rivalFare * 0.8));
    expect(regionOf(s)).toBe(regionOf(s));
  });
  it('crowd a rival’s port day and it may move the call away', () => {
    const s = newFleetGame(), idx = s.fleet!.season;
    // Put every ship on the same Caribbean loop as a rival, on the same days.
    const rival = s.fleet!.rivals!.ships.find(x => x.region === 'caribbean' && x.line === 'tradewind')!;
    const port = Object.values(rival.calls)[0];
    let moved = 0;
    for (let k = 0; k < 8; k++) {
      for (const sh of s.ships) setDeployment(s, sh.id, idx + k, { region: 'caribbean', from: 'MIA', stops: [port], nights: 3, fare: 120, wait: k % 7 });
      const r = runSeason(s);
      moved += (r.rivalNews ?? []).filter(n => n.key === 'fleet.rival.move').length;
    }
    expect(moved).toBeGreaterThan(0);
  });
  it('take a big share of a region and its biggest line cuts fares; ease off and they recover', () => {
    const s = newFleetGame(), idx = s.fleet!.season;
    let cut = false;
    for (let k = 0; k < 12 && !cut; k++) {
      for (const sh of s.ships) setDeployment(s, sh.id, idx + k, { region: 'caribbean', from: 'MIA', stops: ['NAS', 'CZM', 'GCM'], nights: 7, fare: 120, wait: 0 });
      cut = (runSeason(s).rivalNews ?? []).some(n => n.key === 'fleet.rival.cut');
    }
    expect(cut).toBe(true);
    expect(s.fleet!.rivals!.fare.caribbean).toBeLessThan(1);
    for (const sh of s.ships) setLayup(s, sh.id, s.fleet!.season);
    for (let k = 0; k < 12; k++) runSeason(s);
    expect(s.fleet!.rivals!.fare.caribbean).toBe(1);
  });
  it('once a year the lines launch bigger ships, and big lines retire old ones', () => {
    const s = newFleetGame();
    const berths0 = lineSummary(s).reduce((a, l) => a + l.berths, 0);
    let launches = 0;
    for (let k = 0; k < 12; k++) launches += (runSeason(s).rivalNews ?? []).filter(n => n.key === 'fleet.rival.launch').length;
    expect(launches).toBeGreaterThan(0);
    expect(lineSummary(s).reduce((a, l) => a + l.berths, 0)).toBeGreaterThan(berths0);
    expect(s.fleet!.rivals!.ships.filter(x => x.line === 'azure').length).toBeLessThanOrEqual(14);
    expect(rivalShare(s, 'caribbean')).toBeLessThanOrEqual(1);
  });
});
