// `tyre-model`'s judgement (SP4.3c spec §5.2, O1), one pure form over an `AsOfView` and each car's tyres now: per car
// and compound the wear rate per corner (the measured cumulative rate on the fitted set, else the game's prior k × 70 /
// usableLife, else the default), the loss per % of wear, ν, the fresh-set offset and a fresh set's laps to the limit;
// per car the fresh sets, the type deltas, the fitted set's laps to the limit and life span, our cars' used sets. The
// unit chooses the source and the sets; each tyre type's module adds its own terms. The scheduled run gives the live
// state's tyres (`calculator.ts`), the as-of form the projection's (`asof.ts`).
import {
  known,
  NOISE_COMPOUNDS,
  ourCars,
  tyreTypeOf,
  unknown,
  type ActualCompound,
  type CarId,
  type Corners,
  type DriverProfile,
  type Known,
  type LapRecord,
  type Ms,
  type NoiseCompound,
  type OpenSpan,
  type TrackWetness,
  type TyreModelCar,
  type TyreModelCompound,
  type TyreModelOutput,
  type TyreSet,
  type TyreTerm,
  type TyreType,
  type VisualCompound,
} from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
import { CAR_BANDS_CONFIG } from '../car-bands/config.ts';
import { refTempC } from '../car-bands/bands.ts';
import { isRateLap, LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { configOf } from '../shared/config-of.ts';
import { currentStintLaps, lapsByCar } from '../shared/stint-laps.ts';
import { gameLossMsPerPct, gamePriorRatePct } from '../shared/tyre-prior.ts';
import { TRACK_WETNESS } from '../track-wetness/index.ts';
import { TYRE_MODEL_BEHAVIOUR, type TyreModelEffect } from './behaviour.ts';
import { TYRE_MODEL_CONFIG } from './config.ts';
import { inter } from './types/inter.ts';
import type { TypeModule } from './types/module.ts';
import { slick } from './types/slick.ts';
import { wet } from './types/wet.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
type Corner = (typeof CORNERS)[number];
const TYPES: readonly TyreType[] = ['slick', 'inter', 'wet'];

/** The module of each tyre type. */
const MODULES: Record<TyreType, TypeModule> = { slick, inter, wet };

/** A car's sets as the game gives them: the list and which one is fitted. */
export type CarSets = DeepReadonly<Known<{ sets: TyreSet[]; fittedIdx: number }>>;

/** A set as a lap record or the live state shows it: its compound and its age in laps. */
export type FittedSet = { actualCompound: ActualCompound; visualCompound: VisualCompound; age: number };

/**
 * A car's tyres now: the fitted set (`undefined`: a set no recorded lap ran on, whose age the projection does not hold),
 * its wear and carcass per corner, and the car's sets.
 */
export type TyresNow = {
  set: FittedSet | undefined;
  wearPct: Corners<DeepReadonly<Known<number>>>;
  carcassC: Corners<DeepReadonly<Known<number>>>;
  sets: CarSets;
};

type Config = (typeof TYRE_MODEL_CONFIG)['defaults'];

/** The key of a human's wear factor k on `compound` in a driver profile (C62c). */
export const wearFactorKey = (compound: NoiseCompound): string => `tyreModel.wearFactor.${compound}`;

const isNoise = (c: string): c is NoiseCompound => (NOISE_COMPOUNDS as readonly string[]).includes(c);

/** A car's sets when they count: known and not empty (the game sends every set of a car it shows: an empty list is none received). */
function usable(sets: CarSets): { sets: readonly DeepReadonly<TyreSet>[]; fittedIdx: number; at: Ms } | undefined {
  return sets.known && sets.value.sets.length > 0 ? { sets: sets.value.sets, fittedIdx: sets.value.fittedIdx, at: sets.at } : undefined;
}

/** Why a car's sets do not count: their reason, an empty list `notReceived`. */
const noSets = (sets: CarSets): Known<never> => (sets.known ? unknown('notReceived') : unknown(sets.reason));

type Usable = NonNullable<ReturnType<typeof usable>>;

/** The fitted set of `s`: the one at `fittedIdx`, else the first with `fitted`. */
const fittedOf = (s: Usable): DeepReadonly<TyreSet> | undefined => s.sets[s.fittedIdx] ?? s.sets.find((x) => x.fitted);

/** A fresh set: available, not fitted, new (SP4.2 "only new tyre sets"). */
const isFresh = (s: DeepReadonly<TyreSet>, i: number, fittedIdx: number): boolean => s.available && !s.fitted && i !== fittedIdx && s.wearPct === 0;

/** The fastest fresh set of `compound` in `s` (the smallest delta), if any. */
function bestFresh(s: Usable, compound: VisualCompound): DeepReadonly<TyreSet> | undefined {
  let best: DeepReadonly<TyreSet> | undefined;
  s.sets.forEach((x, i) => {
    if (x.visualCompound === compound && isFresh(x, i, s.fittedIdx) && (best === undefined || x.lapDeltaMs < best.lapDeltaMs)) best = x;
  });
  return best;
}

/** The set whose usable life stands for `compound`: the fitted one on it, else an available one, else any with a life. */
function lifeSetOf(s: Usable, compound: NoiseCompound): DeepReadonly<TyreSet> | undefined {
  const fitted = fittedOf(s);
  if (fitted !== undefined && fitted.visualCompound === compound && fitted.usableLifeLaps > 0) return fitted;
  return s.sets.find((x) => x.visualCompound === compound && x.available && x.usableLifeLaps > 0) ?? s.sets.find((x) => x.visualCompound === compound && x.usableLifeLaps > 0);
}

/** The actual compound a visual one stands for without a set of it: the usual allocation's middle (C3). */
const ACTUAL_OF: Record<NoiseCompound, ActualCompound> = { soft: 'C4', medium: 'C3', hard: 'C2', inter: 'inter', wet: 'wet' };

/**
 * The laps (oldest first) that ran on the fitted set: the newest of `laps` back to the first that was not on it. A lap on
 * another compound, or with more laps on its set than a newer lap of the run (or than the fitted set now), was on
 * another set; a set no recorded lap ran on has none.
 */
function onFittedSet(laps: readonly LapRecord[], set: FittedSet | undefined): LapRecord[] {
  if (set === undefined) return [];
  let age = set.age;
  let first = laps.length;
  while (first > 0) {
    const l = laps[first - 1] as LapRecord;
    if (l.actualCompound !== set.actualCompound || l.visualCompound !== set.visualCompound || l.tyreAgeAtStart > age) break;
    age = l.tyreAgeAtStart;
    first--;
  }
  return laps.slice(first);
}

/** One corner's measured rate over the newest rate laps on the set: the rate, the laps it rests on, when. */
type Measured = { ratePct: number; laps: readonly LapRecord[]; at: Ms };

/**
 * A corner's measured rate (research 21 §2): the cumulative gain (each lap's own end minus start) over the newest
 * `rateWindowLaps` rate laps whose wear at that corner is known, once they are at least `minGainLaps` and have accrued
 * `minAccruedPct`; else none.
 */
function measuredAt(laps: readonly LapRecord[], corner: Corner, c: Config, maxNeutralisedMs: number): Measured | undefined {
  const used: LapRecord[] = [];
  let sum = 0;
  for (let i = laps.length - 1; i >= 0 && used.length < c.rateWindowLaps; i--) {
    const l = laps[i] as LapRecord;
    const start = l.wearAtStartPct[corner];
    const end = l.wearAtEndPct[corner];
    if (!start.known || !end.known || !isRateLap(l, { maxNeutralisedMs })) continue;
    used.push(l);
    sum += end.value - start.value;
  }
  if (used.length < c.minGainLaps || sum < c.minAccruedPct) return undefined;
  return { ratePct: sum / used.length, laps: used, at: (used[0] as LapRecord).completedAt };
}

/** The mean of the laps' carcass at `corner`, when every one is known. */
function carcassMean(laps: readonly LapRecord[], corner: Corner): number | undefined {
  let sum = 0;
  for (const l of laps) {
    const t = l.carcassMeanC[corner];
    if (!t.known) return undefined;
    sum += t.value;
  }
  return laps.length === 0 ? undefined : sum / laps.length;
}

/** The track's wetness over the laps (the mean of `track-wetness`'s slick reading on their lap numbers) and now; absent without both. */
function wetnessOver(wetness: DeepReadonly<TrackWetness> | undefined, laps: readonly LapRecord[]): { window: number; now: number } | undefined {
  if (wetness === undefined || !wetness.state.known) return undefined;
  const numbers = new Set(laps.map((l) => l.lapNumber));
  let sum = 0;
  let n = 0;
  for (const row of wetness.byLap) {
    const slick = row.commonModeMs.slick;
    if (numbers.has(row.lap) && slick.known) {
      sum += slick.value;
      n++;
    }
  }
  return n === 0 ? undefined : { window: sum / n, now: wetness.state.value.wetnessMs };
}

/** Each car's rows (`TYRE_MODEL_BEHAVIOUR`) of the spans open for it, merged, by car id. */
function effectsByCar(view: AsOfView): Map<CarId, TyreModelEffect> {
  const effects = new Map<CarId, TyreModelEffect>();
  for (const [machine, byKind] of Object.entries(TYRE_MODEL_BEHAVIOUR)) {
    for (const span of (view.situation.byMachine[machine] ?? []) as readonly DeepReadonly<OpenSpan>[]) {
      if (span.carId === undefined) continue;
      if (!Object.hasOwn(byKind, span.kind)) throw new Error(`behaviour table: no row for ${machine} ${span.kind}`);
      effects.set(span.carId, { ...effects.get(span.carId), ...byKind[span.kind] });
    }
  }
  return effects;
}

/** The cars with a car-status span open at the view's frame (C17): the cars of the session. */
export const carsOf = (view: AsOfView): CarId[] => [...new Set((view.situation.byMachine['car-status'] ?? []).flatMap((s) => (s.carId === undefined ? [] : [s.carId])))];

/** The profile's k on `compound` (C62c), if the car slot's linked driver has one. */
function profileK(view: AsOfView, car: CarId, compound: NoiseCompound): { k: number; at: Ms } | undefined {
  const linked = view.drivers[car];
  if (linked === undefined || !linked.known) return undefined;
  const entry = (linked.value as DeepReadonly<DriverProfile>).entries[wearFactorKey(compound)];
  return entry?.value.known === true ? { k: entry.value.value, at: entry.value.at } : undefined;
}

/** What one car's terms are computed from. */
type CarCtx = {
  id: CarId;
  human: boolean;
  tyres: TyresNow;
  /** The sets its priors read: its own, else our car's (a rival under realism, research 22 §2), else none. */
  priorSets: Usable | undefined;
  /** The rate laps of the fitted set. */
  own: readonly LapRecord[];
};

/** The shared inputs of one view. */
type ViewCtx = { view: AsOfView; c: Config; maxNeutralisedMs: number; wetness: DeepReadonly<TrackWetness> | undefined };

/** A corner's chosen rate of `compound` (before the type's terms) and the laps it was measured on, if measured. */
function baseRate(v: ViewCtx, car: CarCtx, compound: NoiseCompound, corner: Corner): { base: TyreTerm<number>; measured: Measured | undefined } {
  const fitted = car.tyres.set?.visualCompound === compound;
  const measured = fitted ? measuredAt(car.own, corner, v.c, v.maxNeutralisedMs) : undefined;
  if (measured !== undefined) return { base: { value: known(measured.ratePct, measured.at), source: 'measured' }, measured };
  const set = car.priorSets === undefined ? undefined : lifeSetOf(car.priorSets, compound);
  if (set === undefined || car.priorSets === undefined) {
    // a car whose driver withholds the telemetry has no rate without our car's values to stand in (C3); without the
    // game's sets otherwise the default
    const own = car.tyres.sets;
    const value = !own.known && own.reason === 'restricted' ? unknown('restricted') : known(v.c.defaultRatePct, 0);
    return { base: { value, source: 'default' }, measured };
  }
  const profile = car.human ? profileK(v.view, car.id, compound) : undefined;
  const k = profile?.k ?? (car.human ? v.c.humanWearFactor : v.c.aiWearFactor);
  const value = known(gamePriorRatePct(set.usableLifeLaps, k, v.c.limitPct), Math.max(car.priorSets.at, profile?.at ?? 0));
  return { base: { value, source: profile === undefined ? 'game' : 'profile' }, measured };
}

/** The actual compound of `compound` for `car`: its fitted set's when on it, else a set of it, else the usual one. */
function actualOf(car: CarCtx, compound: NoiseCompound): ActualCompound {
  if (car.tyres.set?.visualCompound === compound) return car.tyres.set.actualCompound;
  return car.priorSets?.sets.find((s) => s.visualCompound === compound)?.actualCompound ?? ACTUAL_OF[compound];
}

/** The game's loss per % on `compound` (the fitted set against a fresh one of it, research 22 §1.6), where measured. */
function gameLossOf(v: ViewCtx, car: CarCtx, compound: NoiseCompound): number | undefined {
  const s = car.priorSets;
  if (s === undefined) return undefined;
  const fitted = fittedOf(s);
  if (fitted === undefined || fitted.visualCompound !== compound) return undefined;
  const fresh = bestFresh(s, compound);
  const loss = fresh === undefined ? undefined : gameLossMsPerPct(fitted.lapDeltaMs, fresh.lapDeltaMs, fitted.wearPct, v.c.minWearForLossPct);
  // a worn set no slower than a fresh one is no reading of the game's loss (the default then, C3)
  return loss !== undefined && loss > 0 ? loss : undefined;
}

/** The track file's offset of `compound` against medium, if it has one. */
function trackOffset(view: AsOfView, compound: NoiseCompound): Ms | undefined {
  const offsets = view.track.known ? view.track.value.defaults.compoundOffsetsMs : undefined;
  if (offsets?.known !== true) return undefined;
  const all = offsets.value.value as Readonly<Partial<Record<string, number>>>;
  const own = all[compound];
  const medium = all['medium'];
  return own === undefined || medium === undefined ? undefined : own - medium;
}

/** The game's delta of the best fresh `compound` against the best fresh medium, where both are in the sets. */
function gameOffset(car: CarCtx, compound: NoiseCompound): Ms | undefined {
  const s = car.priorSets;
  if (s === undefined) return undefined;
  const own = bestFresh(s, compound);
  const medium = bestFresh(s, 'medium');
  return own === undefined || medium === undefined ? undefined : own.lapDeltaMs - medium.lapDeltaMs;
}

/** The worst (highest) known rate of the corners, with its corner's term. */
function worstOf(rates: Corners<TyreTerm<number>>): TyreTerm<number> {
  let worst: TyreTerm<number> | undefined;
  for (const corner of CORNERS) {
    const t = rates[corner];
    if (!t.value.known) return t;
    if (worst === undefined || (worst.value.known && t.value.value > worst.value.value)) worst = t;
  }
  return worst as TyreTerm<number>;
}

/** One compound's terms for one car. */
function compoundOf(v: ViewCtx, car: CarCtx, compound: NoiseCompound): TyreModelCompound {
  const type = tyreTypeOf(compound);
  const module = MODULES[type];
  const config = v.view.config;
  const onIt = car.tyres.set?.visualCompound === compound;
  const bandsConfig = configOf(CAR_BANDS_CONFIG, v.view);
  const actual = actualOf(car, compound);
  const rate = (corner: Corner): TyreTerm<number> => {
    const { base, measured } = baseRate(v, car, compound, corner);
    const now = car.tyres.carcassC[corner];
    // the heat term: a car whose temperatures the game simulates (a human, research 20 §1), on the fitted compound
    let carcassC: { basis: number; now: number } | undefined;
    if (car.human && onIt && now.known) {
      const basis = measured === undefined ? refTempC(actual, bandsConfig, 0) : known(carcassMean(measured.laps, corner) ?? Number.NaN, 0);
      if (basis.known && Number.isFinite(basis.value)) carcassC = { basis: basis.value, now: now.value };
    }
    const wetnessMs = measured === undefined ? undefined : wetnessOver(v.wetness, measured.laps);
    return module.wearRatePct({ base, config, ...(wetnessMs !== undefined && { wetnessMs }), ...(carcassC !== undefined && { carcassC }) });
  };
  const wearRatePct: Corners<TyreTerm<number>> = { fl: rate('fl'), fr: rate('fr'), rl: rate('rl'), rr: rate('rr') };
  const game = gameLossOf(v, car, compound);
  const lossMsPerPct = module.lossMsPerPct({ actual, config, ...(game !== undefined && { gameMsPerPct: game }) });
  const gameMs = gameOffset(car, compound);
  const trackMs = trackOffset(v.view, compound);
  const freshOffsetMs = module.freshOffsetMs({ config, ...(gameMs !== undefined && { gameMs }), ...(trackMs !== undefined && { trackMs }) });
  const worst = worstOf(wearRatePct);
  const nuMsPerLap: TyreTerm<number> =
    worst.value.known && lossMsPerPct.value.known ? { value: known(lossMsPerPct.value.value * worst.value.value, worst.value.at), source: worst.source } : { value: worst.value.known ? lossMsPerPct.value : worst.value, source: worst.source };
  const lapsToLimit: Known<number> = !worst.value.known ? worst.value : worst.value.value > 0 ? known(v.c.limitPct / worst.value.value, worst.value.at) : unknown('insufficientData');
  return { wearRatePct, nuMsPerLap, lossMsPerPct, freshOffsetMs, lapsToLimit };
}

/** The fitted set's laps to the limit: the fewest of its corners' (limit − wear) / rate, 0 at or past it (C3: unknown with its reason). */
function fittedLapsToLimit(tyres: TyresNow, rates: Corners<TyreTerm<number>> | undefined, limitPct: number): Known<number> {
  let fewest: Known<number> | undefined;
  for (const corner of CORNERS) {
    const wear = tyres.wearPct[corner] as Known<number>;
    if (!wear.known) return wear;
    let laps: Known<number>;
    if (wear.value >= limitPct) laps = known(0, wear.at);
    else {
      const rate = rates?.[corner].value ?? unknown('insufficientData');
      if (!rate.known) return rate;
      if (!(rate.value > 0)) return unknown('insufficientData');
      laps = known((limitPct - wear.value) / rate.value, Math.max(wear.at, rate.at));
    }
    if (fewest === undefined || (fewest.known && laps.known && laps.value < fewest.value)) fewest = laps;
  }
  return fewest ?? unknown('insufficientData');
}

/** The available fresh sets per compound (C3: the sets' reason while they do not count). */
function freshSetsOf(sets: CarSets): Record<NoiseCompound, Known<number>> {
  const s = usable(sets);
  if (s === undefined) {
    const why = noSets(sets);
    return Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, why])) as Record<NoiseCompound, Known<number>>;
  }
  const counts = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, 0])) as Record<NoiseCompound, number>;
  s.sets.forEach((x, i) => {
    if (isNoise(x.visualCompound) && isFresh(x, i, s.fittedIdx)) counts[x.visualCompound] += 1;
  });
  return Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, known(counts[c], s.at)])) as Record<NoiseCompound, Known<number>>;
}

/** Per tyre type the best fresh set's delta against the fitted set, as the game gives it. */
function typeDeltasOf(sets: CarSets): Record<TyreType, Known<Ms>> {
  const s = usable(sets);
  const out = {} as Record<TyreType, Known<Ms>>;
  for (const type of TYPES) {
    if (s === undefined) {
      out[type] = noSets(sets);
      continue;
    }
    let best: number | undefined;
    s.sets.forEach((x, i) => {
      if (isFresh(x, i, s.fittedIdx) && tyreTypeOf(x.visualCompound) === type && (best === undefined || x.lapDeltaMs < best)) best = x.lapDeltaMs;
    });
    out[type] = best === undefined ? unknown('notReceived') : known(best, s.at);
  }
  return out;
}

/** The fitted set's life span as the game states it. */
function lifeSpanOf(sets: CarSets): Known<number> {
  const s = usable(sets);
  if (s === undefined) return noSets(sets);
  const fitted = fittedOf(s);
  return fitted === undefined ? unknown('notReceived') : known(fitted.lifeSpanLaps, s.at);
}

/** Our car's available sets but the fitted one, of a compound the model tells apart, each with its wear. */
function usedSetsOf(sets: CarSets): TyreModelCar['usedSets'] {
  const s = usable(sets);
  if (s === undefined) return noSets(sets);
  const out: { compound: NoiseCompound; wearPct: number }[] = [];
  s.sets.forEach((x, i) => {
    if (x.available && !x.fitted && i !== s.fittedIdx && isNoise(x.visualCompound)) out.push({ compound: x.visualCompound, wearPct: x.wearPct });
  });
  return known(out, s.at);
}

/**
 * `tyre-model`'s output on `view` for `cars` (each with its rows, `TYRE_MODEL_BEHAVIOUR`: a car not in the session has
 * none), each car's tyres now from `tyresOf` (given the car's laps).
 */
export function tyreModelOf(view: AsOfView, cars: readonly CarId[], tyresOf: (car: CarId, laps: readonly LapRecord[]) => TyresNow): TyreModelOutput {
  const c = configOf(TYRE_MODEL_CONFIG, view);
  const v: ViewCtx = {
    view,
    c,
    maxNeutralisedMs: configOf(LAP_CLASSES_CONFIG, view).maxNeutralisedMs,
    wetness: view.outputs.get(TRACK_WETNESS) as DeepReadonly<TrackWetness> | undefined,
  };
  const effects = effectsByCar(view);
  const lapsOf = lapsByCar(view.history);
  const fixed = view.fixed;
  const player = fixed.playerCar;
  const teammate = fixed.teammateCar;
  const ours = player.known ? ourCars({ playerCar: player.value, teammateCar: teammate.known ? teammate.value : undefined }) : [];
  const tyresBy = new Map<CarId, TyresNow>();
  const tyresOfCar = (id: CarId): TyresNow => {
    let t = tyresBy.get(id);
    if (t === undefined) {
      t = tyresOf(id, lapsOf.get(id) ?? []);
      tyresBy.set(id, t);
    }
    return t;
  };
  const ourSets = player.known ? usable(tyresOfCar(player.value).sets) : undefined;
  const out: TyreModelOutput = {};
  for (const id of cars) {
    const effect = effects.get(id);
    if (effect?.inSession !== true) continue;
    const tyres = tyresOfCar(id);
    const laps = lapsOf.get(id) ?? [];
    const own = onFittedSet(currentStintLaps(view.history, id, laps), tyres.set);
    const car: CarCtx = { id, human: effect.human === true, tyres, priorSets: usable(tyres.sets) ?? ourSets, own };
    const compounds = Object.fromEntries(NOISE_COMPOUNDS.map((compound) => [compound, compoundOf(v, car, compound)])) as Record<NoiseCompound, TyreModelCompound>;
    const fitted = tyres.set !== undefined && isNoise(tyres.set.visualCompound) ? compounds[tyres.set.visualCompound].wearRatePct : undefined;
    out[id] = {
      compounds,
      typeDeltaMs: typeDeltasOf(tyres.sets),
      freshSets: freshSetsOf(tyres.sets),
      limitPct: c.limitPct,
      fittedLapsToLimit: fittedLapsToLimit(tyres, fitted, c.limitPct),
      fittedLifeSpanLaps: lifeSpanOf(tyres.sets),
      usedSets: ours.includes(id) ? usedSetsOf(tyres.sets) : unknown('notApplicable'),
    };
  }
  return out;
}
