import { actualCompoundFromCode, known, unknown, visualCompoundFromCode, type TyreSet } from '@pitwall/domain';
import type { TyreSetsPacket } from '@pitwall/protocol';
import { CORNER_NAMES, cornersOf } from './corners.ts';
import { knownUnlessRestricted } from './restricted.ts';
import type { SubStep } from './types.ts';

type TyreSetData = TyreSetsPacket['tyreSetData'][number];

const tyreSetFrom = (s: TyreSetData): TyreSet => ({
  actualCompound: actualCompoundFromCode(s.actualTyreCompound),
  visualCompound: visualCompoundFromCode(s.visualTyreCompound),
  wearPct: s.wear,
  available: s.available === 1,
  fitted: s.fitted === 1,
  recommendedSession: s.recommendedSession,
  lifeSpanLaps: s.lifeSpan,
  usableLifeLaps: s.usableLife,
  lapDeltaMs: s.lapDeltaTime,
});

/**
 * Compound and age from Car Status, temperatures and pressures from Car Telemetry, wear, damage and blisters
 * from Car Damage, and the tyre sets from Tyre Sets. Carcass temperature does not apply when the game only
 * simulates the surface.
 */
export const applyTyres: SubStep = (state, frame, out) => {
  const { status, telemetry, damage, tyreSets } = frame;
  const at = frame.sessionTime;
  if (status) {
    for (const car of state.cars) {
      const s = status.carStatusData[car.id];
      if (!s) continue;
      car.tyres.actualCompound = actualCompoundFromCode(s.actualTyreCompound);
      car.tyres.visualCompound = visualCompoundFromCode(s.visualTyreCompound);
      car.tyres.age = s.tyresAgeLaps;
    }
    out.changed.add('status');
  }
  if (telemetry) {
    const surfaceOnly = state.session.settings.tyreTemperature === 'surfaceOnly';
    for (const car of state.cars) {
      const t = telemetry.carTelemetryData[car.id];
      if (!t) continue;
      const surface = cornersOf(t.tyresSurfaceTemperature);
      const carcass = cornersOf(t.tyresInnerTemperature);
      const pressure = cornersOf(t.tyresPressure);
      for (const corner of CORNER_NAMES) {
        const tyre = car.tyres.corners[corner];
        tyre.surfaceTempC = surface[corner];
        tyre.carcassTempC = surfaceOnly ? unknown('notApplicable') : known(carcass[corner], at);
        tyre.pressurePsi = pressure[corner];
      }
    }
    out.changed.add('telemetry');
  }
  if (damage) {
    for (const car of state.cars) {
      const d = damage.carDamageData[car.id];
      if (!d) continue;
      const wear = cornersOf(d.tyresWear);
      const tyreDamage = cornersOf(d.tyresDamage);
      const blisters = cornersOf(d.tyreBlisters);
      for (const corner of CORNER_NAMES) {
        const tyre = car.tyres.corners[corner];
        tyre.wearPct = knownUnlessRestricted(car, wear[corner], at);
        tyre.damagePct = knownUnlessRestricted(car, tyreDamage[corner], at);
        tyre.blistersPct = blisters[corner];
      }
    }
    out.changed.add('damage');
  }
  for (const packet of tyreSets) {
    const car = state.cars[packet.carIdx];
    if (!car) continue;
    car.tyres.sets = knownUnlessRestricted(
      car,
      { sets: packet.tyreSetData.map(tyreSetFrom), fittedIdx: packet.fittedIdx },
      at,
    );
  }
  if (tyreSets.length > 0) out.changed.add('tyreSets');
};
