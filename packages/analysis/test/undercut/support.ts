// Shared setup of the `undercut` tests (SP4.3b spec §9.1, plan 4.3b2 Task 7): `strategy`'s small generator race seen
// from our two cars (player 2, teammate 5), the view as the scheduler hands it to the job, plus `rejoin`'s output and
// the situation overrides the behaviour rows need.
//
// How these tests read `undercut` (the test agent's decisions, Task 7 report):
// - `UNDERCUT_JOB.prepare(view)` gives the job's input; `run(input, rng)` (`job.ts`) its output, per our car (`ourCars`)
//   a `Known<Undercut>`; a rival is absent. The input keeps `strategy: StrategyInput` (`strategyInputFrom`); `run`
//   reads each rival's stop and next compound from `input.strategy.start` (`hasStopAhead`, `rivalNextCompound`), so a
//   test may change the starting point's `stopLow` between `prepare` and `run`.
// - The job calls `scoreCalls` through `race-monte-carlo`'s index (as `strategy` calls `raceMonteCarlo`), once per our
//   car with every case; a test records each call and may replace its outcomes.
// - A rival's signed gap is `start.gapMs[rival] − start.gapMs[ours]` (positive = we ahead); its place is its index in
//   `start.order` plus one; our lap (`Undercut.lap`, the box-now stop lap) is `startLapOf(start, ours)`.
// - A case (rival `k`, N) is the candidate with `rival.carId === k` and `rival.gapAtLap === lap + N + 1`.
import { carId, known, type CarId, type PitCondition, type Rejoin, type RejoinAt } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import type { RejoinOutput } from '../../src/rejoin/index.ts';
import { RACE, viewAt, type ViewSpec } from '../strategy/support.ts';

export { NO_SETS_LEFT, OURS, PLAYER, RACE, TEAMMATE, json, once, viewAt, viewAtFrame, type ViewSpec } from '../strategy/support.ts';

/** The leader's lap of most views here: every rival still has its stop ahead (stops on laps 8 to 10), N = 1–3 fits. */
export const LAP = 3;

/** `rejoin`'s green rejoin position per our car in these views: places no simulated rejoin gives by chance. */
export const GREEN_REJOIN: Record<number, number> = { 2: 17, 5: 18 };

/** `rejoin`'s value of our car `car`: its green rejoin position `GREEN_REJOIN[car]`, SC and VSC one and two better. */
export function rejoinOf(car: CarId, at: number): Rejoin {
  const green = GREEN_REJOIN[car] ?? 15;
  const row = (condition: PitCondition, position: number): RejoinAt => ({
    condition,
    lossMs: known(20_000, at),
    lossSource: { kind: 'default', note: 'track file', sessionShare: 0, parts: 'default' },
    rejoinPosition: known(position, at),
    order: { known: false, reason: 'insufficientData' },
    mapPoint: { known: false, reason: 'notApplicable' },
  });
  return { carId: car, position: 3, conditions: { green: row('green', green), sc: row('sc', green - 2), vsc: row('vsc', green - 1) } };
}

export type UndercutViewSpec = ViewSpec & {
  /** `undercut`'s config section. */
  undercut?: Record<string, string | number | boolean>;
  /** `rejoin`'s output; default `rejoinOf` for each of our cars; `null`: absent. */
  rejoin?: RejoinOutput | null;
  /** The kind of the race's open session-phase span (default as recorded). */
  sessionPhase?: string;
  /** The kind of our car `car`'s open car-activity span. */
  activity?: { car: CarId; kind: string };
};

/** The view after the frame on the leader's lap `lap` as `strategy`'s support gives it, with `undercut`'s reads added. */
export function undercutView(lap: number = LAP, spec: UndercutViewSpec = {}): EngineView {
  const view = viewAt(RACE(), lap, spec);
  const at = view.live.sessionTime;
  const ours = [view.live.playerCar, view.live.teammateCar].filter((c): c is CarId => c !== undefined);
  const rejoin: RejoinOutput | null =
    spec.rejoin === undefined
      ? ({ cars: Object.fromEntries(ours.map((c) => [c, rejoinOf(c, at)])), ghost: {} } as unknown as RejoinOutput)
      : spec.rejoin;
  const byMachine = Object.fromEntries(
    Object.entries(view.situation.byMachine).map(([machine, spans]) => [
      machine,
      spans.map((s) => {
        if (machine === 'session-phase-race' && spec.sessionPhase !== undefined) return { ...s, kind: spec.sessionPhase };
        if (machine === 'car-activity-race' && spec.activity !== undefined && s.carId === spec.activity.car) return { ...s, kind: spec.activity.kind };
        return s;
      }),
    ]),
  );
  const outputs = new Map(view.outputs);
  if (rejoin !== null) outputs.set('rejoin', rejoin);
  return {
    ...view,
    situation: { ...view.situation, byMachine } as EngineView['situation'],
    config: { ...view.config, ...(spec.undercut === undefined ? {} : { undercut: spec.undercut }) },
    outputs,
  };
}

/** The signed gap of rival `k` to our car `car` on the starting point (positive = we ahead). */
export const signedGap = (start: { gapMs: Float64Array }, car: CarId, k: number): number => (start.gapMs[k] ?? 0) - (start.gapMs[car] ?? 0);

/**
 * The rivals the spec names for our car `car` (§9.1): the car directly ahead and directly behind within `rangeMs`, then
 * the next one each way within it, in place order; place = index in `start.order` + 1.
 */
export function expectedRivals(start: { order: Int8Array; gapMs: Float64Array; retired: Uint8Array }, car: CarId, rangeMs: number): { carId: CarId; side: 'ahead' | 'behind'; position: number; gapMs: number }[] {
  const order = [...start.order].filter((k) => start.retired[k] !== 1);
  const i = order.indexOf(car);
  const out: { carId: CarId; side: 'ahead' | 'behind'; position: number; gapMs: number }[] = [];
  const take = (j: number, side: 'ahead' | 'behind'): boolean => {
    const k = order[j];
    if (k === undefined) return false;
    const g = signedGap(start, car, k);
    if (Math.abs(g) > rangeMs) return false;
    out.push({ carId: carId(k), side, position: j + 1, gapMs: Math.abs(g) });
    return true;
  };
  if (take(i - 1, 'ahead')) take(i - 2, 'ahead');
  if (take(i + 1, 'behind')) take(i + 2, 'behind');
  return out.sort((a, b) => a.position - b.position);
}

/** The median range of `values` (lower and upper median). */
export function medianRange(values: ArrayLike<number>): [number, number] {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const n = sorted.length;
  return [sorted[Math.floor((n - 1) / 2)] ?? NaN, sorted[Math.floor(n / 2)] ?? NaN];
}

/** Mean and standard error of `values`. */
export function meanSe(values: ArrayLike<number>): { mean: number; se: number } {
  const xs = Array.from(values);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1);
  return { mean, se: Math.sqrt(v / xs.length) };
}
