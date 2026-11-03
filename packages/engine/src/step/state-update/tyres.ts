import { actualCompoundFromCode, known, unknown, visualCompoundFromCode, type TyreSet } from '@pitwall/domain';
import type { TyreSetsPacket } from '@pitwall/protocol';
import { CORNER_NAMES, cornersOf } from '../corners.ts';
import { knownUnlessRestricted } from './restricted.ts';
import { surfaceOnly as surfaceOnlyIn } from './session.ts';
import { maskForRealism } from './realism.ts';
import { visibilityIn } from './identity.ts';
import type { StateUpdate } from './types.ts';

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
export const tyresUpdate: StateUpdate = { id: 'tyres', apply: (frame, live, _signals, out) => {
  const { status, telemetry, damage, tyreSets } = frame;
  const at = frame.sessionTime;
  if (status) {
    for (const car of live.cars) {
      const s = status.carStatusData[car.id];
      if (!s) continue;
      car.tyres.actualCompound = actualCompoundFromCode(s.actualTyreCompound);
      car.tyres.visualCompound = visualCompoundFromCode(s.visualTyreCompound);
      car.tyres.age = s.tyresAgeLaps;
    }
    out.changed.add('tyres');
  }
  if (telemetry) {
    // The frame's own Session packet, if any, else the setting as it was (C11: not the session module's write).
    const surfaceOnly = frame.session ? surfaceOnlyIn(frame.session) : live.session.settings.tyreTemperature === 'surfaceOnly';
    for (const car of live.cars) {
      const t = telemetry.carTelemetryData[car.id];
      if (!t) continue;
      const surface = cornersOf(t.tyresSurfaceTemperature);
      const carcass = cornersOf(t.tyresInnerTemperature);
      const pressure = cornersOf(t.tyresPressure);
      for (const corner of CORNER_NAMES) {
        const tyre = car.tyres.corners[corner];
        tyre.surfaceTempC = known(surface[corner], at);
        tyre.carcassTempC = surfaceOnly ? unknown('notApplicable') : known(carcass[corner], at);
        tyre.pressurePsi = known(pressure[corner], at);
      }
    }
    out.changed.add('tyres');
  }
  if (damage) {
    for (const car of live.cars) {
      const d = damage.carDamageData[car.id];
      if (!d) continue;
      const wear = cornersOf(d.tyresWear);
      const tyreDamage = cornersOf(d.tyresDamage);
      const blisters = cornersOf(d.tyreBlisters);
      for (const corner of CORNER_NAMES) {
        const tyre = car.tyres.corners[corner];
        tyre.wearPct = knownUnlessRestricted(visibilityIn(frame, car), wear[corner], at);
        tyre.damagePct = knownUnlessRestricted(visibilityIn(frame, car), tyreDamage[corner], at);
        tyre.blistersPct = known(blisters[corner], at);
      }
    }
    out.changed.add('tyres');
  }
  for (const packet of tyreSets) {
    const car = live.cars[packet.carIdx];
    if (!car) continue;
    car.updatedAt.tyreSets = at;
    car.tyres.sets = knownUnlessRestricted(
      visibilityIn(frame, car),
      { sets: packet.tyreSetData.map(tyreSetFrom), fittedIdx: packet.fittedIdx },
      at,
    );
  }
  if (tyreSets.length > 0) out.changed.add('tyres');
  maskForRealism(live, 'tyres');
} };
