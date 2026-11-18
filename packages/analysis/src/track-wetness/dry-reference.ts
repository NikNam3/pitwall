// The dry references `track-wetness`'s state is measured against (SP4.3b Task 19c, research 19's wetness spike: a stint's
// own first laps read a race that starts wet as dry; SP4.3c O3: `track-wetness` owns the one dry reference). A reference
// is a dry pace level on the medium's scale: a stint's fuel-corrected time at tyre age 0 (`ref` of its line `ref + ν ·
// age`) minus its compound's offset against medium (the lap model's parameters, `lapModelParams`). Sources, in order: a
// car's own dry slick laps this session; else the field's dry reference: the median of the cars' own references this
// session, else the calibration set's priors entry `trackWetness.dryRefMs` (C62a), else the median of the cars' dry
// slick stints in the weekend's earlier sessions (`view.basis`, C39, C62). A lap on inters or wets goes on the slick
// scale through the lap model's inter and wet terms: w = (excess − offset) / slope.
//
// Without any dry reference (no slick lap anywhere), the game's slick delta is a wetness reading, never a second dry
// reference (research 22 §1.9): the fresh slick's delta against the fitted inter or wet, on the slick scale.
import { currentLaps, known, tyreTypeOf, unknown, type Known, type LapModelParams, type LapRecord, type Ms, type TyreSet, type TyreType, type VisualCompound } from '@pitwall/domain';
import { definePriors, type AsOfView, type CalculatorId, type DeepReadonly, type PriorDecl, type PriorsCtx, type StoredSource, type StoredSession } from '@pitwall/engine/readers';
import { DEGRADATION_CONFIG, fitStint, phaseRow } from '../degradation/index.ts';
import { fitLaps, fuelResolver, type FuelOf } from '../degradation/stint-fit.ts';
import { LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { configOf } from '../shared/config-of.ts';
import { lapModelParams } from '../shared/forecast-field/lap-model-params.ts';
import { median } from '../shared/stats.ts';
import { lapsByCar } from '../shared/stint-laps.ts';
import { bestFreshSet } from '../shared/tyre-prior.ts';

type Lap = DeepReadonly<LapRecord>;

/** The priors key of the dry reference (C62a). */
export const DRY_REF_KEY = 'trackWetness.dryRefMs';

/** The lap model's terms a lap is put on the slick scale with: per compound its dry offset against medium, per tyre type its slope. */
export type SlickScale = {
  /** A compound's dry offset against medium (ms); `undefined` for a compound the lap model has no term for. */
  offsetMs(visual: VisualCompound, type: TyreType): number | undefined;
  /** A tyre type's loss per ms of track wetness. */
  slope(type: TyreType): number;
};

/** The slick scale of a lap model's parameters (O3: the lap model's terms, no offsets of `track-wetness`'s own). */
export function slickScaleFrom(p: DeepReadonly<LapModelParams>): SlickScale {
  return {
    offsetMs: (visual, type) => {
      if (type === 'inter') return p.compoundOffsetMs.inter;
      if (type === 'wet') return p.compoundOffsetMs.wet;
      if (visual === 'soft' || visual === 'medium' || visual === 'hard') return p.compoundOffsetMs[visual];
      return undefined;
    },
    slope: (type) => p.wetnessMsPerMs[type],
  };
}

/** A car's laps split into runs on one set: a new run where the compound changes or the tyre age does not go on. */
function setRuns<L extends { lapNumber: number; tyreAgeAtStart: number; actualCompound: string; visualCompound: string }>(laps: readonly L[]): L[][] {
  const runs: L[][] = [];
  let run: L[] = [];
  for (const lap of laps) {
    const prev = run.at(-1);
    if (prev !== undefined && (lap.actualCompound !== prev.actualCompound || lap.visualCompound !== prev.visualCompound || lap.tyreAgeAtStart !== prev.tyreAgeAtStart + (lap.lapNumber - prev.lapNumber))) {
      runs.push(run);
      run = [];
    }
    run.push(lap);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** What a stored run's reference is fitted with: `degradation`'s filter and rules for the session's weekend phase (C43). */
type RunFit = { fuelOf: FuelOf; config: (typeof DEGRADATION_CONFIG)['defaults']; classes: LapClassOptions; rate: (typeof PER_LAP_RATE_CONFIG)['defaults'] };

/** The fit of one stored session: its weekend phase's lap classes and its fuel, `ourCar`'s laps standing in for hidden loads. */
function runFitOf(holder: { readonly config: AsOfView['config'] }, isRace: boolean, ourCar: Lap['carId'], ourLaps: () => readonly Lap[]): RunFit {
  const config = configOf(DEGRADATION_CONFIG, holder);
  const classes = { isRace, ...configOf(LAP_CLASSES_CONFIG, holder) };
  const rate = configOf(PER_LAP_RATE_CONFIG, holder);
  const fuelOf = fuelResolver({ isRace, ourCar, ourLaps, classes, rate, fallbackBurnKgPerLap: config.fallbackBurnKgPerLap });
  return { fuelOf, config, classes, rate };
}

/**
 * One run's medium-scale dry reference: a slick run fuel-corrected and fitted (`degradation`'s filter), `α` minus the
 * compound's offset; `undefined` for a run on another type, without a known fuel (its time is not on the corrected
 * scale, C3) or without a fit.
 */
function runReference(run: readonly Lap[], fit: RunFit, scale: SlickScale): number | undefined {
  const first = run[0];
  if (first === undefined || tyreTypeOf(first.actualCompound) !== 'slick') return undefined;
  const offset = scale.offsetMs(first.visualCompound, 'slick');
  if (offset === undefined) return undefined;
  const prior = { nuMsPerLap: fit.config.defaultNuMsPerLap, nuSdMs: fit.config.defaultNuSdMs };
  const fitted = fitLaps(run, fit.fuelOf, prior, fit.config, fit.classes, fit.rate);
  if (!fitted.fuelCorrected) return undefined;
  const stint = fitStint(fitted.paceLaps, prior, fit.config);
  return stint.known ? stint.value.alphaMs - offset : undefined;
}

/** Whether a stored session's weekend phase is the race. */
const isRacePhase = (phase: string | undefined): boolean => phase !== undefined && phaseRow(phase as Parameters<typeof phaseRow>[0]).isRace === true;

/** The medium-scale dry references of one earlier session's cars: per car the median over its slick runs' references. */
function storedReferences(session: DeepReadonly<StoredSession>, view: Pick<AsOfView, 'config'>, scale: SlickScale): number[] {
  const projection = session.projection;
  const byCar = lapsByCar(projection);
  const fit = runFitOf(view, isRacePhase((projection.spans['weekend-phase'] ?? []).at(-1)?.kind), session.playerCar, () => byCar.get(session.playerCar) ?? []);
  const out: number[] = [];
  for (const laps of byCar.values()) {
    const refs = setRuns(laps).flatMap((run) => runReference(run, fit, scale) ?? []);
    const ref = median(refs);
    if (ref !== undefined) out.push(ref);
  }
  return out;
}

/** The field's dry reference from the weekend's earlier sessions: the median of their cars' references; `undefined` without one. */
export function weekendFieldReference(view: Pick<AsOfView, 'basis' | 'config'>, scale: SlickScale): number | undefined {
  const basis = view.basis;
  if (basis === undefined) return undefined;
  return median(basis.sessions.flatMap((s) => storedReferences(s, view, scale)));
}

/** The calibration set's dry reference (`view.priors`' entry `trackWetness.dryRefMs`) with its set, if the run has one. */
export function calibrationReference(view: Pick<AsOfView, 'priors'>): { ms: number; setName: string; sources: number } | undefined {
  if (!view.priors.known) return undefined;
  const snapshot = view.priors.value;
  const entry = snapshot.entries[DRY_REF_KEY];
  return entry?.known === true ? { ms: entry.value, setName: snapshot.setName, sources: snapshot.sources } : undefined;
}

/** A calibration source's dry reference: its stint fitted with its session's rules, on the lap model's prior offsets. */
function sourceReference(source: StoredSource, ctx: PriorsCtx): number | undefined {
  const ourCar = source.source.feedCar;
  const ourLaps = source.sessionLaps.filter((l) => l.carId === ourCar);
  const fit = runFitOf(ctx, phaseRow(source.phase.kind).isRace === true, ourCar, () => ourLaps);
  // no session outputs between runs: the offsets are the lap model's priors (`lapModelParams` without fitted stints)
  const scale = slickScaleFrom(lapModelParams({ config: ctx.config, track: source.track }, new Map<CalculatorId, unknown>()));
  const laps = [...source.laps].sort((a, b) => a.lapNumber - b.lapNumber);
  return runReference(laps, fit, scale);
}

const dryRefEntry: PriorDecl = {
  version: 1,
  range: [20_000, 300_000],
  /** The median over the set's dry slick stints of their medium-scale references; an override replaces it. */
  aggregate: (sources, ctx): Known<number> => {
    const override = ctx.overrides[DRY_REF_KEY];
    if (override !== undefined) return known(override, 0);
    const ref = median(sources.flatMap((s) => sourceReference(s, ctx) ?? []));
    return ref === undefined ? unknown('insufficientData') : known(Math.round(ref), 0);
  },
  samples: (sources, ctx) => sources.filter((s) => sourceReference(s, ctx) !== undefined).length,
  /** The source's own reference minus the set's, in ms. */
  residual: (source, set): Known<number> => {
    const own = source[DRY_REF_KEY];
    const pooled = set[DRY_REF_KEY];
    if (own?.known !== true || pooled?.known !== true) return unknown('insufficientData');
    return known(own.value - pooled.value, Math.max(own.at, pooled.at));
  },
};

/** `track-wetness`'s priors entries (C62a): the dry reference over a set's dry slick stints. */
export const TRACK_WETNESS_PRIORS = definePriors('track-wetness', {
  entries: { [DRY_REF_KEY]: dryRefEntry },
  candidate: (source) => tyreTypeOf(source.stint.actualCompound) === 'slick',
});

/** The slick-scale wetness the game's slick delta reads on one lap's sets; `undefined` without a reading. */
function deltaReading(sets: readonly DeepReadonly<TyreSet>[], scale: SlickScale): number | undefined {
  const fitted = sets.find((s) => s.fitted);
  const fittedType = fitted === undefined ? undefined : tyreTypeOf(fitted.actualCompound);
  if (fitted === undefined || fittedType === undefined || fittedType === 'slick') return undefined;
  const fittedOffset = scale.offsetMs(fitted.visualCompound, fittedType);
  const slope = scale.slope('slick') - scale.slope(fittedType);
  if (fittedOffset === undefined || !(slope > 0)) return undefined;
  let best: number | undefined;
  for (const visual of ['soft', 'medium', 'hard'] as const) {
    const fresh = bestFreshSet(sets as TyreSet[], visual);
    const offset = scale.offsetMs(visual, 'slick');
    if (fresh === undefined || offset === undefined) continue;
    // delta = (slick offset − fitted offset) + (slick slope − fitted slope) · w, against the fitted set's own laps
    const w = (fresh.lapDeltaMs - fitted.lapDeltaMs - (offset - fittedOffset)) / slope;
    if (best === undefined || w < best) best = w;
  }
  return best;
}

/**
 * Per lap `1..leaderLap` the game's slick delta as a wetness reading (research 22 §1.9): the median over the laps of that
 * number whose record carries the game's sets on a fitted inter or wet of the fresh slick's delta on the slick scale,
 * known since the newest of them. Read only while no dry reference exists.
 */
export function slickDeltaReadings(view: Pick<AsOfView, 'history'>, leaderLap: number, scale: SlickScale): ({ value: number; at: Ms } | undefined)[] {
  const byLap: { values: number[]; at: Ms }[] = Array.from({ length: leaderLap + 1 }, () => ({ values: [], at: 0 }));
  for (const lap of currentLaps(view.history.laps as LapRecord[])) {
    if (lap.lapNumber < 1 || lap.lapNumber > leaderLap || !lap.tyreSets.known) continue;
    const w = deltaReading(lap.tyreSets.value, scale);
    if (w === undefined) continue;
    const slot = byLap[lap.lapNumber] as { values: number[]; at: Ms };
    slot.values.push(w);
    slot.at = Math.max(slot.at, lap.tyreSets.at);
  }
  const out: ({ value: number; at: Ms } | undefined)[] = [];
  for (let lap = 1; lap <= leaderLap; lap++) {
    const slot = byLap[lap] as { values: number[]; at: Ms };
    const m = median(slot.values);
    out.push(m === undefined ? undefined : { value: m, at: slot.at });
  }
  return out;
}
