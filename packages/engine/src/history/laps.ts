import { known, unknown, type CarState, type Kg, type Known, type LapRecord, type SessionTime } from '@pitwall/domain';
import type { SessionHistoryPacket } from '@pitwall/protocol';
import type { Frame } from '../frame/frame.ts';
import type { EngineState, LapCursor } from '../state/engine-state.ts';
import type { LapCorrection, StepOutput, SubStep } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';

// Bits of `lapValidBitFlags`.
const LAP_VALID = 0x01;
const SECTOR_VALID = [0x02, 0x04, 0x08] as const;

const fuelAt = (car: CarState, at: SessionTime): Known<Kg> =>
  car.energy.fuel.known ? known(car.energy.fuel.value.kg, at) : unknown(car.energy.fuel.reason);

const openCursor = (car: CarState, at: SessionTime): LapCursor => {
  const { timing, tyres } = car;
  return {
    lap: timing.lap,
    startedAt: at,
    fuelAtStartKg: fuelAt(car, at),
    tyreAgeAtStart: tyres.age,
    scMs: 0,
    vscMs: 0,
    pitted: false,
    sector1Ms: timing.sector1TimeMs,
    sector2Ms: timing.sector2TimeMs,
    invalid: timing.currentLapInvalid,
    lastSeenAt: at,
    trackedMs: 0,
    actualCompound: tyres.actualCompound,
    visualCompound: tyres.visualCompound,
    outLap: timing.pitStatus !== 'none' || timing.driverStatus === 'outLap',
  };
};

/** Adds the time since the last frame to the lap, split by the safety car status of this frame. */
const addElapsed = (state: EngineState, cursor: LapCursor, at: SessionTime): void => {
  const dt = Math.max(0, at - cursor.lastSeenAt);
  cursor.trackedMs += dt;
  if (state.session.flag === 'sc') cursor.scMs += dt;
  if (state.session.flag === 'vsc') cursor.vscMs += dt;
  cursor.lastSeenAt = at;
};

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

/** The lap just completed, with the values LapData can give: sector 3 is what is left of the lap time. */
const provisionalLap = (state: EngineState, car: CarState, cursor: LapCursor, at: SessionTime): LapRecord => {
  const { timing } = car;
  const lapNumber = timing.lap - 1;
  const lapTimeMs = timing.lastLapTimeMs;
  const hasSectors = cursor.lap === lapNumber && cursor.sector1Ms > 0 && cursor.sector2Ms > 0;
  const [s1, s2] = hasSectors ? [cursor.sector1Ms, cursor.sector2Ms] : [0, 0];
  const valid = !cursor.invalid;
  return {
    carId: car.id,
    lapNumber,
    lapTimeMs,
    sectorTimesMs: hasSectors ? [s1, s2, lapTimeMs - s1 - s2] : [0, 0, 0],
    valid: { lap: valid, sectors: [valid, valid, valid] },
    actualCompound: cursor.actualCompound,
    visualCompound: cursor.visualCompound,
    tyreAgeAtStart: cursor.tyreAgeAtStart,
    fuelAtStartKg: cursor.fuelAtStartKg,
    fuelAtEndKg: fuelAt(car, at),
    scShare: share(cursor.scMs, cursor.trackedMs),
    vscShare: share(cursor.vscMs, cursor.trackedMs),
    inLap: cursor.pitted,
    outLap: cursor.outLap,
    positionAtEnd: timing.position,
    status: 'provisional',
    completedAt: at,
  };
};

const trackLap = (state: EngineState, car: CarState, at: SessionTime): void => {
  const { timing } = car;
  const cursor = state.open.laps[car.id];
  // The first LapData of a car, or a lap number that went down: start over without emitting.
  if (!cursor || timing.lap < cursor.lap) {
    state.open.laps[car.id] = openCursor(car, at);
    return;
  }
  addElapsed(state, cursor, at);
  if (timing.lap === cursor.lap) {
    // The game resets the sectors at the line, so the last non-zero value is the lap's.
    if (timing.sector1TimeMs > 0) cursor.sector1Ms = timing.sector1TimeMs;
    if (timing.sector2TimeMs > 0) cursor.sector2Ms = timing.sector2TimeMs;
    cursor.invalid ||= timing.currentLapInvalid;
    return;
  }
  const record = provisionalLap(state, car, cursor, at);
  const indexOfLap = state.open.lapIndex[car.id];
  if (indexOfLap) indexOfLap[record.lapNumber] = { provisional: state.history.laps.length, confirmed: false };
  state.history.laps.push(record);
  state.open.laps[car.id] = openCursor(car, at);
};

const corrections = (provisional: LapRecord, confirmed: LapRecord): LapCorrection[] => {
  const { carId, lapNumber } = provisional;
  const pairs = [
    ['lapTimeMs', provisional.lapTimeMs, confirmed.lapTimeMs],
    ['sector1Ms', provisional.sectorTimesMs[0], confirmed.sectorTimesMs[0]],
    ['sector2Ms', provisional.sectorTimesMs[1], confirmed.sectorTimesMs[1]],
  ] as const;
  return pairs
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => ({ carId, lapNumber, field, provisional: before, confirmed: after }));
};

/** Appends the confirmed version of every lap the packet completes and no earlier packet confirmed. */
const confirmLaps = (state: EngineState, packet: SessionHistoryPacket, at: SessionTime, out: StepOutput): void => {
  const indexOfLap = state.open.lapIndex[packet.carIdx];
  if (!indexOfLap) return;
  for (let i = 0; i < packet.numLaps; i++) {
    const entry = packet.lapHistoryData[i];
    const slot = indexOfLap[i + 1];
    if (!entry || entry.lapTimeInMs <= 0 || !slot || slot.confirmed || slot.provisional === undefined) continue;
    const provisional = state.history.laps[slot.provisional];
    if (!provisional) continue;
    const confirmed: LapRecord = {
      ...provisional,
      lapTimeMs: entry.lapTimeInMs,
      sectorTimesMs: [entry.sector1TimeMs, entry.sector2TimeMs, entry.sector3TimeMs],
      valid: {
        lap: (entry.lapValidBitFlags & LAP_VALID) !== 0,
        sectors: [
          (entry.lapValidBitFlags & SECTOR_VALID[0]) !== 0,
          (entry.lapValidBitFlags & SECTOR_VALID[1]) !== 0,
          (entry.lapValidBitFlags & SECTOR_VALID[2]) !== 0,
        ],
      },
      status: 'confirmed',
      completedAt: at,
    };
    out.corrections.push(...corrections(provisional, confirmed));
    state.history.laps.push(confirmed);
    slot.confirmed = true;
  }
};

/**
 * Laps are appended twice, never changed: provisional when the lap number goes up (from LapData), confirmed when
 * Session History holds the lap. The confirmed record wins; what differed is reported as corrections.
 */
export const applyLaps: SubStep = (state, frame: Frame, out) => {
  const before = state.history.laps.length;
  for (const car of carsWithLapData(state, frame)) trackLap(state, car, frame.sessionTime);
  for (const packet of frame.sessionHistory) confirmLaps(state, packet, frame.sessionTime, out);
  if (state.history.laps.length > before) out.changed.add('laps');
};
