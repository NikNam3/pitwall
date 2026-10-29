// Projection builder shared by the projected-lap gallery and its tests (test-phase file: the implementer does not edit it).
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { Known, Ms, Projection } from '@pitwall/domain';

const at = toSessionTime(1000);
export const ms = (n: number): Known<Ms> => known(n, at);

type Over = {
  onLap?: boolean;
  lapMs?: number;
  deltaMs?: number;
  position?: number;
  cutOff?: { position: number; timeMs: number; marginMs: number };
  finishMs?: number;
};

/** A projection of car 1; whatever `over` leaves out is `unknown('notApplicable')`. */
export function projection(over: Over = {}): Projection {
  const na = unknown('notApplicable');
  return {
    carId: carId(1),
    onLap: over.onLap ?? true,
    projectedLapMs: over.lapMs === undefined ? na : ms(over.lapMs),
    deltaToBestMs: over.deltaMs === undefined ? na : ms(over.deltaMs),
    projectedPosition: over.position === undefined ? na : known(over.position, at),
    cutOff: over.cutOff === undefined ? na : known(over.cutOff, at),
    finishMarginMs: over.finishMs === undefined ? na : ms(over.finishMs),
  };
}

/** The mockup's three cases. */
export const insideCutOff = projection({
  lapMs: 83_412, deltaMs: -118, position: 6, cutOff: { position: 15, timeMs: 84_006, marginMs: 594 }, finishMs: 38_200,
});
export const outsideCutOff = projection({
  lapMs: 84_311, deltaMs: 781, position: 17, cutOff: { position: 15, timeMs: 84_006, marginMs: -305 }, finishMs: 21_400,
});
export const outLap = projection({
  onLap: false, cutOff: { position: 10, timeMs: 83_870, marginMs: 0 }, finishMs: 3_900,
});
