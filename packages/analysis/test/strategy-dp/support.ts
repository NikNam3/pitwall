// Shared pieces of the `strategy-dp` tests (SP4.3b spec §6, plan 4.3b1 Task 18; SP4.3c Task 19): a `DpInput` builder,
// the hazard by ruling R22, a deterministic race time for a fixed list of stops, and a closed-loop brute force over every
// action and every neutralisation outcome, written independently of the simulator.
//
// The model these tests read `DpInput` and `DpResult` by (the test agents' decisions, Task 18 and SP4.3c Task 19 reports):
// - `fromLap` is the next lap the car drives in full: it is on the line at its start, `carParams` as there. The race
//   runs to the end of lap `totalLaps`. Every per-lap array has `totalLaps − fromLap + 1` entries, index 0 = `fromLap`.
// - The weather worlds (SP4.3c §5.4a, O3b): `input.worlds` holds one or more worlds (`weatherWorlds`' `u` and weight,
//   the weights summing to 1), each with its own wetness per lap (`wetnessByLap`) and its own traffic cost of a rejoin
//   per lap (`trafficMsByLap`, from that world's plain road). `solveDp` solves each world alone, as if it were certain:
//   world w's plans are exactly the plans of the same input with `worlds` = `[worlds[w]]` (weight 1), tagged
//   `world: w`. Nothing mixes worlds. `boxThisLap`, `continue` and `table` are the first world's (`worlds[0]`): the
//   builder puts the world it plans the immediate call on first.
// - A stop `{ lap: L, compound }` boxes at the end of lap L (in lap L, out lap L + 1), as `race-forecast` reads a
//   policy's stop; `fromLap ≤ L < totalLaps`, laps ascending and distinct; at most 3 stops (`maxStops`); each fits a
//   new set of its compound (`sets`), at wear 0 and lap on set 1.
// - A lap's time is `lap-model`'s `lapTimeMs` with no scatter and no mistake: the wear and fuel at the lap's start,
//   `lapOnSet` = laps already run on the set + 1, the lap's neutralisation, the world's wetness of the lap, and the tyre
//   terms of the compound on the car (SP4.3c Task 19, B5): `degMsPerLap[compound]` and `wearRatePct[compound]`, so after
//   a stop to mediums the medium's own rate and ν. After the lap the set's wear grows by `wearRatePct[compound]` (× the
//   neutralised `wearFactor` on a neutralised lap) and fuel falls by `carParams.fuelBurnKgPerLap` (× `fuelFactor`), never
//   below 0 (SP4.3c Task 15: the starting point's burn; by default here `fuelKg / (totalLaps − fromLap + 1)`).
// - A stop at the end of lap L costs `pitLossMs[c]` with c the condition of lap L (green, VSC, SC), less
//   `HUMAN_STOP_SAVING_MS` for a human car, plus the world's `trafficMsByLap` of lap L.
// - The 70 % limit (SP4.3c §5.2, `tyre-model`'s laps to it): the fitted set may run at most `max(1,
//   carParams.fittedLapsToLimit)` laps from `fromLap` (the car is on it for lap `fromLap` whatever its wear), a new set of
//   compound c at most `carParams.lapsToLimit[c]` laps (≥ 1); `null`: no limit known. A play that would start a lap on a
//   set past its laps is infeasible (the flag ends the race: a set may reach the flag on its last allowed lap). So a car
//   at or past the limit (`fittedLapsToLimit` 0) boxes at the end of `fromLap` in every play.
// - Neutralisations: a green lap n may start an SC with chance `byLap` of lap n, else a VSC with `vscByLap`'s (the two
//   exclusive), lasting d laps with chance `scDur[d − 1]` (`vscDur`); laps n … n + d − 1 are neutralised. None starts on
//   the lap after a neutralisation's last lap. With `active`, lap `fromLap` is neutralised by it and its last lap is
//   `fromLap + k` with chance `remaining[k]`. A start and its length are known from the lap it starts on: the decision
//   at the end of a lap knows that lap's condition and the laps left of a neutralisation out.
// - The compound rule (`owesSecondCompound`): a plan must fit a dry compound other than the car's current one.
// - Per world, `DpResult.plans` holds one plan per compound sequence (the compounds of its stops in order) that can meet
//   the rule, the sets and the limit with at most 3 stops, so the best of each stop count 0–3 whenever one is feasible;
//   its `expectedMs` is the expected remaining race time of the best closed-loop play that makes exactly that sequence's
//   stops; its `stops` are that play's stops where no neutralisation comes (the green path). Within a world `plans` are
//   sorted by `expectedMs`, the best first. `boxThisLap` and `continue` are the best closed-loop play with a stop at the
//   end of `fromLap` and without one; `boxThisLap` is `null` where no play boxing now can meet the rule, the sets and the
//   limit; `continue`, where no play without a stop now meets the rule and the limit, is the best such play that ignores
//   both (always a value, C3).
// - The start compound (SP4.3d2 Task 8, spec §7.2): `startCompound` is the car's start compound, `carParams.compound`
//   for a car on its tyres (every input but the grid start's; such plans carry no `startCompound` key, as before);
//   `null` before the start (the grid, `fromLap` 1, nothing out): free. Then the car starts on a new set of the start
//   compound the DP picks among those with a set left (`sets[c] ≥ 1`), so that set counts as used, and the compound rule
//   reads it as the car's current compound; `carParams.compound`, `tyreAge`, `wearPct` and `fittedLapsToLimit` are not
//   read (the set is new: age 0, wear 0, `lapsToLimit[c]` laps to the limit). Every plan, `boxThisLap` and `continue`
//   then carries the `startCompound` it starts on. A free start on compound c is exactly the fixed input `fixedStart(input,
//   c)`: what the brute force solves per start compound.
import { carId, NOISE_COMPOUNDS, type LapInput, type LapModelParams, type NoiseCompound, type TrackHazard } from '@pitwall/domain';
import { lapTimeMs } from '../../src/lap-model/index.ts';
import { HUMAN_STOP_SAVING_MS } from '../../src/race-forecast/constants.ts';
import type { DpCarParams, DpInput, DpPlan, DpWorld } from '../../src/strategy-dp/index.ts';
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
export const NO_LIMITS: Record<NoiseCompound, number | null> = { soft: null, medium: null, hard: null, inter: null, wet: null };

/** One world of a spec: per lap (index 0 = `fromLap`, missing laps 0) its wetness and traffic; `u` 0.5, weight 1 ÷ worlds by default. */
export type WorldSpec = { u?: number; weight?: number; wetnessByLap?: readonly number[] | undefined; trafficMsByLap?: readonly number[] | undefined };

/** The car of a spec: `degMsPerLap` a number for every compound or per compound (the rest 0); `lapsToLimit` per compound (the rest `null`). */
export type CarSpec = Partial<Omit<DpCarParams, 'degMsPerLap' | 'lapsToLimit'>> & {
  degMsPerLap?: number | Partial<Record<NoiseCompound, number>>;
  lapsToLimit?: Partial<Record<NoiseCompound, number | null>>;
};

export type DpSpec = {
  /** The start compound: absent, the car's compound (on its tyres); `null`, free (the grid). */
  startCompound?: NoiseCompound | null;
  fromLap?: number;
  totalLaps?: number;
  lap?: LapModelParams;
  car?: CarSpec;
  sets?: Partial<Record<NoiseCompound, number>>;
  owesSecondCompound?: boolean;
  pitLossMs?: DpInput['pitLossMs'];
  /** Per lap (index 0 = `fromLap`); missing laps 0. */
  scByLap?: readonly number[];
  vscByLap?: readonly number[];
  scDur?: readonly number[];
  vscDur?: readonly number[];
  active?: DpInput['active'];
  /** One world's wetness and traffic (ignored where `worlds` is given). */
  wetnessByLap?: readonly number[];
  trafficMsByLap?: readonly number[];
  /** Several worlds, in order. */
  worlds?: readonly WorldSpec[];
};

const perLap = (n: number, of: readonly number[] = []): Float64Array => Float64Array.from({ length: n }, (_, i) => of[i] ?? 0);

/** Every compound's term: `x` for every compound where it is a number, else its entries over `fill`. */
export function perCompound<T>(x: T | Partial<Record<NoiseCompound, T>> | undefined, fill: T): Record<NoiseCompound, T> {
  if (x !== undefined && (typeof x !== 'object' || x === null)) return Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, x])) as Record<NoiseCompound, T>;
  const given = (x ?? {}) as Partial<Record<NoiseCompound, T>>;
  return Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, given[c] ?? fill])) as Record<NoiseCompound, T>;
}

/** A `DpInput`: a medium-shod AI car on new tyres, no hazard, no traffic, no wetness, no limit, one world, unless `spec` says otherwise. */
export function dpInput(spec: DpSpec = {}): DpInput {
  const fromLap = spec.fromLap ?? 1;
  const totalLaps = spec.totalLaps ?? 30;
  const n = totalLaps - fromLap + 1;
  const worldSpecs: readonly WorldSpec[] = spec.worlds ?? [{ u: 0.5, weight: 1, wetnessByLap: spec.wetnessByLap, trafficMsByLap: spec.trafficMsByLap }];
  const worlds: DpWorld[] = worldSpecs.map((w) => ({
    u: w.u ?? 0.5,
    weight: w.weight ?? 1 / worldSpecs.length,
    wetnessByLap: perLap(n, w.wetnessByLap),
    trafficMsByLap: perLap(n, w.trafficMsByLap),
  }));
  const { degMsPerLap, lapsToLimit, ...car } = spec.car ?? {};
  return {
    car: carId(0),
    startCompound: spec.startCompound === undefined ? (car.compound ?? 'medium') : spec.startCompound,
    fromLap,
    totalLaps,
    lap: spec.lap ?? LAP,
    // the burn (SP4.3c Task 15, O15): the starting point's; by default the fuel over the laps left, as the DP computed it before
    carParams: {
      compound: 'medium',
      tyreAge: 0,
      wearPct: 0,
      fuelKg: 0,
      paceMs: PACE_MS,
      wearRatePct: { ...WEAR_RATES },
      human: false,
      fuelBurnKgPerLap: (car.fuelKg ?? 0) / n,
      fittedLapsToLimit: null,
      ...car,
      degMsPerLap: perCompound(degMsPerLap, 0),
      lapsToLimit: { ...NO_LIMITS, ...lapsToLimit },
    },
    sets: { ...NO_SETS, ...spec.sets },
    owesSecondCompound: spec.owesSecondCompound ?? false,
    pitLossMs: spec.pitLossMs ?? { green: 22_000, vsc: 15_000, sc: 11_000, inLapShare: 0.3 },
    hazard: { byLap: perLap(n, spec.scByLap), vscByLap: perLap(n, spec.vscByLap), scDur: Float64Array.from(spec.scDur ?? [1]), vscDur: Float64Array.from(spec.vscDur ?? [1]) },
    active: spec.active ?? null,
    worlds,
  };
}

/** `input` with world `w` alone (weight 1): what `solveDp` solves for that world. */
export const worldOf = (input: DpInput, w: number): DpInput => ({ ...input, worlds: [{ ...input.worlds[w]!, weight: 1 }] });

/** The plans of world `w`, in the result's order. */
export const plansOf = (plans: readonly DpPlan[], w: number): DpPlan[] => plans.filter((p) => p.world === w);

/** Per lap `fromLap … totalLaps` the start chance of `kind` from a track's hazard table, by ruling R22 ((n − 0.5) / totalLaps). */
export function chancesFrom(hazard: TrackHazard, fromLap: number, totalLaps: number, kind: 'sc' | 'vsc'): number[] {
  return Array.from({ length: totalLaps - fromLap + 1 }, (_, i) => chanceOn(hazard, fromLap + i, totalLaps, kind));
}

type Neutral = 'none' | 'sc' | 'vsc';

/** The car between laps: its compound, laps run on the set, laps run on it since `fromLap` or its fitting, wear and fuel. */
type Car = { compound: NoiseCompound; onSet: number; stint: number; fitted: boolean; wearPct: number; fuelKg: number };

const lapInput: LapInput = { paceMs: 0, degMsPerLap: 0, wearPct: 0, fuelKg: 0, compound: 'medium', lapOnSet: 1, neutralised: 'none', wetnessMs: 0, wet: false, scatterMs: 0, mistakeMs: 0 };

/** The burn per lap: the car's (`carParams.fuelBurnKgPerLap`, the starting point's, SP4.3c Task 15). */
const burnOf = (input: DpInput): number => input.carParams.fuelBurnKgPerLap;

/** The first world's (the only one of a `worldOf` input) per-lap value of lap `lap`. */
const worldAt = (input: DpInput, key: 'wetnessByLap' | 'trafficMsByLap', lap: number): number => input.worlds[0]?.[key][lap - input.fromLap] ?? 0;

/** The laps the car's set may run (the 70 % limit): the fitted set's from `fromLap`, a new set's from its fitting; `Infinity` without one. */
function stintMax(input: DpInput, car: Car): number {
  const p = input.carParams;
  if (car.fitted) return p.fittedLapsToLimit === null ? Infinity : Math.max(1, p.fittedLapsToLimit);
  const f = p.lapsToLimit[car.compound];
  return f === null ? Infinity : f;
}

/** Whether the car may start another lap on its set (the 70 % limit). */
export const mayRun = (input: DpInput, car: Car): boolean => car.stint < stintMax(input, car);

/** Lap `lap` of `car` under `neutral`: its time, and the car after it. */
function driveLap(input: DpInput, car: Car, lap: number, neutral: Neutral): { ms: number; after: Car } {
  const p = input.carParams;
  Object.assign(lapInput, {
    paceMs: p.paceMs,
    degMsPerLap: p.degMsPerLap[car.compound],
    wearPct: car.wearPct,
    fuelKg: car.fuelKg,
    compound: car.compound,
    lapOnSet: car.onSet + 1,
    neutralised: neutral,
    wetnessMs: worldAt(input, 'wetnessByLap', lap),
  });
  const ms = lapTimeMs(input.lap, lapInput);
  const factors = neutral === 'none' ? { wearFactor: 1, fuelFactor: 1 } : input.lap.neutralised[neutral];
  const rate = p.wearRatePct?.[car.compound] ?? 0;
  return {
    ms,
    after: { ...car, onSet: car.onSet + 1, stint: car.stint + 1, wearPct: car.wearPct + rate * factors.wearFactor, fuelKg: Math.max(0, car.fuelKg - burnOf(input) * factors.fuelFactor) },
  };
}

/** A stop at the end of lap `lap` under `neutral`: its cost. */
function stopMs(input: DpInput, lap: number, neutral: Neutral): number {
  const condition = neutral === 'none' ? 'green' : neutral;
  return input.pitLossMs[condition] - (input.carParams.human ? HUMAN_STOP_SAVING_MS : 0) + worldAt(input, 'trafficMsByLap', lap);
}

const startCar = (input: DpInput): Car => ({ compound: input.carParams.compound, onSet: input.carParams.tyreAge, stint: 0, fitted: true, wearPct: input.carParams.wearPct, fuelKg: input.carParams.fuelKg });

const fittedSet = (compound: NoiseCompound, fuelKg: number): Car => ({ compound, onSet: 0, stint: 0, fitted: false, wearPct: 0, fuelKg });

/** Whether `stops` meet the compound rule for a car that starts on `start`. */
export function meetsRule(input: DpInput, stops: readonly { compound: NoiseCompound }[]): boolean {
  return !input.owesSecondCompound || stops.some((s) => DRY.includes(s.compound) && s.compound !== input.carParams.compound);
}

/** Every stint's laps of `stops` from `fromLap` to the flag: the fitted set's first, then each new set's. */
export function stintsOf(input: DpInput, stops: readonly { lap: number; compound: NoiseCompound }[]): { compound: NoiseCompound; fitted: boolean; laps: number }[] {
  const out: { compound: NoiseCompound; fitted: boolean; laps: number }[] = [];
  let from = input.fromLap;
  let compound = input.carParams.compound;
  let fitted = true;
  for (const s of stops) {
    out.push({ compound, fitted, laps: s.lap - from + 1 });
    from = s.lap + 1;
    compound = s.compound;
    fitted = false;
  }
  out.push({ compound, fitted, laps: input.totalLaps - from + 1 });
  return out;
}

/** Whether no stint of `stops` passes its laps to the limit (where no neutralisation comes). */
export function meetsLimit(input: DpInput, stops: readonly { lap: number; compound: NoiseCompound }[]): boolean {
  return stintsOf(input, stops).every((s) => s.laps <= stintMax(input, { compound: s.compound, fitted: s.fitted, onSet: 0, stint: 0, wearPct: 0, fuelKg: 0 }));
}

/** The race time from `fromLap` to the flag with `stops` and the neutralisation of each lap (`neutralOf`, default green), in the first world. */
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
      car = fittedSet(stop.compound, car.fuelKg);
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

/** The best deterministic plan (no neutralisation) by enumeration, rule and limit kept, with the runner-up's time; first world. */
export function bestDeterministic(input: DpInput): { stops: { lap: number; compound: NoiseCompound }[]; ms: number; runnerUpMs: number } {
  let best = { stops: [] as { lap: number; compound: NoiseCompound }[], ms: Infinity };
  let runnerUpMs = Infinity;
  for (const stops of everyStopList(input)) {
    if (!meetsRule(input, stops) || !meetsLimit(input, stops)) continue;
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
 * The closed-loop brute force in the first world: the expected remaining race time of the best play, every action and
 * every outcome walked, no table. `sequence` fixes the stops' compounds (exactly those, in order); `root` forces the
 * action at the end of `fromLap`; `rule: false` drops the compound rule, `limit: false` the 70 % limit.
 */
function expectedMs(input: DpInput, o: { sequence?: readonly NoiseCompound[]; root?: 'box' | 'stay'; rule?: boolean; limit?: boolean }): number {
  const rule = o.rule ?? true;
  const limit = o.limit ?? true;
  const sets = { ...input.sets };
  const { scDur, vscDur, byLap, vscByLap } = input.hazard;

  // the car's value from the start of `lap`, its neutralisation out (`out`, laps left after this one) or not
  const fromLapStart = (lap: number, car: Car, stops: NoiseCompound[], out: Neutralisation | null, noStart: boolean): number => {
    if (lap > input.totalLaps) {
      if (o.sequence !== undefined && stops.length !== o.sequence.length) return Infinity;
      if (rule && !meetsRule(input, stops.map((compound) => ({ compound })))) return Infinity;
      return 0;
    }
    if (limit && !mayRun(input, car)) return Infinity;
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
        const v = stopMs(input, lap, neutral) + fromLapStart(lap + 1, fittedSet(compound, after.fuelKg), stops, next, endsHere);
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

/** The brute force's answer in world `w` (default the first): per feasible sequence its expected time, and the box-this-lap and continue values. */
export function bruteForce(input: DpInput, w = 0): { bySequence: Map<string, number>; boxThisLap: number | null; continue: number } {
  const one = worldOf(input, w);
  const bySequence = new Map<string, number>();
  for (const sequence of everySequence(one)) {
    const v = expectedMs(one, { sequence });
    if (Number.isFinite(v)) bySequence.set(sequence.join('-'), v);
  }
  const box = expectedMs(one, { root: 'box' });
  const stay = expectedMs(one, { root: 'stay' });
  return { bySequence, boxThisLap: Number.isFinite(box) ? box : null, continue: Number.isFinite(stay) ? stay : expectedMs(one, { root: 'stay', rule: false, limit: false }) };
}

/**
 * A free start (`startCompound` `null`) fixed on a new set of `compound`: the car on it at age 0 and wear 0 with the
 * new set's laps to the limit, that set taken from `sets` (SP4.3d2 Task 8; see the header).
 */
export function fixedStart(input: DpInput, compound: NoiseCompound): DpInput {
  return {
    ...input,
    startCompound: compound,
    carParams: { ...input.carParams, compound, tyreAge: 0, wearPct: 0, fittedLapsToLimit: input.carParams.lapsToLimit[compound] },
    sets: { ...input.sets, [compound]: input.sets[compound] - 1 },
  };
}

/** The compounds a free start may start on: those with a set left. */
export const startCompounds = (input: DpInput): NoiseCompound[] => NOISE_COMPOUNDS.filter((c) => input.sets[c] >= 1);

/** The plans of a result by their sequence key (of one world's plans). */
export const plansBySequence = (plans: readonly DpPlan[]): Map<string, DpPlan> => new Map(plans.map((p) => [sequenceOf(p.stops), p]));

