import { pick } from './pick.ts';
import { knownUnlessRestricted } from './restricted.ts';
import type { SubStep } from './types.ts';

// Code tables from the struct comments of Car Status.
const FUEL_MIX = ['lean', 'standard', 'rich', 'max'] as const;
const ERS_DEPLOY_MODE = ['none', 'medium', 'hotlap', 'overtake'] as const;

/** Fuel, ERS and power unit output from Car Status (kg, J, W as sent). Restricted for a human who withholds their telemetry. */
export const applyEnergy: SubStep = (state, frame, out) => {
  const { status } = frame;
  if (!status) return;
  const at = frame.sessionTime;
  for (const car of state.cars) {
    const s = status.carStatusData[car.id];
    if (!s) continue;
    car.energy = {
      fuel: knownUnlessRestricted(
        car,
        { kg: s.fuelInTank, capacityKg: s.fuelCapacity, remainingLaps: s.fuelRemainingLaps, mix: pick(FUEL_MIX, s.fuelMix) },
        at,
      ),
      ers: knownUnlessRestricted(
        car,
        {
          storeJ: s.ersStoreEnergy,
          mode: pick(ERS_DEPLOY_MODE, s.ersDeployMode),
          harvestedMgukJ: s.ersHarvestedThisLapMguk,
          harvestedMguhJ: s.ersHarvestedThisLapMguh,
          deployedJ: s.ersDeployedThisLap,
        },
        at,
      ),
      power: knownUnlessRestricted(car, { iceW: s.enginePowerIce, mgukW: s.enginePowerMguk }, at),
    };
  }
  out.changed.add('status');
};
