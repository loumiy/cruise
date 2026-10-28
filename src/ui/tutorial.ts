// The guided first cruise. One sentence and one action per step. Skippable at any step.
import { t } from '../sim/strings';
import { draftPlan, planFinance, report, trialStatus } from '../sim/game';
import { $$, esc } from './dom';
import type { App, ScreenId } from './app';

interface Step {
  id: string;
  screen: ScreenId;
  /** CSS selector for the thing to point at. */
  target: string;
  done(app: App): boolean;
  /** Runs once when the step starts. */
  enter?(app: App): void;
}

const harbor = (app: App) => app.state.blueprints.find(b => b.id === 'bp2');

export const STEPS: Step[] = [
  { id: 'addBarHarbor', screen: 'chartroom', target: '[data-port="BHB"]', done: a => a.state.plan.stops.includes('BHB') || a.state.voyages > 0 },
  {
    id: 'addHalifax', screen: 'chartroom', target: '[data-port="HFX"]',
    done: a => {
      if (a.state.voyages > 0) return true;
      const p = draftPlan(a.state);
      return !!p && !p.issues.some(i => i.key.startsWith('plan.pvsa'));
    },
  },
  {
    id: 'fillShip', screen: 'chartroom', target: '[data-tut="fare"]',
    done: a => {
      if (a.state.voyages > 0) return true;
      const p = draftPlan(a.state);
      return !!p && planFinance(a.state, p).occ >= 0.98;
    },
  },
  { id: 'sail', screen: 'chartroom', target: '[data-tut="sail"]', done: a => a.state.voyages > 0 },
  { id: 'openDrydock', screen: 'chartroom', target: '[data-tut="nav-drydock"]', done: a => a.screen === 'drydock' || a.state.ships.length > 1 },
  {
    id: 'addLifeboat', screen: 'drydock', target: '[data-type="LB"]',
    enter: a => { if (harbor(a)) { a.ui.bpId = 'bp2'; a.ui.deck = 3; } },
    done: a => {
      const bp = harbor(a);
      return !bp || a.state.ships.length > 1 || !report(a.state, bp.design).issues.some(i => i.key === 'drydock.rule.lifeboats');
    },
  },
  {
    id: 'seaTrial', screen: 'drydock', target: '[data-tut="trial"]',
    done: a => { const bp = harbor(a); return !bp || a.state.ships.length > 1 || trialStatus(a.state, bp) === 'passed'; },
  },
  { id: 'commission', screen: 'drydock', target: '[data-tut="commission"]', done: a => a.state.ships.length > 1 },
  { id: 'sailNew', screen: 'chartroom', target: '[data-tut="ships"]', done: a => a.state.voyages > 1 },
];

export class Tutorial {
  private app: App;
  private entered = -1;
  constructor(app: App) { this.app = app; }

  get active(): boolean {
    const tu = this.app.state.tutorial;
    return !tu.off && tu.step < STEPS.length;
  }

  step(): Step | null {
    return this.active ? STEPS[this.app.state.tutorial.step] : null;
  }

  /** Advance past every finished step. */
  check() {
    const tu = this.app.state.tutorial;
    let moved = false;
    while (this.active && STEPS[tu.step].done(this.app)) { tu.step++; moved = true; }
    if (moved && !this.active) this.app.toast(t('tutorial.finished'), 'ok');
    const s = this.step();
    if (s && this.entered !== tu.step) {
      this.entered = tu.step;
      if (s.enter) { s.enter(this.app); if (this.app.screen === s.screen) queueMicrotask(() => this.app.renderAll()); }
    }
  }

  skip() {
    this.app.state.tutorial.off = true;
    this.app.state.unlocked.drydock = true;
    this.app.commit();
  }

  render() {
    this.check();
    const bar = document.getElementById('tutbar');
    $$('.tut-target').forEach(n => n.classList.remove('tut-target'));
    if (!bar) return;
    const s = this.step();
    if (!s) { bar.hidden = true; return; }
    bar.hidden = false;
    const here = this.app.screen === s.screen;
    // When the step lives on another screen, point at its tab instead.
    const msg = here ? t('tutorial.' + s.id) : t('tutorial.goTo', { screen: t('screen.' + s.screen) });
    bar.innerHTML = '<div class="row"><span class="step">' + esc(t('tutorial.stepOf', { n: this.app.state.tutorial.step + 1, of: STEPS.length })) + '</span>' +
      '<span class="msg">' + esc(msg) + '</span><button type="button" class="btn sm" data-skip>' + esc(t('tutorial.skip')) + '</button></div>';
    bar.querySelector<HTMLButtonElement>('[data-skip]')!.onclick = () => this.skip();
    const sel = here ? s.target : '[data-tut="nav-' + s.screen + '"]';
    $$(sel).forEach(n => n.classList.add('tut-target'));
  }
}
