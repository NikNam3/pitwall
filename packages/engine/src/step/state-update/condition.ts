import { known } from '@pitwall/domain';
import { CORNER_NAMES, cornersOf } from '../corners.ts';
import { knownUnlessRestricted } from './restricted.ts';
import { maskForRealism } from './realism.ts';
import { visibilityIn } from './identity.ts';
import type { StateUpdate } from './types.ts';

/** Damage, wear and faults from Car Damage; brake and engine temperatures from Car Telemetry. */
export const conditionUpdate: StateUpdate = { id: 'condition', apply: (frame, live, signals, out) => {
  const { damage, telemetry } = frame;
  const at = frame.sessionTime;
  if (damage) {
    for (const car of live.cars) {
      const d = damage.carDamageData[car.id];
      if (!d) continue;
      car.updatedAt.damage = at;
      const { condition } = car;
      condition.bodywork = knownUnlessRestricted(
        visibilityIn(frame, car, signals),
        {
          frontLeftWingPct: d.frontLeftWingDamage,
          frontRightWingPct: d.frontRightWingDamage,
          rearWingPct: d.rearWingDamage,
          floorPct: d.floorDamage,
          diffuserPct: d.diffuserDamage,
          sidepodPct: d.sidepodDamage,
        },
        at,
      );
      condition.powerUnit = knownUnlessRestricted(
        visibilityIn(frame, car, signals),
        {
          engineDamagePct: d.engineDamage,
          gearboxDamagePct: d.gearBoxDamage,
          mguhWearPct: d.engineMguhWear,
          esWearPct: d.engineEsWear,
          ceWearPct: d.engineCeWear,
          iceWearPct: d.engineIceWear,
          mgukWearPct: d.engineMgukWear,
          tcWearPct: d.engineTcWear,
        },
        at,
      );
      condition.drsFault = knownUnlessRestricted(visibilityIn(frame, car, signals), d.drsFault === 1, at);
      condition.ersFault = d.ersFault === 1;
      condition.engineBlown = d.engineBlown === 1;
      condition.engineSeized = d.engineSeized === 1;
      const brakeDamage = cornersOf(d.brakesDamage);
      for (const corner of CORNER_NAMES) {
        condition.brakes[corner].damagePct = knownUnlessRestricted(visibilityIn(frame, car, signals), brakeDamage[corner], at);
      }
    }
    out.changed.add('condition');
  }
  if (telemetry) {
    for (const car of live.cars) {
      const t = telemetry.carTelemetryData[car.id];
      if (!t) continue;
      const brakeTemp = cornersOf(t.brakesTemperature);
      for (const corner of CORNER_NAMES) car.condition.brakes[corner].tempC = known(brakeTemp[corner], at);
      car.condition.engineTempC = known(t.engineTemperature, at);
    }
    out.changed.add('condition');
  }
  maskForRealism(live, 'condition');
} };
