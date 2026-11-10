import { known } from '../../util/hot-domain.ts';
import { CORNER_NAMES, cornerOf } from '../corners.ts';
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
      const visibility = visibilityIn(frame, car, signals);
      condition.bodywork = knownUnlessRestricted(
        visibility,
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
        visibility,
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
      condition.drsFault = knownUnlessRestricted(visibility, d.drsFault === 1, at);
      condition.ersFault = d.ersFault === 1;
      condition.engineBlown = d.engineBlown === 1;
      condition.engineSeized = d.engineSeized === 1;
      for (const corner of CORNER_NAMES) {
        condition.brakes[corner].damagePct = knownUnlessRestricted(visibility, cornerOf(d.brakesDamage, corner), at);
      }
    }
    out.changed.add('condition');
  }
  if (telemetry) {
    for (const car of live.cars) {
      const t = telemetry.carTelemetryData[car.id];
      if (!t) continue;
      for (const corner of CORNER_NAMES) car.condition.brakes[corner].tempC = known(cornerOf(t.brakesTemperature, corner), at);
      car.condition.engineTempC = known(t.engineTemperature, at);
    }
    out.changed.add('condition');
  }
  maskForRealism(live, 'condition');
} };
