// Shared pieces of the `strategy-dp` tests (SP4.3b spec §6, plan 4.3b1 Task 18): a `DpInput` builder, the hazard by
// ruling R22, a deterministic race time for a fixed list of stops, and a closed-loop brute force over every action and
// every neutralisation outcome, written independently of the simulator.
//
// The model these tests read `DpInput` and `DpResult` by (the test agent's decisions, Task 18 report):
// - `fromLap` is the next lap the car drives in full: it is on the line at its start, `carParams` as there. The race
//   runs to the end of lap `totalLaps`. Every per-lap array has `totalLaps − fromLap + 1` entries, index 0 = `fromLap`.
// - A stop `{ lap: L, compound }` boxes at the end of lap L (in lap L, out lap L + 1), as `race-forecast` reads a
//   policy's stop; `fromLap ≤ L < totalLaps`, laps ascending and distinct; at most 3 stops (`maxStops`); each fits a
//   new set of its compound (`sets`), at wear 0 and lap on set 1.
// - A lap's time is `lap-model`'s `lapTimeMs` with no scatter and no mistake: the wear and fuel at the lap's start,
//   `lapOnSet` = laps already run on the set + 1, the lap's neutralisation, the lap's `wetnessByLap`. After the lap the
//   set's wear grows by `wearRatePct[compound]` (× the neutralised `wearFactor` on a neutralised lap) and fuel falls by
//   `fuelKg / (totalLaps − fromLap + 1)` (× `fuelFactor`); this burn runs the fuel to empty at the flag.
// - A stop at the end of lap L costs `pitLossMs[c]` with c the condition of lap L (green, VSC, SC), less
//   `HUMAN_STOP_SAVING_MS` for a human car, plus `trafficMsByLap` of lap L. The in-lap share only splits it in time.
// - Neutralisations: a green lap n may start an SC with chance `byLap` of lap n, else a VSC with `vscByLap`'s (the two
//   exclusive), lasting d laps with chance `scDur[d − 1]` (`vscDur`); laps n … n + d − 1 are neutralised. None starts on
//   the lap after a neutralisation's last lap. With `active`, lap `fromLap` is neutralised by it and its last lap is
//   `fromLap + k` with chance `remaining[k]`. A start and its length are known from the lap it starts on: the decision
//   at the end of a lap knows that lap's condition and the laps left of a neutralisation out.
// - The compound rule (`owesSecondCompound`): a plan must fit a dry compound other than the car's current one.
// - `DpResult.plans` holds one plan per compound sequence (the compounds of its stops in order) that can meet the rule
//   and the sets with at most 3 stops; its `expectedMs` is the expected remaining race time of the best closed-loop play
//   that makes exactly that sequence's stops; its `stops` are that play's stops where no neutralisation comes (the
//   green path). `plans` are sorted by `expectedMs`, the best first. `boxNow` and `stayOut` are the best closed-loop play
//   with a stop at the end of `fromLap` and without one; `boxNow` is `null` where no play boxing now can meet the rule
//   and the sets; `stayOut`, where no play without a stop now meets the rule, is the play that ignores it.
import { carId, NOISE_COMPOUNDS, type LapInput, type LapModelParams, type NoiseCompound, type TrackHazard } from '@pitwall/domain';
import { lapTimeMs } from '../../src/lap-model/index.ts';
import { HUMAN_STOP_SAVING_MS } from '../../src/race-forecast/constants.ts';
import type { DpCarParams, DpInput, DpPlan } from '../../src/strategy-dp/index.ts';
import { chanceOn } from '../race-hazard/support.ts';

export const PACE_MS = 90_000;
export const MAX_STOPS = 3;
export const DRY: readonly NoiseCompound[] = ['soft', 'medium', 'hard'];

/** Every term zero or neutral but the neutralised paces; neutralised laps wear the tyre and burn fuel as green ones. */
export const LAP: LapModelParams = {
  compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 0, wet: 0 },
  fuelMsPerKg: 0,
  convexFromPct: 40,
  convexMsPerPct2: 0,
  convexFlagged: true,
  coldTyreMs: [0, 0],
  coldTyreWetFactor: 1,
  neutralised: {
    sc: { paceFactor: 1.4, wearFactor: 1, fuelFactor: 1 },
    vsc: { paceFactor: 1.3, wearFactor: 1, fuelFactor: 1 },
  },
  wetnessMsPerMs: { slick: 0, inter: 0, wet: 0 },
};

export const NO_SETS: Record<NoiseCompound, number> = { soft: 0, medium: 0, hard: 0, inter: 0, wet: 0 };
export const WEAR_RATES: Record<NoiseCompound, number> = { soft: 3, medium: 2, hard: 1.5, inter: 2, wet: 2 };

export type DpSpec = {
  fromLap?: number;
  totalLaps?: number;
  lap?: LapModelParams;
  car?: Partial<DpCarParams>;
  sets?: Partial<Record<NoiseCompound, number>>;
  owesSecondCompound?: boolean;
  pitLossMs?: DpInput['pitLossMs'];
  /** Per lap (index 0 = `fromLap`); missing laps 0. */
  scByLap?: readonly number[];
  vscByLap?: readonly number[];
  scDur?: readonly number[];
  vscDur?: readonly number[];
  active?: DpInput['active'];
  wetnessByLap?: readonly number[];
  trafficMsByLap?: readonly number[];
};

const perLap = (n: number, of: readonly number[] = []): Float64Array => Float64Array.from({ length: n }, (_, i) => of[i] ?? 0);

/** A `DpInput`: a medium-shod AI car on new tyres, no hazard, no traffic, no wetness, unless `spec` says otherwise. */
export function dpInput(spec: DpSpec = {}): DpInput {
  const fromLap = spec.fromLap ?? 1;
  const totalLaps = spec.totalLaps ?? 30;
  const n = totalLaps - fromLap + 1;
  return {
    car: carId(0),
    fromLap,
    totalLaps,
    lap: spec.lap ?? LAP,
    carParams: { compound: 'medium', tyreAge: 0, wearPct: 0, fuelKg: 0, paceMs: PACE_MS, degMsPerLap: 0, wearRatePct: { ...WEAR_RATES }, human: false, ...spec.car },
    sets: { ...NO_SETS, ...spec.sets },
    owesSecondCompound: spec.owesSecondCompound ?? false,
    pitLossMs: spec.pitLossMs ?? { green: 22_000, vsc: 15_000, sc: 11_000, inLapShare: 0.3 },
    hazard: { byLap: perLap(n, spec.scByLap), vscByLap: perLap(n, spec.vscByLap), scDur: Float64Array.from(spec.scDur ?? [1]), vscDur: Float64Array.from(spec.vscDur ?? [1]) },
    active: spec.active ?? null,
    wetnessByLap: perLap(n, spec.wetnessByLap),
    trafficMsByLap: perLap(n, spec.trafficMsByLap),
  };
}

/** Per lap `fromLap … totalLaps` the start chance of `kind` from a track's hazard table, by ruling R22 ((n − 0.5) / totalLaps). */
export function chancesFrom(hazard: TrackHazard, fromLap: number, totalLaps: number, kind: 'sc' | 'vsc'): number[] {
  return Array.from({ length: totalLaps - fromLap + 1 }, (_, i) => chanceOn(hazard, fromLap + i, totalLaps, kind));
}

type Neutral = 'none' | 'sc' | 'vsc';

type Car = { compound: NoiseCompound; onSet: number; wearPct: number; fuelKg: number };

const lapInput: LapInput = { paceMs: 0, degMsPerLap: 0, wearPct: 0, fuelKg: 0, compound: 'medium', lapOnSet: 1, neutralised: 'none', wetnessMs: 0, scatterMs: 0, mistakeMs: 0 };

const burnOf = (input: DpInput): number => input.carParams.fuelKg / (input.totalLaps - input.fromLap + 1);

/** Lap `lap` of `car` under `neutral`: its time, and the car after it. */
function driveLap(input: DpInput, car: Car, lap: number, neutral: Neutral): { ms: number; after: Car } {
  const p = input.carParams;
  Object.assign(lapInput, {
    paceMs: p.paceMs,
    degMsPerLap: p.degMsPerLap,
    wearPct: car.wearPct,
    fuelKg: car.fuelKg,
    compound: car.compound,
    lapOnSet: car.onSet + 1,
    neutralised: neutral,
    wetnessMs: input.wetnessByLap[lap - input.fromLap] ?? 0,
  });
  const ms = lapTimeMs(input.lap, lapInput);
  const factors = neutral === 'none' ? { wearFactor: 1, fuelFactor: 1 } : input.lap.neutralised[neutral];
  const rate = p.wearRatePct?.[car.compound] ?? 0;
  return {
    ms,
    after: { compound: car.compound, onSet: car.onSet + 1, wearPct: car.wearPct + rate * factors.wearFactor, fuelKg: Math.max(0, car.fuelKg - burnOf(input) * factors.fuelFactor) },
  };
}

/** A stop at the end of lap `lap` under `neutral`: its cost. */
function stopMs(input: DpInput, lap: number, neutral: Neutral): number {
  const condition = neutral === 'none' ? 'green' : neutral;
  return input.pitLossMs[condition] - (input.carParams.human ? HUMAN_STOP_SAVING_MS : 0) + (input.trafficMsByLap[lap - input.fromLap] ?? 0);
}

const startCar = (input: DpInput): Car => ({ compound: input.carParams.compound, onSet: input.carParams.tyreAge, wearPct: input.carParams.wearPct, fuelKg: input.carParams.fuelKg });

const fitted = (compound: NoiseCompound): Car => ({ compound, onSet: 0, wearPct: 0, fuelKg: 0 });

/** Whether `stops` meet the compound rule for a car that starts on `start`. */
export function meetsRule(input: DpInput, stops: readonly { compound: NoiseCompound }[]): boolean {
  return !input.owesSecondCompound || stops.some((s) => DRY.includes(s.compound) && s.compound !== input.carParams.compound);
}

/** The race time from `fromLap` to the flag with `stops` and the neutralisation of each lap (`neutralOf`, default green). */
export function raceTimeMs(input: DpInput, stops: readonly { lap: number; compound: NoiseCompound }[], neutralOf: (lap: number) => Neutral = () => 'none'): number {
  let car = startCar(input);
  let total = 0;
  for (let lap = input.fromLap; lap <= input.totalLaps; lap++) {
    const neutral = neutralOf(lap);
    const { ms, after } = driveLap(input, car, lap, neutral);
    total += ms;
    car = after;
    const stop = stops.find((s) => s.lap === lap);
    if (stop !== undefined) {
      total += stopMs(input, lap, neutral);
      car = { ...fitted(stop.compound), fuelKg: car.fuelKg };
    }
  }
  return total;
}

/** Every list of stops (≤ `maxStops`, within the sets) from `fromLap`, as `raceTimeMs` takes it. */
export function everyStopList(input: DpInput, maxStops = MAX_STOPS): { lap: number; compound: NoiseCompound }[][] {
  const out: { lap: number; compound: NoiseCompound }[][] = [];
  const sets = { ...input.sets };
  const walk = (from: number, acc: { lap: number; compound: NoiseCompound }[]): void => {
    out.push([...acc]);
    if (acc.length === maxStops) return;
    for (let lap = from; lap < input.totalLaps; lap++) {
      for (const compound of NOISE_COMPOUNDS) {
        if (sets[compound] <= 0) continue;
        sets[compound]--;
        acc.push({ lap, compound });
        walk(lap + 1, acc);
        acc.pop();
        sets[compound]++;
      }
    }
  };
  walk(input.fromLap, []);
  return out;
}

/** The best deterministic plan (no neutralisation) by enumeration, with the runner-up's time. */
export function bestDeterministic(input: DpInput): { stops: { lap: number; compound: NoiseCompound }[]; ms: number; runnerUpMs: number } {
  let best = { stops: [] as { lap: number; compound: NoiseCompound }[], ms: Infinity };
  let runnerUpMs = Infinity;
  for (const stops of everyStopList(input)) {
    if (!meetsRule(input, stops)) continue;
    const ms = raceTimeMs(input, stops);
    if (ms < best.ms) {
      runnerUpMs = best.ms;
      best = { stops, ms };
    } else if (ms < runnerUpMs) runnerUpMs = ms;
  }
  return { ...best, runnerUpMs };
}

/** The key of a plan's compound sequence. */
export const sequenceOf = (stops: readonly { compound: NoiseCompound }[]): string => stops.map((s) => s.compound).join('-');

type Neutralisation = { kind: Neutral; left: number };

/**
 * The closed-loop brute force: the expected remaining race time of the best play, every action and every outcome
 * walked, no table. `sequence` fixes the stops' compounds (exactly those, in order); `root` forces the action at the end
 * of `fromLap`; `rule: false` drops the compound rule.
 */
function expectedMs(input: DpInput, o: { sequence?: readonly NoiseCompound[]; root?: 'box' | 'stay'; rule?: boolean }): number {
  const rule = o.rule ?? true;
  const sets = { ...input.sets };
  const { scDur, vscDur, byLap, vscByLap } = input.hazard;

  // the car's value from the start of `lap`, its neutralisation out (`out`, laps left after this one) or not
  const fromLapStart = (lap: number, car: Car, stops: NoiseCompound[], out: Neutralisation | null, noStart: boolean): number => {
    if (lap > input.totalLaps) {
      if (o.sequence !== undefined && stops.length !== o.sequence.length) return Infinity;
      if (rule && !meetsRule(input, stops.map((compound) => ({ compound })))) return Infinity;
      return 0;
    }
    if (out !== null) return driveAndDecide(lap, car, stops, out.kind, out.left);
    if (noStart) return driveAndDecide(lap, car, stops, 'none', 0);
    const i = lap - input.fromLap;
    const pSc = byLap[i] ?? 0;
    const pVsc = vscByLap[i] ?? 0;
    let v = 0;
    if (1 - pSc - pVsc > 0) v += (1 - pSc - pVsc) * driveAndDecide(lap, car, stops, 'none', 0);
    scDur.forEach((p, d) => {
      if (pSc * p > 0) v += pSc * p * driveAndDecide(lap, car, stops, 'sc', d);
    });
    vscDur.forEach((p, d) => {
      if (pVsc * p > 0) v += pVsc * p * driveAndDecide(lap, car, stops, 'vsc', d);
    });
    return v;
  };

  // lap `lap` under `neutral` with `left` neutralised laps after it, then the best action at its end
  const driveAndDecide = (lap: number, car: Car, stops: NoiseCompound[], neutral: Neutral, left: number): number => {
    const { ms, after } = driveLap(input, car, lap, neutral);
    const next: Neutralisation | null = neutral !== 'none' && left > 0 ? { kind: neutral, left: left - 1 } : null;
    const endsHere = neutral !== 'none' && left === 0;
    const forced = lap === input.fromLap ? o.root : undefined;
    let best = Infinity;
    if (forced !== 'box') best = fromLapStart(lap + 1, after, stops, next, endsHere);
    if (forced !== 'stay' && lap < input.totalLaps && stops.length < MAX_STOPS) {
      const choices = o.sequence !== undefined ? (o.sequence[stops.length] === undefined ? [] : [o.sequence[stops.length]!]) : NOISE_COMPOUNDS;
      for (const compound of choices) {
        if (sets[compound] <= 0) continue;
        sets[compound]--;
        stops.push(compound);
        const v = stopMs(input, lap, neutral) + fromLapStart(lap + 1, { ...fitted(compound), fuelKg: after.fuelKg }, stops, next, endsHere);
        stops.pop();
        sets[compound]++;
        if (v < best) best = v;
      }
    }
    return ms + best;
  };

  const car = startCar(input);
  if (input.active === null) return fromLapStart(input.fromLap, car, [], null, false);
  let v = 0;
  input.active.remaining.forEach((p, k) => {
    if (p > 0) v += p * driveAndDecide(input.fromLap, car, [], input.active!.condition, k);
  });
  return v;
}

/** Every compound sequence of at most `MAX_STOPS` stops within the sets. */
export function everySequence(input: DpInput): NoiseCompound[][] {
  const out: NoiseCompound[][] = [];
  const sets = { ...input.sets };
  const walk = (acc: NoiseCompound[]): void => {
    out.push([...acc]);
    if (acc.length === MAX_STOPS) return;
    for (const c of NOISE_COMPOUNDS) {
      if (sets[c] <= 0) continue;
      sets[c]--;
      acc.push(c);
      walk(acc);
      acc.pop();
      sets[c]++;
    }
  };
  walk([]);
  return out;
}

/** The brute force's answer: per feasible sequence its expected time, and the box-now and stay-out values. */
export function bruteForce(input: DpInput): { bySequence: Map<string, number>; boxNow: number | null; stayOut: number } {
  const bySequence = new Map<string, number>();
  for (const sequence of everySequence(input)) {
    const v = expectedMs(input, { sequence });
    if (Number.isFinite(v)) bySequence.set(sequence.join('-'), v);
  }
  const box = expectedMs(input, { root: 'box' });
  const stay = expectedMs(input, { root: 'stay' });
  return { bySequence, boxNow: Number.isFinite(box) ? box : null, stayOut: Number.isFinite(stay) ? stay : expectedMs(input, { root: 'stay', rule: false }) };
}

/** The plans of a result by their sequence key. */
export const plansBySequence = (plans: readonly DpPlan[]): Map<string, DpPlan> => new Map(plans.map((p) => [sequenceOf(p.stops), p]));
