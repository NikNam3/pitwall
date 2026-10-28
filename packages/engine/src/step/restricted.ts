import { known, unknown, type CarState, type Known, type SessionTime } from '@pitwall/domain';

/**
 * The value as `Known` since `at`, or `unknown('restricted')` when the car's driver withholds their telemetry
 * (spec 6.2, "Restricted data"): the game sends 0 for those fields, which must not be read as a value.
 */
export const knownUnlessRestricted = <T>(car: CarState, value: T, at: SessionTime): Known<T> =>
  car.identity.visibility === 'restricted' ? unknown('restricted') : known(value, at);
