// `crossover` (spec 3.4, B8, B9): for each of our cars, the field's green-lap medians per tyre type and lap number, the
// dry reference, the 110 % line, our %, the first car on another type faster than us in a sector, and the laps a switch
// takes to pay back. Quick (C31). Race only (C14): in every other weekend phase every field is `notApplicable`.
import {
  currentLaps,
  known,
  unknown,
  type CarId,
  type Crossover,
  type CrossoverLap,
  type FirstFaster,
  type Known,
  type LapRecord,
  type Ms,
  type PitLosses,
  type TyreType,
} from '@pitwall/domain';
import { membershipOf, openSpansOf, type DeepReadonly, type EngineView, type QuickCalculator } from '@pitwall/engine/readers';
import { isPaceLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { median } from '../pit-loss/loss.ts';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { ourCars } from '../shared/our-cars.ts';
import { CROSSOVER_BEHAVIOUR, phaseRow, type CrossoverEffect } from './behaviour.ts';
import { CROSSOVER_CONFIG } from './config.ts';
import { CROSSOVER, type CrossoverOutput } from './index.ts';
import { tyreTypeOf } from './tyre-type.ts';

type Lap = DeepReadonly<LapRecord>;

/** A green lap with its tyre type. */
type TypedLap = { lap: Lap; type: TyreType };

const TYPES: readonly TyreType[] = ['slick', 'inter', 'wet'];
/** Each sector with its index in `sectorTimesMs`. */
const SECTORS = [
  [1, 0],
  [2, 1],
  [3, 2],
] as const;
const SESSION_PHASE = 'session-phase-race';

const NOT_APPLICABLE: Crossover = {
  ourType: unknown('notApplicable'),
  byLap: [],
  dryRefMs: unknown('notApplicable'),
  line110Ms: unknown('notApplicable'),
  ourPct: unknown('notApplicable'),
  firstFaster: unknown('notApplicable'),
  payback: unknown('notApplicable'),
};

/** Completion order: by the frame a lap describes (its crossing, C26), then its completion time. */
const byCompletion = (a: Lap, b: Lap): number => a.frame - b.frame || a.completedAt - b.completedAt;

/**
 * Whether laps can carry an excluded kind in their membership: some span of the race's session phase, closed or open,
 * has an excluded row. Without one no lap's membership needs looking up.
 */
function anyExcludedSpan(view: EngineView): boolean {
  const rows = CROSSOVER_BEHAVIOUR[SESSION_PHASE] ?? {};
  const excluded = (kind: string): boolean => rows[kind]?.excluded === true;
  return (view.history.spans[SESSION_PHASE] ?? []).some((s) => excluded(s.kind)) || openSpansOf(view, SESSION_PHASE).some((s) => excluded(s.kind));
}

/** The green laps (spec 3.4): current (C25), `forPace` (`lap-classes`, C43), no excluded row in their membership (C26), with a type. */
function greenLaps(view: EngineView, classes: LapClassOptions): TypedLap[] {
  const rows = CROSSOVER_BEHAVIOUR[SESSION_PHASE] ?? {};
  const checkMembership = anyExcludedSpan(view);
  const green: TypedLap[] = [];
  for (const lap of currentLaps(view.history.laps as LapRecord[])) {
    const type = tyreTypeOf(lap.actualCompound);
    if (type === undefined || !isPaceLap(lap, classes)) continue;
    if (checkMembership) {
      const span = membershipOf(view, lap)[SESSION_PHASE];
      if (span !== undefined && rows[span.kind]?.excluded === true) continue;
    }
    green.push({ lap, type });
  }
  return green.sort((a, b) => byCompletion(a.lap, b.lap));
}

/** The median of `laps` (integer ms, C4), known since the newest one's completion; `insufficientData` below `minCars`. */
function medianOf(laps: readonly Lap[], minCars: number): Known<Ms> {
  if (laps.length === 0 || laps.length < minCars) return unknown('insufficientData');
  const at = laps.reduce((t, l) => Math.max(t, l.completedAt), 0);
  return known(Math.round(median(laps.map((l) => l.lapTimeMs))), at);
}

/** Per lap number with a green lap, ascending, the median of each type's green laps. */
function byLapOf(green: readonly TypedLap[], minCars: number): CrossoverLap[] {
  const groups = new Map<number, Record<TyreType, Lap[]>>();
  for (const { lap, type } of green) {
    let group = groups.get(lap.lapNumber);
    if (group === undefined) groups.set(lap.lapNumber, (group = { slick: [], inter: [], wet: [] }));
    group[type].push(lap);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lapNumber, group]) => ({
      lapNumber,
      medianMs: { slick: medianOf(group.slick, minCars), inter: medianOf(group.inter, minCars), wet: medianOf(group.wet, minCars) },
    }));
}

/** The lowest known slick median so far; `insufficientData` until one exists. */
function dryRefOf(byLap: readonly CrossoverLap[]): Known<Ms> {
  let best: Known<Ms> = unknown('insufficientData');
  for (const row of byLap) {
    const m = row.medianMs.slick;
    if (m.known && (!best.known || m.value < best.value)) best = m;
  }
  return best;
}

/** A type's latest known median: the one of the highest lap number that has it. */
function latestMedianOf(byLap: readonly CrossoverLap[], type: TyreType): Known<Ms> | undefined {
  for (const row of [...byLap].reverse()) if (row.medianMs[type].known) return row.medianMs[type];
  return undefined;
}

/**
 * The first rival lap (completion order) on a type other than `ourType` whose sector beats our car's same sector on our
 * green lap of `ourType` of the same lap number (B9: our laps on an earlier type are not compared).
 */
function firstFasterOf(car: CarId, ourType: TyreType, green: readonly TypedLap[]): Known<FirstFaster> {
  const ours = new Map<number, Lap>();
  for (const { lap, type } of green) if (lap.carId === car && type === ourType) ours.set(lap.lapNumber, lap);
  for (const { lap, type } of green) {
    if (lap.carId === car || type === ourType) continue;
    const our = ours.get(lap.lapNumber);
    if (our === undefined) continue;
    for (const [sector, i] of SECTORS) {
      if (lap.sectorTimesMs[i] < our.sectorTimesMs[i]) {
        return known({ carId: lap.carId, type, sector, lapNumber: lap.lapNumber }, Math.max(lap.completedAt, our.completedAt));
      }
    }
  }
  return unknown('notApplicable');
}

/** Our car's crossover from the session's green laps and medians. */
function crossoverOf(view: EngineView, car: CarId, green: readonly TypedLap[], byLap: CrossoverLap[], line110: number): Crossover {
  const ownLaps = currentLaps(view.history.laps as LapRecord[])
    .filter((l) => l.carId === car)
    .sort(byCompletion);
  let ourType: Known<TyreType> = unknown('insufficientData');
  for (const lap of ownLaps.reverse()) {
    const type = tyreTypeOf(lap.actualCompound);
    if (type !== undefined) {
      ourType = known(type, lap.completedAt);
      break;
    }
  }

  const dryRefMs = dryRefOf(byLap);
  const line110Ms: Known<Ms> = dryRefMs.known ? known(Math.round(dryRefMs.value * line110), dryRefMs.at) : dryRefMs;

  let latest: Lap | undefined;
  for (const { lap } of green) if (lap.carId === car) latest = lap;
  const ourPct: Known<number> = !dryRefMs.known
    ? dryRefMs
    : latest === undefined
      ? unknown('insufficientData')
      : known((latest.lapTimeMs / dryRefMs.value) * 100, Math.max(latest.completedAt, dryRefMs.at));

  const firstFaster: Known<FirstFaster> = ourType.known ? firstFasterOf(car, ourType.value, green) : unknown('insufficientData');

  return { ourType, byLap, dryRefMs, line110Ms, ourPct, firstFaster, payback: paybackOf(view, ourType, latest, byLap) };
}

/** Green pit loss over (our latest green lap − the fastest other type's latest median); `notApplicable` if none is faster. */
function paybackOf(view: EngineView, ourType: Known<TyreType>, latest: Lap | undefined, byLap: readonly CrossoverLap[]): Crossover['payback'] {
  if (!ourType.known || latest === undefined) return unknown('insufficientData');
  let fastest: Known<Ms> | undefined;
  for (const type of TYPES) {
    if (type === ourType.value) continue;
    const m = latestMedianOf(byLap, type);
    if (m?.known && (fastest === undefined || (fastest.known && m.value < fastest.value))) fastest = m;
  }
  if (fastest === undefined || !fastest.known || fastest.value >= latest.lapTimeMs) return unknown('notApplicable');
  const losses = view.outputs.get(PIT_LOSS) as PitLosses | undefined;
  if (losses === undefined) return unknown('insufficientData');
  const { lossMs, source } = losses.conditions.green;
  if (!lossMs.known) return lossMs;
  const at = Math.max(lossMs.at, latest.completedAt, fastest.at);
  return known({ laps: lossMs.value / (latest.lapTimeMs - fastest.value), lossSource: source }, at);
}

export const crossoverCalculator: QuickCalculator<CrossoverOutput> = {
  id: CROSSOVER,
  kind: 'quick',
  reads: ['laps', 'identity', { calculator: PIT_LOSS }, 'spans:weekend-phase', 'spans:session-phase-race'],
  cadence: 'frame',
  compute: (view): CrossoverOutput => {
    // the session's row (the weekend phase), over the grid's (C14: a pending phase reads as the race)
    const session: CrossoverEffect = Object.assign(
      {},
      phaseRow('pending'),
      ...behaviourFor({ 'weekend-phase': CROSSOVER_BEHAVIOUR['weekend-phase'] ?? {} }, view),
    );
    const cars = ourCars(view.live);
    const out: CrossoverOutput = {};
    if (session.notApplicable === true) {
      for (const car of cars) out[car] = NOT_APPLICABLE;
      return out;
    }
    const { minCars, line110 } = CROSSOVER_CONFIG.read(view);
    const green = greenLaps(view, { isRace: true, ...LAP_CLASSES_CONFIG.read(view) });
    const byLap = byLapOf(green, minCars);
    for (const car of cars) out[car] = crossoverOf(view, car, green, byLap, line110);
    return out;
  },
};
