import { pick } from '../pick.ts';
import { knownUnlessRestricted } from './restricted.ts';
import { maskForRealism } from './realism.ts';
import { visibilityIn } from './identity.ts';
import type { StateUpdate } from './types.ts';

// Code tables from the struct comments of Car Status.
const FUEL_MIX = ['lean', 'standard', 'rich', 'max'] as const;
const ERS_DEPLOY_MODE = ['none', 'medium', 'hotlap', 'overtake'] as const;

/** Fuel, ERS and power unit output from Car Status (kg, J, W as sent). Restricted for a human who withholds their telemetry. */
export const energyUpdate: StateUpdate = { id: 'energy', apply: (frame, live, _signals, out) => {
  const { status } = frame;
  if (!status) return maskForRealism(live, 'energy');
  const at = frame.sessionTime;
  for (const car of live.cars) {
    const s = status.carStatusData[car.id];
    if (!s) continue;
    car.updatedAt.status = at;
    car.energy = {
      fuel: knownUnlessRestricted(
        visibilityIn(frame, car),
        { kg: s.fuelInTank, capacityKg: s.fuelCapacity, remainingLaps: s.fuelRemainingLaps, mix: pick(FUEL_MIX, s.fuelMix) },
        at,
      ),
      ers: knownUnlessRestricted(
        visibilityIn(frame, car),
        {
          storeJ: s.ersStoreEnergy,
          mode: pick(ERS_DEPLOY_MODE, s.ersDeployMode),
          harvestedMgukJ: s.ersHarvestedThisLapMguk,
          harvestedMguhJ: s.ersHarvestedThisLapMguh,
          deployedJ: s.ersDeployedThisLap,
        },
        at,
      ),
      power: knownUnlessRestricted(visibilityIn(frame, car), { iceW: s.enginePowerIce, mgukW: s.enginePowerMguk }, at),
    };
  }
  out.changed.add('energy');
  maskForRealism(live, 'energy');
} };
