import type { TyreSet } from '@pitwall/domain';
import { actualCompoundFromCode, known, unknown, visualCompoundFromCode } from '../../util/hot-domain.ts';
import type { TyreSetsPacket } from '@pitwall/protocol';
import { CORNER_NAMES, cornerOf } from '../corners.ts';
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

/** The packet's sets are `stored` field by field (`tyreSetFrom` of each would equal it), its fitted index too. */
const sameSets = (stored: { sets: readonly TyreSet[]; fittedIdx: number }, packet: TyreSetsPacket): boolean => {
  if (stored.fittedIdx !== packet.fittedIdx || stored.sets.length !== packet.tyreSetData.length) return false;
  for (let i = 0; i < packet.tyreSetData.length; i++) {
    const s = packet.tyreSetData[i] as TyreSetData;
    const t = stored.sets[i] as TyreSet;
    const same =
      t.actualCompound === actualCompoundFromCode(s.actualTyreCompound) &&
      t.visualCompound === visualCompoundFromCode(s.visualTyreCompound) &&
      t.wearPct === s.wear &&
      t.available === (s.available === 1) &&
      t.fitted === (s.fitted === 1) &&
      t.recommendedSession === s.recommendedSession &&
      t.lifeSpanLaps === s.lifeSpan &&
      t.usableLifeLaps === s.usableLife &&
      t.lapDeltaMs === s.lapDeltaTime;
    if (!same) return false;
  }
  return true;
};

/**
 * Compound and age from Car Status, temperatures and pressures from Car Telemetry, wear, damage and blisters
 * from Car Damage, and the tyre sets from Tyre Sets. Carcass temperature does not apply when the game only
 * simulates the surface.
 */
export const tyresUpdate: StateUpdate = { id: 'tyres', apply: (frame, live, signals, out) => {
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
      for (const corner of CORNER_NAMES) {
        const tyre = car.tyres.corners[corner];
        tyre.surfaceTempC = known(cornerOf(t.tyresSurfaceTemperature, corner), at);
        tyre.carcassTempC = surfaceOnly ? unknown('notApplicable') : known(cornerOf(t.tyresInnerTemperature, corner), at);
        tyre.pressurePsi = known(cornerOf(t.tyresPressure, corner), at);
      }
    }
    out.changed.add('tyres');
  }
  if (damage) {
    for (const car of live.cars) {
      const d = damage.carDamageData[car.id];
      if (!d) continue;
      const visibility = visibilityIn(frame, car, signals);
      for (const corner of CORNER_NAMES) {
        const tyre = car.tyres.corners[corner];
        tyre.wearPct = knownUnlessRestricted(visibility, cornerOf(d.tyresWear, corner), at);
        tyre.damagePct = knownUnlessRestricted(visibility, cornerOf(d.tyresDamage, corner), at);
        tyre.blistersPct = known(cornerOf(d.tyreBlisters, corner), at);
      }
    }
    out.changed.add('tyres');
  }
  for (const packet of tyreSets) {
    const car = live.cars[packet.carIdx];
    if (!car) continue;
    car.updatedAt.tyreSets = at;
    // The sets as they stand when the packet repeats them: equal to building them again, without the copies.
    const { sets } = car.tyres;
    const value = sets.known && sameSets(sets.value, packet) ? sets.value : { sets: packet.tyreSetData.map(tyreSetFrom), fittedIdx: packet.fittedIdx };
    car.tyres.sets = knownUnlessRestricted(visibilityIn(frame, car, signals), value, at);
  }
  if (tyreSets.length > 0) out.changed.add('tyres');
  maskForRealism(live, 'tyres');
} };
