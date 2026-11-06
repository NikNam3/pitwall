// The `fuel` calculator: per car in the session, the fuel now, its burn over its rate laps, and the margin against the laps left.
import { known, unknown, type CarId, type Known, type Kg, type SessionTime } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import { SESSION_REMAINING, type SessionRemaining } from '../session-remaining/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { burnPerLapKg } from '../shared/fuel-burn.ts';
import { carLaps } from '../shared/stint-laps.ts';
import { FUEL_BEHAVIOUR, type FuelEffect } from './behaviour.ts';
import { FUEL, type FuelOutput, type FuelState } from './index.ts';

const fuelState = (view: EngineView, id: CarId, lapsLeft: Known<number>, effect: FuelEffect): FuelState => {
  const { live } = view;
  const car = live.cars[id];
  const fuel = car?.energy.fuel;
  const now: SessionTime = live.sessionTime;
  if (fuel === undefined || !fuel.known) {
    const reason = fuel === undefined ? unknown('notReceived') : unknown(fuel.reason);
    return {
      kg: reason,
      burnKgPerLap: reason,
      lapsOfFuel: reason,
      lapsLeft,
      marginLaps: reason,
      saveTargetKgPerLap: reason,
      gameRemainingLaps: reason,
      mix: reason,
    };
  }
  const { kg, remainingLaps, mix } = fuel.value;
  const base = { kg: known(kg, fuel.at), lapsLeft, gameRemainingLaps: known(remainingLaps, fuel.at), mix: known(mix, fuel.at) };

  const na = unknown('notApplicable');
  if (effect.judged !== true) return { ...base, burnKgPerLap: na, lapsOfFuel: na, marginLaps: na, saveTargetKgPerLap: na };
  // the burn over the car's rate laps (`burnPerLapKg`, shared with `degradation`, C43)
  const burn = burnPerLapKg(carLaps(view.history, id), { lapClasses: LAP_CLASSES_CONFIG.read(view), rate: PER_LAP_RATE_CONFIG.read(view) });
  if (!burn.known) return { ...base, burnKgPerLap: burn, lapsOfFuel: burn, marginLaps: burn, saveTargetKgPerLap: burn };

  if (burn.value <= 0) return { ...base, burnKgPerLap: burn, lapsOfFuel: na, marginLaps: lapsLeft.known ? na : lapsLeft, saveTargetKgPerLap: lapsLeft.known ? na : lapsLeft };
  const laps = kg / burn.value;
  const lapsOfFuel = known(laps, now);
  if (!lapsLeft.known) return { ...base, burnKgPerLap: burn, lapsOfFuel, marginLaps: lapsLeft, saveTargetKgPerLap: lapsLeft };
  const margin = laps - lapsLeft.value;
  return {
    ...base,
    burnKgPerLap: burn,
    lapsOfFuel,
    marginLaps: known(margin, now),
    saveTargetKgPerLap: margin < 0 ? known((burn.value - kg / lapsLeft.value) as Kg, now) : na,
  };
};

/**
 * Per car in the session: `fuel.car`, by its rows (`FUEL_BEHAVIOUR`). A pending weekend phase has no span yet and reads
 * as the race's grid (C14): its row is the race's.
 */
export const fuelCalculator: QuickCalculator<FuelOutput> = {
  id: FUEL,
  kind: 'quick',
  reads: ['laps', 'energy', CAR_STATUS_READS, 'spans:weekend-phase', { calculator: SESSION_REMAINING }],
  cadence: { hz: 4 },
  compute(view): FuelOutput {
    const remaining = view.outputs.get(SESSION_REMAINING) as SessionRemaining | undefined;
    const lapsLeft = remaining?.lapsLeft ?? unknown('notReceived');
    const grid = FUEL_BEHAVIOUR['weekend-phase']?.race;
    const out: FuelOutput = {};
    for (const car of view.live.cars) {
      const effect: FuelEffect = Object.assign({}, grid, ...behaviourFor(FUEL_BEHAVIOUR, view, car.id));
      if (effect.inSession === true) out[car.id as CarId] = fuelState(view, car.id, lapsLeft, effect);
    }
    return out;
  },
};
