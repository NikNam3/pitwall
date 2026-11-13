// Shared pieces of the `race-hazard` tests (SP4.3b spec §5.2, plan 4.3b1 Task 16): a hazard table, the track holding
// it, the expected per-lap chance by the ruling's rule (R22: lap 1 from `lapOne`, lap n ≥ 2 from the first `byFraction`
// bin with `upTo` ≥ (n − 0.5) / totalLaps), the conditioned duration pmf, and the unit computed both ways: its
// scheduled run (`compute`) and its as-of form (`raceHazardAsOf(asOfNow(view))`), each through the guarded view (C41).
import { known, type Known, type TrackData, type TrackDefault, type TrackHazard } from '@pitwall/domain';
import { asOfNow, type Calculator, type Dependency, type EngineView, type SchedulerInput } from '@pitwall/engine/readers';
import { expect } from 'vitest';
import { NO_DRIVERS, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { RACE_HAZARD, raceHazardAsOf, type RaceHazardOutput } from '../../src/race-hazard/index.ts';
import { CALCULATORS } from '../units.ts';

/** What the unit declares it reads (the brief's interfaces, C41): the session (totalLaps, the lobby setting), the race's session phase, the weekend phase, the laps. */
export const READS: readonly Dependency[] = ['session', 'spans:session-phase-race', 'spans:weekend-phase', 'laps'];

/** A hazard table whose bins and pmfs are easy to tell apart. */
export const HAZARD: TrackHazard = {
  races: 10,
  lapOne: { sc: 0.2, vsc: 0.03 },
  byFraction: [
    { upTo: 0.25, sc: 0.016, vsc: 0.006 },
    { upTo: 0.5, sc: 0.011, vsc: 0.008 },
    { upTo: 0.75, sc: 0.013, vsc: 0.007 },
    { upTo: 1, sc: 0.01, vsc: 0.005 },
  ],
  durationLaps: { sc: [0.1, 0.2, 0.4, 0.3], vsc: [0.5, 0.4, 0.1] },
};

/** A track (Zandvoort's file) whose hazard default is `hazard`. */
export const trackWith = (hazard: Known<TrackDefault<TrackHazard>>): EngineView['track'] => {
  const track: TrackData = zandvoortTrack();
  return known({ ...track, defaults: { ...track.defaults, hazard } }, 0);
};

/** The track of the tests: `HAZARD` as its default. */
export const TRACK: EngineView['track'] = trackWith(known({ value: HAZARD, source: 'test' }, 0));

/** The table's start chance of `kind` on lap `lap` of a `total`-lap race, by ruling R22, times `factor`. */
export function chanceOn(hazard: TrackHazard, lap: number, total: number, kind: 'sc' | 'vsc', factor = 1): number {
  if (lap === 1) return factor * hazard.lapOne[kind];
  const fraction = (lap - 0.5) / total;
  const bin = hazard.byFraction.find((b) => b.upTo >= fraction);
  if (bin === undefined) throw new Error(`chanceOn: no bin for fraction ${fraction}`);
  return factor * bin[kind];
}

/** The duration pmf `pmf` (index 0 = 1 lap) conditioned on `run` laps run: the pmf of the laps left (index 0 = it ends this lap). */
export function conditioned(pmf: readonly number[], run: number): number[] {
  const rest = pmf.slice(run);
  const total = rest.reduce((s, p) => s + p, 0);
  return rest.map((p) => p / total);
}

/** `actual` is the pmf `expected`, entry by entry within 1e-9, of the same length. */
export function expectPmf(actual: readonly number[] | undefined, expected: readonly number[], label = ''): void {
  expect(actual, label).toBeDefined();
  expect(actual!.length, `${label} length`).toBe(expected.length);
  expected.forEach((p, i) => expect(actual![i], `${label}[${i}]`).toBeCloseTo(p, 9));
}

/** The registered calculator (the package exports it for the feature to register, `src/index.ts`). */
export function raceHazardCalculator(): Calculator & { kind: 'quick'; compute(view: EngineView): unknown } {
  const calc = CALCULATORS.find((c) => c.id === RACE_HAZARD);
  if (calc === undefined) throw new Error('race-hazard: the package exports no calculator race-hazard (src/index.ts)');
  if (calc.kind !== 'quick') throw new Error('race-hazard: not a quick calculator');
  return calc;
}

/**
 * The unit's output on `view`: its as-of form over the current view (`asOfNow`) and its scheduled run (`compute`), both
 * through the guarded view of what it declares (C41), and both the same.
 */
export function hazardOf(view: EngineView): RaceHazardOutput {
  const g = guardedView(view, READS, { unit: RACE_HAZARD });
  const asOf = raceHazardAsOf(asOfNow(g));
  const calc = raceHazardCalculator();
  const scheduled = calc.compute(guardedView(view, calc.reads, { unit: RACE_HAZARD })) as RaceHazardOutput;
  expect(scheduled).toEqual(asOf);
  return scheduled;
}

/** The scheduler input of a view (C39): no priors, no profiles. */
export const inputOfView = ({ outputs: _outputs, priors: _priors, drivers: _drivers, ...rest }: EngineView): SchedulerInput => ({
  ...rest,
  priors: NO_PRIORS,
  drivers: NO_DRIVERS,
});

/** `view` with the lobby's SC setting `level` and `track`. */
export const withLobby = (view: EngineView, level: 'off' | 'reduced' | 'standard' | 'increased', track: EngineView['track'] = TRACK): EngineView => ({
  ...view,
  live: { ...view.live, session: { ...view.live.session, settings: { ...view.live.session.settings, safetyCar: level } } },
  track,
});
