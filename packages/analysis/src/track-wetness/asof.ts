// `track-wetness` as of a frame (SP4.3a spec 5.1, 6.1): a pure function of the `AsOfView`. Per completed leader lap and
// tyre type the field's common mode: the median residual of the cars in free air on that type against their dry
// reference; and the 1-state filter's wetness over those laps.
//
// A car's dry reference on a stint is the stint's line `ref + ν · age`: `ref` the median of its first free-air pace laps
// (`dryReferenceLaps`), `ν` `degradation`'s. A wet lap pulls `degradation`'s `ν` (it fits every pace lap), so a stint
// with laps the first pass finds wet is refitted with `degradation`'s own filter on its dry pace laps (C43), and the
// common modes are computed again. The common modes stay stint-relative (`driver-noise` reads them against each stint's
// own line).
//
// The state is measured from dry (SP4.3b Task 19c): a slick stint with dry free-air laps against its own first dry ones;
// every other stint against its car's own dry reference this session, else the field's (`dry-reference.ts`); each lap
// on the slick scale through the lap model's terms. Without any dry reference the state is `insufficientData` (C3).
import { known, unknown, type CarId, type Known, type Ms, type TrackWetness, type TyreType } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';
import { tyreTypeOf } from '../crossover/tyre-type.ts';
import { DEGRADATION, DEGRADATION_CONFIG, fitStint, type DegradationOutput, type StintDegradation } from '../degradation/index.ts';
import { DRIVER_NOISE_CONFIG } from '../driver-noise/config.ts';
import { freeAirLaps, type FreeAirLaps } from '../shared/free-air.ts';
import { sessionEffect } from './behaviour.ts';
import { median, slickScaleOf, weekendFieldReference, type SlickScale } from './dry-reference.ts';
import { TRACK_WETNESS_CONFIG } from './config.ts';
import { runWetnessFilter, type WetnessFilterConfig } from './kalman.ts';

const TYPES: readonly TyreType[] = ['slick', 'inter', 'wet'];

const NOT_APPLICABLE: TrackWetness = { byLap: [], state: unknown('notApplicable') };

type Config = (typeof TRACK_WETNESS_CONFIG)['defaults'];
type DegradationConfig = (typeof DEGRADATION_CONFIG)['defaults'];

/** A pace lap of a stint (`degradation`'s use: used or down-weighted) with its corrected time. */
type PaceLap = { lap: number; tyreAge: number; ms: number; at: Ms; free: boolean };

/** One car's stint as the common mode reads it: its tyre type, its pace laps and `degradation`'s fit. */
type Stint = { car: CarId; type: TyreType; laps: PaceLap[]; fit: StintDegradation };

/** Every stint with a tyre type and a `ν`, with its pace laps. */
function stintsOf(degradation: DegradationOutput, free: FreeAirLaps): Stint[] {
  const out: Stint[] = [];
  for (const [key, stints] of Object.entries(degradation)) {
    const car = Number(key);
    for (const fit of stints) {
      const type = tyreTypeOf(fit.actual);
      if (type === undefined || !fit.nuMsPerLap.known) continue;
      const laps: PaceLap[] = [];
      for (const l of fit.laps) {
        if (typeof l.use === 'object' || !l.correctedMs.known) continue;
        laps.push({ lap: l.lapNumber, tyreAge: l.tyreAge, ms: l.correctedMs.value, at: l.correctedMs.at, free: free.isFree(car, l.lapNumber) });
      }
      out.push({ car: car as CarId, type, laps, fit });
    }
  }
  return out;
}

/** The common modes per lap `1..leaderLap` with each stint detrended by `nuOf(stint)`. */
function commonModes(stints: readonly Stint[], nuOf: (s: Stint) => number, leaderLap: number, config: Config): TrackWetness['byLap'] {
  type Slot = { values: number[]; at: Ms };
  const residuals: Partial<Record<TyreType, Slot>>[] = Array.from({ length: leaderLap + 1 }, () => ({}));
  for (const stint of stints) {
    const nu = nuOf(stint);
    const free = stint.laps.filter((l) => l.free && l.lap <= leaderLap);
    if (free.length === 0) continue;
    const detrended = free.map((l) => ({ lap: l.lap, at: l.at, ms: l.ms - nu * l.tyreAge }));
    const reference = median(detrended.slice(0, config.dryReferenceLaps).map((d) => d.ms));
    for (const d of detrended) {
      const ofLap = residuals[d.lap] as Partial<Record<TyreType, Slot>>;
      const slot = (ofLap[stint.type] ??= { values: [], at: 0 });
      slot.values.push(d.ms - reference);
      slot.at = Math.max(slot.at, d.at);
    }
  }
  const byLap: TrackWetness['byLap'] = [];
  for (let lap = 1; lap <= leaderLap; lap++) {
    const commonModeMs = {} as Record<TyreType, Known<Ms>>;
    for (const type of TYPES) {
      const r = residuals[lap]?.[type];
      commonModeMs[type] = r === undefined ? unknown('insufficientData') : known(Math.round(median(r.values)), r.at);
    }
    byLap.push({ lap, commonModeMs });
  }
  return byLap;
}

/** A lap's measurement: the slick common mode (the state's scale), else the common mode of the one other type that runs. */
const measurementOf = (entry: TrackWetness['byLap'][number]): Extract<Known<Ms>, { known: true }> | undefined => {
  for (const type of TYPES) {
    const k = entry.commonModeMs[type];
    if (k.known) return k;
  }
  return undefined;
};

/** The laps whose filtered state, after the lap, is wet: more than `wetSigmas` sd above a dry track. */
function wetLaps(byLap: TrackWetness['byLap'], filter: WetnessFilterConfig, wetSigmas: number): ReadonlySet<number> {
  const wet = new Set<number>();
  const zs: (number | undefined)[] = [];
  for (const entry of byLap) {
    zs.push(measurementOf(entry)?.value);
    const state = runWetnessFilter(zs, filter);
    if (state !== undefined && state.wetnessMs - wetSigmas * state.sdMs > 0) wet.add(entry.lap);
  }
  return wet;
}

/** A stint's `ν` on its dry pace laps: `degradation`'s own when none is wet, else its filter refitted without the wet ones. */
function dryNu(stint: Stint, wet: ReadonlySet<number>, degradation: DegradationConfig): number {
  const own = stint.fit.nuMsPerLap.known ? stint.fit.nuMsPerLap.value : stint.fit.startPrior.nuMsPerLap;
  if (!stint.laps.some((l) => wet.has(l.lap))) return own;
  const dry = stint.laps.filter((l) => !wet.has(l.lap)).map((l) => ({ lapNumber: l.lap, tyreAge: l.tyreAge, ms: l.ms }));
  const fit = fitStint(dry, stint.fit.startPrior, degradation);
  return fit.known ? fit.value.nuMsPerLap : stint.fit.startPrior.nuMsPerLap;
}

/** A lap's measurement of the state: the slick-scale wetness (ms) and the newest time it rests on. */
type Measurement = { value: number; at: Ms } | undefined;

/**
 * The state's measurement per lap `1..leaderLap` (Task 19c): per lap the median over the free-air cars of their
 * slick-scale wetness, of the first tyre type (slick, inter, wet) that has one. A car's lap reads against its stint's own
 * first dry laps (a slick stint with dry free-air laps: its excess is the wetness), else its car's own dry reference this
 * session (the median over its slick stints with dry laps of the stint's reference minus its compound's offset), else
 * the field's (the median of the cars' own references, else the weekend's, `weekendFieldReference`): w = (excess −
 * offset) / slope. On each lap and type the cars with an own reference count, the field's only where none has one.
 */
function measurementsOf(view: AsOfView, stints: readonly Stint[], nuOf: (s: Stint) => number, wet: ReadonlySet<number>, leaderLap: number, config: Config, scale: SlickScale): Measurement[] {
  type Read = { stint: Stint; lap: PaceLap; ms: number };
  const reads = stints.map((stint) => {
    const nu = nuOf(stint);
    return stint.laps.filter((l) => l.free && l.lap <= leaderLap).map((lap): Read => ({ stint, lap, ms: lap.ms - nu * lap.tyreAge }));
  });
  // a slick stint's own reference: the median of its first dry free-air laps
  const stintRef = reads.map((rs, i) => {
    const stint = stints[i] as Stint;
    if (stint.type !== 'slick') return undefined;
    const dry = rs.filter((r) => !wet.has(r.lap.lap)).slice(0, config.dryReferenceLaps);
    return dry.length === 0 ? undefined : median(dry.map((r) => r.ms));
  });
  const ownByCar = new Map<CarId, number[]>();
  stintRef.forEach((ref, i) => {
    const stint = stints[i] as Stint;
    const offset = scale.offsetMs(stint.fit.visual, stint.type);
    if (ref === undefined || offset === undefined) return;
    const of = ownByCar.get(stint.car) ?? [];
    of.push(ref - offset);
    ownByCar.set(stint.car, of);
  });
  const own = new Map([...ownByCar].map(([car, refs]) => [car, median(refs)] as const));
  let field: number | undefined = own.size > 0 ? median([...own.values()]) : undefined;
  field ??= weekendFieldReference(view, scale);

  type Slot = { own: number[]; field: number[]; ownAt: Ms; fieldAt: Ms };
  const slots: Partial<Record<TyreType, Slot>>[] = Array.from({ length: leaderLap + 1 }, () => ({}));
  reads.forEach((rs, i) => {
    const stint = stints[i] as Stint;
    const offset = scale.offsetMs(stint.fit.visual, stint.type);
    const slope = scale.slope(stint.type);
    const ref = stintRef[i];
    const carRef = own.get(stint.car);
    for (const r of rs) {
      let w: number;
      let isOwn = true;
      if (ref !== undefined) w = (r.ms - ref) / slope;
      else if (offset === undefined) continue;
      else if (carRef !== undefined) w = (r.ms - carRef - offset) / slope;
      else if (field !== undefined) {
        w = (r.ms - field - offset) / slope;
        isOwn = false;
      } else continue;
      const ofLap = slots[r.lap.lap] as Partial<Record<TyreType, Slot>>;
      const slot = (ofLap[stint.type] ??= { own: [], field: [], ownAt: 0, fieldAt: 0 });
      if (isOwn) {
        slot.own.push(w);
        slot.ownAt = Math.max(slot.ownAt, r.lap.at);
      } else {
        slot.field.push(w);
        slot.fieldAt = Math.max(slot.fieldAt, r.lap.at);
      }
    }
  });
  const out: Measurement[] = [];
  for (let lap = 1; lap <= leaderLap; lap++) {
    let m: Measurement;
    for (const type of TYPES) {
      const slot = slots[lap]?.[type];
      if (slot === undefined) continue;
      if (slot.own.length > 0) m = { value: median(slot.own), at: slot.ownAt };
      else if (slot.field.length > 0) m = { value: median(slot.field), at: slot.fieldAt };
      if (m !== undefined) break;
    }
    out.push(m);
  }
  return out;
}

/**
 * The forecast's rain chance now (ruling R19): the `rainPct` of the forecast sample nearest the present (smallest
 * `|offsetMin|`); `undefined` without `weatherNow` (a cut or stored view) or without a sample.
 */
function rainNowPct(view: AsOfView): number | undefined {
  const weather = view.fixed.weatherNow;
  if (weather === null) return undefined;
  let nearest: (typeof weather.forecast)[number] | undefined;
  for (const s of weather.forecast) if (nearest === undefined || Math.abs(s.offsetMin) < Math.abs(nearest.offsetMin)) nearest = s;
  return nearest?.rainPct;
}

/** The field's common mode per completed leader lap and tyre type, and the filtered wetness state, as of `view`'s frame. */
export function trackWetnessAsOf(view: AsOfView): TrackWetness {
  const effect = sessionEffect(view);
  if (effect.isRace !== true) return NOT_APPLICABLE;
  const degradation = view.outputs.get(DEGRADATION) as DegradationOutput | undefined;
  if (effect.started !== true || degradation === undefined) return { byLap: [], state: unknown('insufficientData') };
  const config = TRACK_WETNESS_CONFIG.read(view);
  const free = freeAirLaps(view.history, DRIVER_NOISE_CONFIG.read(view).freeAirGapMs);

  let leaderLap = 0;
  for (const l of view.history.laps) if (l.lapNumber > leaderLap) leaderLap = l.lapNumber;

  const stints = stintsOf(degradation, free);
  const first = commonModes(stints, (s) => (s.fit.nuMsPerLap.known ? s.fit.nuMsPerLap.value : s.fit.startPrior.nuMsPerLap), leaderLap, config);
  const wet = wetLaps(first, config, config.wetSigmas);
  const degradationConfig = DEGRADATION_CONFIG.read(view);
  const nuOf = wet.size === 0 ? (s: Stint) => (s.fit.nuMsPerLap.known ? s.fit.nuMsPerLap.value : s.fit.startPrior.nuMsPerLap) : (s: Stint) => dryNu(s, wet, degradationConfig);
  const byLap = wet.size === 0 ? first : commonModes(stints, nuOf, leaderLap, config);

  const measured = measurementsOf(view, stints, nuOf, wet, leaderLap, config, slickScaleOf(view));
  const newestAt = measured.reduce<Ms | undefined>((at, z) => (z === undefined ? at : Math.max(at ?? 0, z.at)), undefined);
  // the forecast enters the prediction step only (ruling R19): the wet-lap pass and the common modes never read it
  const state = runWetnessFilter(measured.map((z) => z?.value), config, rainNowPct(view));
  return {
    byLap,
    state: state === undefined || newestAt === undefined ? unknown('insufficientData') : known({ wetnessMs: Math.round(state.wetnessMs), sdMs: Math.round(state.sdMs) }, newestAt),
  };
}
