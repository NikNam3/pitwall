import { known, unknown, type CarState, type Known, type SessionTime } from '@pitwall/domain';
import { CORNER_NAMES } from './corners.ts';

/**
 * The value as `Known` since `at`, or `unknown('restricted')` when the car's driver withholds their telemetry
 * (spec 6.2, "Restricted data"): the game sends 0 for those fields, which must not be read as a value.
 */
export const knownUnlessRestricted = <T>(car: CarState, value: T, at: SessionTime): Known<T> =>
  car.identity.visibility === 'restricted' ? unknown('restricted') : known(value, at);

/**
 * Sets every field spec 6.2 restricts to `unknown('restricted')`: the one list of them. Used when a car turns
 * restricted, so values stored while it still looked public (packets before Participants) do not survive as known 0.
 */
export const withholdRestricted = (car: CarState): void => {
  const restricted = unknown('restricted');
  car.energy.fuel = restricted;
  car.energy.ers = restricted;
  car.energy.power = restricted;
  car.condition.bodywork = restricted;
  car.condition.powerUnit = restricted;
  car.condition.drsFault = restricted;
  for (const corner of CORNER_NAMES) {
    car.condition.brakes[corner].damagePct = restricted;
    car.tyres.corners[corner].wearPct = restricted;
    car.tyres.corners[corner].damagePct = restricted;
  }
  car.tyres.sets = restricted;
};
