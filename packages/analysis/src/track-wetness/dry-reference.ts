// The dry references `track-wetness`'s state is measured against (SP4.3b Task 19c, research 19's wetness spike: a stint's
// own first laps read a race that starts wet as dry). A reference is a dry pace level on the medium's scale: a stint's
// fuel-corrected time at tyre age 0 (`ref` of its line `ref + ν · age`) minus its compound's offset against medium (the
// lap model's prior offsets, `priorOffsets`). Sources, in order: a car's own dry slick laps this session; else the
// field's dry reference: the median of the cars' own references this session, else of the cars' dry slick stints in the
// weekend's earlier sessions (`view.weekend`, C39, C62). A lap on inters or wets goes on the slick scale through the lap
// model's inter and wet terms (`forecast-field`'s config): w = (excess − offset) / slope.
import type { TyreType, VisualCompound } from '@pitwall/domain';
import type { AsOfView, DeepReadonly, StoredSession } from '@pitwall/engine/readers';
import { tyreTypeOf } from '../crossover/tyre-type.ts';
import { DEGRADATION_CONFIG, fitStint, phaseRow } from '../degradation/index.ts';
import { fitLaps, fuelResolver, lapsByCar } from '../degradation/stint-fit.ts';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { FORECAST_FIELD_CONFIG } from '../shared/forecast-field/config.ts';
import { priorOffsets } from '../shared/forecast-field/lap-model-params.ts';

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

/** The lap model's terms a lap is put on the slick scale with: per compound its dry offset against medium, per tyre type its slope. */
export type SlickScale = {
  /** A compound's dry offset against medium (ms); `undefined` for a compound the lap model has no term for. */
  offsetMs(visual: VisualCompound, type: TyreType): number | undefined;
  /** A tyre type's loss per ms of track wetness. */
  slope(type: TyreType): number;
};

/** The slick scale of `view`'s lap model: `forecast-field`'s config and the prior offsets of the dry compounds. */
export function slickScaleOf(view: Pick<AsOfView, 'config' | 'track'>): SlickScale {
  const c = FORECAST_FIELD_CONFIG.read(view);
  const slicks = priorOffsets(view);
  return {
    offsetMs: (visual, type) => {
      if (type === 'inter') return c.interOffsetMs;
      if (type === 'wet') return c.wetOffsetMs;
      if (visual === 'medium') return 0;
      if (visual === 'soft' || visual === 'hard') return slicks[visual];
      return undefined;
    },
    slope: (type) => (type === 'inter' ? c.interMsPerWetnessMs : type === 'wet' ? c.wetMsPerWetnessMs : c.slickMsPerWetnessMs),
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

/**
 * The medium-scale dry references of one earlier session's cars: per car the median over its fuel-corrected slick
 * stints with a fit (`degradation`'s filter, its rules for that session's weekend phase, C43) of `α` minus the compound's
 * offset. A stint without a known fuel is left out (its time is not on the corrected scale, C3).
 */
function storedReferences(session: DeepReadonly<StoredSession>, view: Pick<AsOfView, 'config'>, scale: SlickScale): number[] {
  const projection = session.projection;
  const phase = (projection.spans['weekend-phase'] ?? []).at(-1)?.kind;
  const isRace = phase !== undefined && phaseRow(phase as Parameters<typeof phaseRow>[0]).isRace === true;
  const config = DEGRADATION_CONFIG.read(view);
  const classes = { isRace, ...LAP_CLASSES_CONFIG.read(view) };
  const rate = PER_LAP_RATE_CONFIG.read(view);
  const byCar = lapsByCar(projection.laps);
  const fuelOf = fuelResolver({
    isRace,
    ourCar: session.playerCar,
    ourLaps: () => byCar.get(session.playerCar) ?? [],
    classes,
    rate,
    fallbackBurnKgPerLap: config.fallbackBurnKgPerLap,
  });
  const prior = { nuMsPerLap: config.defaultNuMsPerLap, nuSdMs: config.defaultNuSdMs };
  const out: number[] = [];
  for (const laps of byCar.values()) {
    const refs: number[] = [];
    for (const run of setRuns(laps)) {
      const first = run[0];
      if (first === undefined || tyreTypeOf(first.actualCompound) !== 'slick') continue;
      const offset = scale.offsetMs(first.visualCompound, 'slick');
      if (offset === undefined) continue;
      const fitted = fitLaps(run, fuelOf, prior, config, classes, rate);
      if (!fitted.fuelCorrected) continue;
      const fit = fitStint(fitted.paceLaps, prior, config);
      if (fit.known) refs.push(fit.value.alphaMs - offset);
    }
    if (refs.length > 0) out.push(median(refs));
  }
  return out;
}

/** The field's dry reference from the weekend's earlier sessions: the median of their cars' references; `undefined` without one. */
export function weekendFieldReference(view: Pick<AsOfView, 'weekend' | 'config'>, scale: SlickScale): number | undefined {
  const weekend = view.weekend;
  if (weekend === undefined) return undefined;
  const refs = weekend.sessions.flatMap((s) => storedReferences(s, view, scale));
  return refs.length === 0 ? undefined : median(refs);
}
