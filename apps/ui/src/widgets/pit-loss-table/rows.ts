// The pit-loss table's rows (spec 6; C65): the topic's values formatted, nothing computed. The source's kind and every
// stop's use are the calculator's (C43).
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import type { CarId, EstimateSource, Ms, PitCondition, PitLosses, PitLossStop } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { ourCars } from '../../kit/car/our-cars.ts';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatCount, formatLapNumber, formatSeconds } from '../../kit/values/format.ts';

/** The order of the condition lines. */
const CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

const seconds = (ms: Ms): string => formatSeconds(ms, 1);

export type ConditionRow = { condition: PitCondition; loss: CellPart; stat: CellPart; n: string; source: EstimateSource };

/** One row per condition: green, VSC, SC. */
export function buildConditionRows(losses: PitLosses): ConditionRow[] {
  return CONDITIONS.map((condition) => {
    const e = losses.conditions[condition];
    return {
      condition,
      loss: knownPart(e.lossMs, seconds),
      stat: knownPart(e.stationaryMedianMs, seconds),
      n: formatCount(e.sessionStops),
      source: e.source,
    };
  });
}

export type StopRow = {
  carId: CarId;
  lap: string;
  /** The car code; empty with the reason when the field lacks the car. */
  code: CellPart;
  ours: boolean;
  condition: PitCondition;
  loss: CellPart;
  stat: string;
  use: PitLossStop['use'];
};

export type StopRowsInput = { losses: PitLosses; cars: CarOverview[]; session: SessionInfo };

/** This session's stops, newest first (the topic gives them in lap order). */
export function buildStopRows(input: StopRowsInput): StopRow[] {
  const ours = ourCars(input.session);
  return [...input.losses.stops].reverse().map((s) => ({
    carId: s.carId,
    lap: formatLapNumber(s.lap, 2),
    code: carCodeById(input.cars, s.carId),
    ours: ours.has(s.carId),
    condition: s.condition,
    loss: knownPart(s.lossMs, seconds),
    stat: seconds(s.stationaryMs),
    use: s.use,
  }));
}
