import { known, unknown, type CarId, type CarState, type Kg, type Known, type LapRecord, type SessionTime } from '@pitwall/domain';
import type { SessionHistoryPacket } from '@pitwall/protocol';
import type { Frame } from '../frame/frame.ts';
import type { EngineState, LapCursor } from '../state/engine-state.ts';
import type { LapCorrection, StepOutput, SubStep } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';
import { emptyChannels, lapEndSamples, observeLapFrame, unknownLapEnd } from './lap-samples.ts';

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
    ...emptyChannels(),
    ersDeployedJ: undefined,
    ersHarvestedJ: undefined,
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

/** A lap of this cursor as the values LapData can give: sector 3 is what is left of the lap time. */
const lapFromCursor = (
  car: CarState,
  cursor: LapCursor,
  lapNumber: number,
  lapTimeMs: number,
  at: SessionTime,
): LapRecord => {
  const hasSectors = cursor.lap === lapNumber && cursor.sector1Ms > 0 && cursor.sector2Ms > 0;
  const valid = !cursor.invalid;
  return {
    carId: car.id,
    lapNumber,
    lapTimeMs,
    sectorTimesMs: hasSectors ? [cursor.sector1Ms, cursor.sector2Ms, lapTimeMs - cursor.sector1Ms - cursor.sector2Ms] : [0, 0, 0],
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
    positionAtEnd: car.timing.position,
    status: 'provisional',
    completedAt: at,
    ...lapEndSamples(cursor, car, at),
  };
};

/** A lap LapData never showed us: only Session History has it, so what LapData would have given is unknown. */
const lapFromHistoryOnly = (car: CarState, lapNumber: number, lapTimeMs: number, at: SessionTime): LapRecord => ({
  carId: car.id,
  lapNumber,
  lapTimeMs,
  sectorTimesMs: [0, 0, 0],
  valid: { lap: true, sectors: [true, true, true] },
  actualCompound: 'unknown',
  visualCompound: 'unknown',
  tyreAgeAtStart: 0,
  fuelAtStartKg: unknown('notReceived'),
  fuelAtEndKg: unknown('notReceived'),
  scShare: 0,
  vscShare: 0,
  inLap: false,
  outLap: false,
  positionAtEnd: 0,
  status: 'provisional',
  completedAt: at,
  ...unknownLapEnd(),
});

const trackLap = (state: EngineState, car: CarState, at: SessionTime): void => {
  const { timing } = car;
  const cursor = state.open.laps[car.id];
  // The first LapData of a car, or a lap number that went down: start over without emitting.
  if (!cursor || timing.lap < cursor.lap) {
    const fresh = openCursor(car, at);
    observeLapFrame(fresh, car);
    state.open.laps[car.id] = fresh;
    return;
  }
  addElapsed(state, cursor, at);
  if (timing.lap === cursor.lap) {
    // The game resets the sectors at the line, so the last non-zero value is the lap's.
    if (timing.sector1TimeMs > 0) cursor.sector1Ms = timing.sector1TimeMs;
    if (timing.sector2TimeMs > 0) cursor.sector2Ms = timing.sector2TimeMs;
    cursor.invalid ||= timing.currentLapInvalid;
    observeLapFrame(cursor, car);
    return;
  }
  const lapNumber = timing.lap - 1;
  const indexOfLap = state.open.lapIndex[car.id];
  // Laps a lost frame swallowed have no provisional; Session History can still supply them.
  if (indexOfLap) for (let skipped = cursor.lap; skipped < lapNumber; skipped++) indexOfLap[skipped] ??= { confirmed: false };
  // Session History may already have confirmed this lap (a final lap the game never rolled over).
  if (!indexOfLap?.[lapNumber]?.confirmed) {
    if (indexOfLap) indexOfLap[lapNumber] = { provisional: state.history.laps.length, confirmed: false };
    state.history.laps.push(lapFromCursor(car, cursor, lapNumber, timing.lastLapTimeMs, at));
  }
  // The completing frame belongs to the next lap's ranges and totals, not to the one it ends.
  const next = openCursor(car, at);
  observeLapFrame(next, car);
  state.open.laps[car.id] = next;
};

/** The newest lap of the car that has a record (provisional or confirmed), 0 if none. */
export const lastRecordedLap = (state: EngineState, carId: CarId): number =>
  Math.max(0, ...Object.keys(state.open.lapIndex[carId] ?? {}).map(Number));

/** Corrections for what LapData got wrong; a sector LapData never had (0) is not a correction. */
const corrections = (provisional: LapRecord, confirmed: LapRecord): LapCorrection[] => {
  const { carId, lapNumber } = provisional;
  const pairs = [
    ['lapTimeMs', provisional.lapTimeMs, confirmed.lapTimeMs],
    ['sector1Ms', provisional.sectorTimesMs[0], confirmed.sectorTimesMs[0]],
    ['sector2Ms', provisional.sectorTimesMs[1], confirmed.sectorTimesMs[1]],
  ] as const;
  return pairs
    .filter(([field, before, after]) => before !== after && (field === 'lapTimeMs' || before > 0))
    .map(([field, before, after]) => ({ carId, lapNumber, field, provisional: before, confirmed: after }));
};

type LapEntry = SessionHistoryPacket['lapHistoryData'][number];

const validFrom = (flags: number): LapRecord['valid'] => ({
  lap: (flags & LAP_VALID) !== 0,
  sectors: [(flags & SECTOR_VALID[0]) !== 0, (flags & SECTOR_VALID[1]) !== 0, (flags & SECTOR_VALID[2]) !== 0],
});

/**
 * The lap before Session History confirms it: the stored provisional, the car's open lap (a final lap the game never
 * rolled over) or a lap skipped by a lap-number jump. Laps from before the engine saw the car stay unknown.
 */
const unconfirmedLap = (state: EngineState, packet: SessionHistoryPacket, lapNumber: number, entry: LapEntry, at: SessionTime) => {
  const slot = state.open.lapIndex[packet.carIdx]?.[lapNumber];
  if (slot?.provisional !== undefined) {
    const stored = state.history.laps[slot.provisional];
    return stored && { lap: stored, reported: true };
  }
  const car = state.cars[packet.carIdx];
  const cursor = state.open.laps[packet.carIdx];
  if (!car) return undefined;
  if (cursor?.lap === lapNumber) return { lap: lapFromCursor(car, cursor, lapNumber, entry.lapTimeInMs, at), reported: false };
  return slot ? { lap: lapFromHistoryOnly(car, lapNumber, entry.lapTimeInMs, at), reported: false } : undefined;
};

/**
 * Appends the confirmed version of every lap the packet completes and no earlier packet confirmed. Only a lap that
 * has a provisional is compared with it; one that had none is created from the history entry.
 */
const confirmLaps = (state: EngineState, packet: SessionHistoryPacket, at: SessionTime, out: StepOutput): void => {
  const indexOfLap = state.open.lapIndex[packet.carIdx];
  if (!indexOfLap) return;
  for (let i = 0; i < packet.numLaps; i++) {
    const entry = packet.lapHistoryData[i];
    const lapNumber = i + 1;
    if (!entry || entry.lapTimeInMs <= 0 || indexOfLap[lapNumber]?.confirmed) continue;
    const before = unconfirmedLap(state, packet, lapNumber, entry, at);
    if (!before) continue;
    const confirmed: LapRecord = {
      ...before.lap,
      lapTimeMs: entry.lapTimeInMs,
      sectorTimesMs: [entry.sector1TimeMs, entry.sector2TimeMs, entry.sector3TimeMs],
      valid: validFrom(entry.lapValidBitFlags),
      status: 'confirmed',
      // the line crossing, not the Session History cycle that confirmed it (up to ~24 s later)
      completedAt: before.reported ? before.lap.completedAt : at,
    };
    if (before.reported) out.corrections.push(...corrections(before.lap, confirmed));
    state.history.laps.push(confirmed);
    const slot = indexOfLap[lapNumber];
    if (slot) slot.confirmed = true;
    else indexOfLap[lapNumber] = { confirmed: true };
  }
};

/**
 * Laps are appended twice, never changed: provisional when the lap number goes up (from LapData), confirmed when
 * Session History holds the lap (a lap that never got a provisional is appended confirmed). The confirmed record wins; what differed is reported as corrections.
 */
export const applyLaps: SubStep = (state, frame: Frame, out) => {
  const before = state.history.laps.length;
  for (const car of carsWithLapData(state, frame)) trackLap(state, car, frame.sessionTime);
  for (const packet of frame.sessionHistory) {
    const car = state.cars[packet.carIdx];
    if (car) car.updatedAt.sessionHistory = frame.sessionTime;
    confirmLaps(state, packet, frame.sessionTime, out);
  }
  if (state.history.laps.length > before) out.changed.add('laps');
};
