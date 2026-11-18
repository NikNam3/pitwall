import type { TyreSet } from '@pitwall/domain';
import { actualCompoundFromCode, known, unknown, visualCompoundFromCode } from '../../util/hot-domain.ts';
import type { TyreSetsPacket } from '@pitwall/protocol';
import { CORNER_SLOTS } from '../corners.ts';
import { knownUnlessRestricted } from './restricted.ts';
import { surfaceOnly as surfaceOnlyIn } from './session.ts';
import { maskForRealism } from './realism.ts';
import { visibilityIn } from './identity.ts';
import type { StateUpdate } from './types.ts';

type TyreSetData = TyreSetsPacket['tyreSetData'][number];

/** The game's race session types: sprint, race, race 2. */
const RACE_SESSION_TYPES: readonly number[] = [15, 16, 17];

/**
 * The session type of the next race session after the current one in the weekend structure (signals read only to shape
 * a value, C8), the current session's position being its type's first occurrence (a session the structure does not list,
 * a short qualifying in a full weekend's structure: the structure's first race); `undefined` when there is none: the
 * structure unknown or zeros, the current session a race.
 */
const nextRaceType = (sessionType: number, structure: readonly number[]): number | undefined => {
  if (RACE_SESSION_TYPES.includes(sessionType)) return undefined;
  const at = structure.indexOf(sessionType);
  return structure.slice(at + 1).find((type) => RACE_SESSION_TYPES.includes(type));
};

const tyreSetFrom = (s: TyreSetData, raceType: number | undefined): TyreSet => ({
  actualCompound: actualCompoundFromCode(s.actualTyreCompound),
  visualCompound: visualCompoundFromCode(s.visualTyreCompound),
  wearPct: s.wear,
  available: s.available === 1,
  fitted: s.fitted === 1,
  recommendedSession: s.recommendedSession,
  // Only a reserved set carries the field (absent: false).
  ...(raceType !== undefined && s.recommendedSession === raceType ? { forNextRace: true } : {}),
  lifeSpanLaps: s.lifeSpan,
  usableLifeLaps: s.usableLife,
  lapDeltaMs: s.lapDeltaTime,
});

/** The packet's sets are `stored` field by field (`tyreSetFrom` of each would equal it), its fitted index too. */
const sameSets = (stored: { sets: readonly TyreSet[]; fittedIdx: number }, packet: TyreSetsPacket, raceType: number | undefined): boolean => {
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
      (t.forNextRace ?? false) === (raceType !== undefined && s.recommendedSession === raceType) &&
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
      const { tyresSurfaceTemperature: surface, tyresInnerTemperature: carcass, tyresPressure: pressure } = t;
      for (const [corner, wheel] of CORNER_SLOTS) {
        const tyre = car.tyres.corners[corner];
        tyre.surfaceTempC = known(surface[wheel] ?? 0, at);
        tyre.carcassTempC = surfaceOnly ? unknown('notApplicable') : known(carcass[wheel] ?? 0, at);
        tyre.pressurePsi = known(pressure[wheel] ?? 0, at);
      }
    }
    out.changed.add('tyres');
  }
  if (damage) {
    for (const car of live.cars) {
      const d = damage.carDamageData[car.id];
      if (!d) continue;
      const visibility = visibilityIn(frame, car, signals);
      for (const [corner, wheel] of CORNER_SLOTS) {
        const tyre = car.tyres.corners[corner];
        tyre.wearPct = knownUnlessRestricted(visibility, d.tyresWear[wheel] ?? 0, at);
        tyre.damagePct = knownUnlessRestricted(visibility, d.tyresDamage[wheel] ?? 0, at);
        tyre.blistersPct = known(d.tyreBlisters[wheel] ?? 0, at);
      }
    }
    out.changed.add('tyres');
  }
  const raceType = tyreSets.length > 0 ? nextRaceType(signals.session.sessionType, signals.session.weekendStructure) : undefined;
  for (const packet of tyreSets) {
    const car = live.cars[packet.carIdx];
    if (!car) continue;
    car.updatedAt.tyreSets = at;
    // The sets as they stand when the packet repeats them: equal to building them again, without the copies.
    const { sets } = car.tyres;
    const value = sets.known && sameSets(sets.value, packet, raceType)
      ? sets.value
      : { sets: packet.tyreSetData.map((s) => tyreSetFrom(s, raceType)), fittedIdx: packet.fittedIdx };
    car.tyres.sets = knownUnlessRestricted(visibilityIn(frame, car, signals), value, at);
  }
  if (tyreSets.length > 0) out.changed.add('tyres');
  maskForRealism(live, 'tyres');
} };
