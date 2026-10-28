// Bookings, fares and the cost of a cruise. Pure functions.
import type { Region } from './data';
import type { ShipSpecs } from './ship';
import type { Plan } from './planner';

export const FARE_MIN = 80;
export const FARE_MAX = 450;
export const FARE_STEP = 5;
export const CREW_WAGE = 95;
export const FOOD_PER_GUEST = 38;
export const NIGHTS_DEMAND: Record<number, number> = { 3: 1.15, 4: 1, 5: 0.92, 6: 0.85, 7: 0.8 };

/** What the economy needs from a plan. A real Plan fits; so does the Drydock's typical cruise. */
export interface PlanSummary {
  nights: number; score: number; burned: number; tolls: number; pilotage: number; seasonDemand: number;
  calls: { callFee: number; headTax: number; tenderFee: number }[];
  idleDays: number;
}

export interface Market { rep: number; demandBonus: number }

export interface Finance {
  mass: number; premium: number; booked: number; bookedMass: number; bookedPremium: number; occ: number;
  rev: number; onboard: number; crew: number; lease: number; food: number; fuel: number; ports: number;
  fees: number; cost: number; profit: number;
}

export function summarise(plan: Plan, idleDays = 0): PlanSummary {
  const P = plan.input.region.ports;
  return {
    nights: plan.input.nights, score: plan.score, burned: plan.burned, tolls: plan.tolls, pilotage: plan.pilotage,
    seasonDemand: plan.season?.demand ?? 1, idleDays,
    calls: plan.calls.map(c => {
      const p = P[c.id];
      return { callFee: p.callFee, headTax: p.headTax, tenderFee: p.berth === 'tender' ? (p.tenderFee ?? 2500) : 0 };
    }),
  };
}

/** Two markets: mass guests shop on price, premium guests pay more for a better trip. */
export function demand(region: Region, ship: Pick<ShipSpecs, 'luxury'>, p: Pick<PlanSummary, 'score' | 'nights' | 'seasonDemand'>, fare: number, mk: Market) {
  const m = region.market;
  const appealF = Math.pow(Math.max(p.score, 1) / 60, 1.4);
  const repF = Math.max(0.6, 1 + 0.1 * (mk.rep - 3)) * (1 + mk.demandBonus);
  const k = appealF * repF * p.seasonDemand * (NIGHTS_DEMAND[p.nights] ?? 0.8);
  const lux = Math.min(1.6, ship.luxury);
  const eff = fare / (1 + 0.35 * lux);
  const mass = m.mass * k * Math.min(3, Math.exp(-(eff - m.rivalFare) / m.massSens));
  const premium = m.premium * k * (0.6 + 0.5 * Math.min(1, lux)) * Math.min(2.5, Math.exp(-(eff - m.rivalFare) / m.premiumSens));
  return { mass, premium };
}

export function finance(region: Region, ship: ShipSpecs, p: PlanSummary, fare: number, mk: Market): Finance {
  const { mass, premium } = demand(region, ship, p, fare, mk);
  const booked = Math.min(ship.pax, Math.round(mass + premium));
  const share = mass + premium > 0 ? mass / (mass + premium) : 0.5;
  const bookedMass = Math.round(booked * share), bookedPremium = booked - bookedMass;
  const n = p.nights;
  const rev = booked * fare * n;
  const onboard = Math.round(booked * n * ship.spend);
  const crew = ship.crew * CREW_WAGE * n;
  const lease = ship.lease * (n + p.idleDays);
  const food = booked * n * FOOD_PER_GUEST;
  const fuel = Math.round(p.burned * region.fuelPrice);
  const ports = p.calls.reduce((s, c) => s + c.callFee + c.headTax * booked + c.tenderFee, 0);
  const fees = p.tolls + p.pilotage;
  const cost = crew + lease + food + fuel + ports + fees;
  return {
    mass, premium, booked, bookedMass, bookedPremium, occ: ship.pax ? booked / ship.pax : 0,
    rev, onboard, crew, lease, food, fuel, ports, fees, cost, profit: rev + onboard - cost,
  };
}

export function fareCurve(region: Region, ship: ShipSpecs, p: PlanSummary, mk: Market): [number, number][] {
  const out: [number, number][] = [];
  for (let f = FARE_MIN; f <= FARE_MAX; f += FARE_STEP) out.push([f, finance(region, ship, p, f, mk).profit]);
  return out;
}

export function bestFare(region: Region, ship: ShipSpecs, p: PlanSummary, mk: Market): { fare: number; profit: number } {
  let fare = FARE_MIN, profit = -Infinity;
  for (const [f, v] of fareCurve(region, ship, p, mk)) if (v > profit) { profit = v; fare = f; }
  return { fare, profit };
}

/** The Drydock's "typical cruise": 4 nights, 3 calls, 900 nm, appeal 60, best fare. */
export function typicalCruise(region: Region, ship: ShipSpecs, mk: Market = { rep: 3, demandBonus: 0 }) {
  const nights = 4, nmTotal = 900, speed = Math.min(ship.vmax, 12);
  const burned = nmTotal * ship.burnPerNm * Math.pow(speed / ship.vmax, 2) + ship.hotelTph * nights * 24;
  const p: PlanSummary = {
    nights, score: 60, burned, tolls: 0, pilotage: 0, seasonDemand: 1, idleDays: 0,
    calls: [0, 1, 2].map(() => ({ callFee: 1800, headTax: 18, tenderFee: 0 })),
  };
  const best = bestFare(region, ship, p, mk);
  return { fare: best.fare, fin: finance(region, ship, p, best.fare, mk) };
}

/** A fair price for an itinerary of this appeal. Charging more costs satisfaction. */
export function fairFare(score: number, luxury: number): number {
  return (100 + score * 2.5) * (1 + 0.35 * Math.min(1.6, luxury));
}
