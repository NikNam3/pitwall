// Shared setup of the `pit-sweep` tests (SP4.3b spec §9.2; plan 4.3b2 Task 8): `strategy`'s small generator race seen
// from our two cars (`../strategy/support.ts`), the view at a leader's lap as the scheduler hands it to the job, with
// `pit-window`'s and `rejoin`'s outputs set by the test (so the sets, `flag`, `stint.latest`, `windowCompound` and the
// green rejoin position are known), and how a run is read.
//
// How these tests read `pit-sweep` (the test agent's decisions, Task 8 report):
// - `PIT_SWEEP_JOB.prepare(view)` gives the job's input; `run(input, rng)` (`src/pit-sweep/job.ts`, the job's module)
//   its output, per our car a `PitSweepCar`.
// - The job calls the simulators through their units' indexes (`strategy-dp/index.ts`: `solveDp`, `bestWith`,
//   `dpResult`; `race-monte-carlo/index.ts`: `scoreCalls`, `paired`, `ties`), so the tests record every `solveDp` and
//   `scoreCalls` call with the real simulator running (`vi.mock` of those indexes, in each test file).
// - A compound's window (Task 18q) is its `pit-window` set's `windowLaps` (`from` its `earliest`, `to` `stint.latest`),
//   built here as `pit-window` builds it: unknown while `stint.latest` is, `notApplicable` for a set that does not reach
//   the flag or opens after `stint.latest`. Either way "the window unknown": every stop lap.
// - "now" for a car is its DP input's `fromLap` (`toDpInput`, the lap the DP plans from); `PitSweepCar.lap` is it and the
//   first row's `stopLap`; `PitSweepCar.position` is the car's race position at the trigger (`strategyInputFrom`'s).
// - A table's rows are in stop-lap order, one per candidate of that compound's `scoreCalls` call, in the candidates'
//   order; a stop lap whose `bestWith` is `null` has no candidate and no row.
// - The medians (`traffic`, a later row's `rejoinPosition`) are read as lying between the lower and upper middle values.
import { known, unknown, type CarId, type Known, type PitWindow, type PitWindowSet, type Rejoin, type RejoinAt, type VisualCompound } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import type { DpInput, DpSolution } from '../../src/strategy-dp/index.ts';
import type { CallInput, CallResult } from '../../src/race-monte-carlo/index.ts';
import { currentLapOf, OURS, viewAt, type ViewSpec } from '../strategy/support.ts';

export { json, once, OURS, PLAYER, RACE, SETS, TEAMMATE, TEST_CAP } from '../strategy/support.ts';

/** The cap per compound in these tests: small, so a run takes well under a second (the budget test runs the config's). */
export const SWEEP_CAP = 60;

/** What a test sets of `pit-window`'s output for each of our cars. */
export type WindowSpec = {
  /** The compounds of `sets` (the new sets, the compound rule applied); default soft, medium, hard. */
  compounds?: readonly VisualCompound[];
  /** `stint.latest` as an offset from the car's current lap; `null`: unknown. Default +5. */
  latestIn?: number | null;
  /** Each set's `earliest` as an offset from the car's current lap (its window's `from`). Default `latestIn − 2` (+3). */
  earliestIn?: number;
  /** Per compound an `earliest` offset over `earliestIn`. */
  earliestBy?: Partial<Record<VisualCompound, number>>;
  /** Compounds whose set does not reach the flag: `reaches` false, `windowLaps` `notApplicable`. */
  noWindow?: readonly VisualCompound[];
  /** Default `known('hard')`. */
  windowCompound?: Known<VisualCompound>;
};

export type SweepSpec = ViewSpec & {
  window?: WindowSpec;
  /** `rejoin`'s green rejoin position per our car; default 6. */
  greenRejoin?: Partial<Record<CarId, number>>;
  /** `pit-sweep`'s config section, over `{ maxScenarioPolicies: SWEEP_CAP }`. */
  sweepConfig?: Record<string, unknown>;
  /** Replace the open span of `machine` for `car` (or the session's, without `car`) by one of kind `kind`. */
  spans?: { machine: string; carId?: CarId; kind: string }[];
};

/** A `pit-window` set of `compound`: its window from `earliest` to `latest` as `pit-window` builds it. */
function windowSet(compound: VisualCompound, at: number, earliest: number, latest: Known<number>, reaches: boolean): PitWindowSet {
  const windowLaps: PitWindowSet['windowLaps'] = !latest.known
    ? latest
    : !reaches || earliest > latest.value
      ? unknown('notApplicable')
      : known({ from: earliest, to: latest.value }, at);
  return {
    compound,
    sameType: true,
    lifeLaps: known(20, at),
    earliest: known(earliest, at),
    lifeEnd: latest.known ? known(latest.value + 20, at) : latest,
    reaches: known(reaches, at),
    windowLaps,
    state: windowLaps.known ? known('open', at) : known('none', at),
  };
}

/** The window (stop laps) of `compound` for our car `car` on `view` by `spec`; `undefined` while it is unknown. */
export function windowOf(view: EngineView, car: CarId, compound: VisualCompound, spec: WindowSpec = {}): { from: number; to: number } | undefined {
  const set = pitWindowOf(view, car, spec).sets.find((s) => s.compound === compound);
  return set?.windowLaps.known ? set.windowLaps.value : undefined;
}

/** `pit-window`'s value for our car `car` on `view`: the flag is the race's lap count, the current lap the car's. */
export function pitWindowOf(view: EngineView, car: CarId, spec: WindowSpec = {}): PitWindow {
  const at = view.live.sessionTime;
  const currentLap = currentLapOf(view, car);
  const latestIn = spec.latestIn === undefined ? 5 : spec.latestIn;
  const latest = latestIn === null ? unknown('insufficientData') : known(currentLap + latestIn, at);
  return {
    carId: car,
    flag: view.live.session.totalLaps,
    currentLap,
    stint: { compound: 'medium', fromLap: 1, latest, stopNeeded: latest.known ? known(true, at) : unknown('insufficientData'), pastLimit: false },
    sets: (spec.compounds ?? ['soft', 'medium', 'hard']).map((c) => {
      const earliestIn = spec.earliestBy?.[c] ?? spec.earliestIn ?? (latestIn === null ? 3 : latestIn - 2);
      return windowSet(c, at, currentLap + earliestIn, latest, !(spec.noWindow ?? []).includes(c));
    }),
    window: latest.known ? known('open', at) : unknown('insufficientData'),
    windowCompound: spec.windowCompound ?? known('hard', at),
  };
}

const rejoinAt = (condition: RejoinAt['condition'], position: number, at: number): RejoinAt => ({
  condition,
  lossMs: known(condition === 'green' ? 21_000 : 12_000, at),
  lossSource: { kind: 'session', sessionShare: 1, parts: 'test' },
  rejoinPosition: known(position, at),
  order: unknown('insufficientData'),
  mapPoint: unknown('notApplicable'),
});

/** `rejoin`'s value for our car `car`: green rejoin position `green`. */
function rejoinOf(view: EngineView, car: CarId, green: number): Rejoin {
  const at = view.live.sessionTime;
  const position = view.live.cars.find((c) => c.id === car)?.timing.position ?? 0;
  return { carId: car, position, conditions: { green: rejoinAt('green', green, at), sc: rejoinAt('sc', green, at), vsc: rejoinAt('vsc', green, at) } };
}

/** The view after the frame on the leader's lap `lap`, with `pit-window`'s and `rejoin`'s outputs and `pit-sweep`'s config. */
export function sweepViewAt(race: BuilderRace, lap: number, spec: SweepSpec = {}): EngineView {
  return withSweep(viewAt(race, lap, spec), spec);
}

/** `view` (a `strategy` view, `../strategy/support.ts`) with `pit-sweep`'s outputs, config and the spans of `spec`. */
export function withSweep(view: EngineView, spec: SweepSpec = {}): EngineView {
  const ours = OURS.filter((car) => car === view.live.playerCar || car === view.live.teammateCar);
  const windows = Object.fromEntries(ours.map((car) => [car, known(pitWindowOf(view, car, spec.window), view.live.sessionTime)]));
  const rejoins = Object.fromEntries(ours.map((car) => [car, rejoinOf(view, car, spec.greenRejoin?.[car] ?? 6)]));
  const outputs = new Map(view.outputs);
  outputs.set('pit-window', windows);
  outputs.set('rejoin', { cars: rejoins, ghost: { gaps: undefined, losses: {}, ourCars: ours, ghostLaps: 3 } });
  let situation = view.situation;
  for (const s of spec.spans ?? []) {
    const spans = situation.byMachine[s.machine] ?? [];
    const replaced = spans.map((span) => (span.carId === s.carId ? { ...span, kind: s.kind } : span));
    situation = { ...situation, byMachine: { ...situation.byMachine, [s.machine]: replaced } } as EngineView['situation'];
  }
  return {
    ...view,
    situation,
    config: { ...view.config, 'pit-sweep': { maxScenarioPolicies: SWEEP_CAP, ...spec.sweepConfig } },
    outputs,
  } as EngineView;
}

/** The recorded simulator calls of a run (filled by each test file's `vi.mock`). */
export type Recorded = {
  dp: { input: DpInput; solution: DpSolution }[];
  calls: { input: CallInput; result: CallResult }[];
};

/** The lower and upper middle values of `xs`. */
export function middles(xs: ArrayLike<number>): [number, number] {
  const s = Array.from(xs).sort((a, b) => a - b);
  if (s.length === 0) return [Number.NaN, Number.NaN];
  return [s[Math.floor((s.length - 1) / 2)]!, s[Math.ceil((s.length - 1) / 2)]!];
}

/** The mean of `xs`. */
export const mean = (xs: ArrayLike<number>): number => Array.from(xs).reduce((a, b) => a + b, 0) / xs.length;

/** The Monte Carlo error of the mean of `xs` (its standard deviation over √n). */
export function seOf(xs: ArrayLike<number>): number {
  const m = mean(xs);
  const v = Array.from(xs).reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1);
  return Math.sqrt(v / xs.length);
}
