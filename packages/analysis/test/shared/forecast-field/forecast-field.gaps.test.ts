// The present order and gaps of a live build are `gaps`' (SP4.3c Task 13, R34 deferred from Task 6; spec §5.3 O10;
// C43). A live build is `buildStartingPoint` with `gaps`' output among its outputs (its caller, the strategy input,
// passes it); an as-of build has none and keeps forecast-field's extrapolation from the crossings.
//  - The order of the running cars and each car's gap at the last crossing both cars passed are `gaps`' (`intervals`,
//    `toLeaderMs`).
//  - Carrying that gap forward to the view's time stays forecast-field's (a forecast step): the car moved on from its
//    newest crossing at its newest lap's pace (`distanceAsOf`), and the gap grows by the time since that crossing less
//    the time the leader took over the same stretch (`leaderTimes`, `leaderTimeAt`).
//  - A retired car, which `gaps` does not list, is placed last by forecast-field as today.
import { carId, currentLaps, known, type CarId, type Interval, type LapRecord, type MiniSectorCrossing, type OpenSpan, type StartingPoint } from '@pitwall/domain';
import { asOfNow, runAsOf, type AsOfView, type CalculatorId } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { GAPS, type GapsOutput } from '../../../src/gaps/index.ts';
import { buildStartingPoint, FORECAST_UNITS } from '../../../src/shared/forecast-field/index.ts';
import { distanceAsOf, distanceOf, leaderTimeAt, leaderTimes, newestCrossings } from '../../../src/shared/forecast-field/placement.ts';
import { gapsOf } from '../../gaps/output.ts';
import { generated, materialised, PARAMS } from './support.ts';

const g = generated();
/** A frame inside lap 12 (after the stops, every car paced), not at a line crossing: every car has moved on since its newest crossing. */
const FRAME = g.race.framesOfLap(12)[7]!;

/** The value of a starting point the test needs known. */
function valueOf(sp: ReturnType<typeof buildStartingPoint>, what: string): StartingPoint {
  if (!sp.known) throw new Error(`${what}: the starting point is unknown (${sp.reason})`);
  return sp.value;
}

/** The live build at `FRAME` on `view` with `gaps` among the outputs. */
function liveBuild(view: AsOfView, gaps: GapsOutput): StartingPoint {
  const outputs = new Map<CalculatorId, unknown>([...runAsOf(FORECAST_UNITS, view), [GAPS, gaps]]);
  return valueOf(buildStartingPoint(view, outputs), 'live build');
}

/** A known gap of `gaps`' (the test's precondition). */
function gapOf(i: Interval): number {
  if (!i.toLeaderMs.known) throw new Error(`car ${i.carId}: gaps has no gap to the leader (${i.toLeaderMs.reason})`);
  return i.toLeaderMs.value;
}

/**
 * The forward carry of each car's gap from its newest crossing to the view's time: the time since its newest crossing
 * less the leader's time between the car's newest crossing and where the car is now (its newest lap's pace).
 */
function carries(view: AsOfView, leader: CarId): Map<CarId, number> {
  const crossings = view.history.crossings as readonly MiniSectorCrossing[];
  const newest = newestCrossings(crossings, PARAMS.cars);
  // each car's newest lap's time (its current record, C25)
  const newestLap = new Map<CarId, LapRecord>();
  for (const lap of currentLaps(view.history.laps as readonly LapRecord[])) {
    const own = newestLap.get(lap.carId);
    if (own === undefined || lap.lapNumber > own.lapNumber) newestLap.set(lap.carId, lap);
  }
  const lapMs = new Map([...newestLap].map(([car, lap]) => [car, lap.lapTimeMs]));
  const leaderNewest = newest[leader]!;
  const times = leaderTimes(crossings, leader, 0, distanceOf(leaderNewest));
  const out = new Map<CarId, number>();
  for (let k = 0; k < PARAMS.cars; k++) {
    const c = newest[k]!;
    const now = distanceAsOf(c, view.at, lapMs.get(carId(k))!, false);
    out.set(carId(k), view.at - leaderTimeAt(times, now)! - (c.at - leaderTimeAt(times, distanceOf(c))!));
  }
  return out;
}

/** `gaps`' output with the intervals at `a` and `b` swapped and every follower's gap `shiftMs` longer. */
function reordered(out: GapsOutput, a: number, b: number, shiftMs: number): GapsOutput {
  const intervals = [...out.intervals];
  [intervals[a], intervals[b]] = [intervals[b]!, intervals[a]!];
  return {
    ...out,
    intervals: intervals.map((i, n) => (n === 0 ? i : { ...i, toLeaderMs: known(gapOf(i) + shiftMs, i.toLeaderMs.known ? i.toLeaderMs.at : 0) })),
  };
}

describe("a live build's order and gaps are gaps' (SP4.3c Task 13, R34)", () => {
  const now = g.viewAt(FRAME);
  const view = materialised(asOfNow(now));
  const gaps = gapsOf(now);

  it('precondition: gaps lists every car on the lead lap, each with a known gap', () => {
    expect(gaps.intervals.map((i) => i.carId).sort()).toEqual(Array.from({ length: PARAMS.cars }, (_, k) => k));
    for (const i of gaps.intervals) {
      expect(i.lapsDown, `car ${i.carId}`).toBe(0);
      gapOf(i);
    }
  });

  it("the order is gaps' order, and each gap gaps' gap plus forecast-field's forward carry", () => {
    // gaps' order and gaps changed (two cars swapped, every follower 1 s further back): the build follows them
    const out = reordered(gaps, 3, 4, 1_000);
    const sp = liveBuild(view, out);
    expect(Array.from(sp.order)).toEqual(out.intervals.map((i) => i.carId));
    const leader = out.intervals[0]!.carId;
    const carry = carries(view, leader);
    for (const i of out.intervals) {
      expect(sp.gapMs[i.carId]!, `car ${i.carId}`).toBeCloseTo(gapOf(i) + carry.get(i.carId)!, 0);
    }
  });

  it("gaps' own output as it is: the same rule", () => {
    const sp = liveBuild(view, gaps);
    expect(Array.from(sp.order)).toEqual(gaps.intervals.map((i) => i.carId));
    const carry = carries(view, gaps.intervals[0]!.carId);
    for (const i of gaps.intervals) expect(Math.abs(sp.gapMs[i.carId]! - (gapOf(i) + carry.get(i.carId)!)), `car ${i.carId}`).toBeLessThanOrEqual(1);
  });

  it('a retired car, not in gaps, is placed last; the running cars in gaps’ order before it', () => {
    const retiredCar = carId(5);
    const byMachine = Object.fromEntries(
      Object.entries(now.situation.byMachine).map(([machine, spans]) => [
        machine,
        machine !== 'car-status' ? spans : spans.map((s): OpenSpan => (s.carId === retiredCar ? { ...(s as OpenSpan), kind: 'retired', detail: { cause: known('mechanical', 0) } } : (s as OpenSpan))),
      ]),
    );
    const retiredView = materialised(asOfNow(now), { situation: { ...now.situation, byMachine } });
    const swapped = reordered(gaps, 1, 2, 0);
    const out: GapsOutput = { ...swapped, intervals: swapped.intervals.filter((i) => i.carId !== retiredCar), outOfRace: [retiredCar] };
    const sp = liveBuild(retiredView, out);
    expect(sp.retired[retiredCar]).toBe(1);
    expect(Array.from(sp.order)).toEqual([...out.intervals.map((i) => i.carId), retiredCar]);
  });
});
