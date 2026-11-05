// The player's own-car data (`CarState.ownCar`, the player's car only, C8) as the band units read it: the setup's
// tyre pressures. Everything else of the setup is a fixed, plausible value no unit under test reads.
import { known, unknown, type CarSetup, type CarState, type Corners, type Known } from '@pitwall/domain';

/** A setup with the given cold tyre pressures (psi), per corner, or one value for all four. */
export function setupWith(psi: number | Corners<number>): CarSetup {
  const tyrePressurePsi = typeof psi === 'number' ? { fl: psi, fr: psi, rl: psi, rr: psi } : psi;
  return {
    frontWing: 25,
    rearWing: 20,
    diffOnThrottlePct: 50,
    diffOffThrottlePct: 50,
    frontCamber: -3,
    rearCamber: -1.5,
    frontToe: 0.05,
    rearToe: 0.2,
    frontSuspension: 20,
    rearSuspension: 10,
    frontAntiRollBar: 10,
    rearAntiRollBar: 10,
    frontRideHeight: 30,
    rearRideHeight: 60,
    brakePressurePct: 100,
    brakeBiasPct: 55,
    engineBrakingPct: 50,
    tyrePressurePsi,
    ballast: 6,
    fuelLoadKg: 50,
  };
}

/** `car` with own-car data whose setup is `setup` (default: not yet received), as step 1 fills it for the player's car. */
export function withOwnCar(car: CarState, setup: Known<CarSetup> = unknown('notReceived')): CarState {
  return { ...car, ownCar: { motionEx: unknown('notReceived'), setup, brakeBiasPct: known(55, 0) } };
}

/** `car` as the player's car with its setup received: the cold tyre pressures `psi`. */
export const withSetup = (car: CarState, psi: number | Corners<number>): CarState => withOwnCar(car, known(setupWith(psi), 0));
