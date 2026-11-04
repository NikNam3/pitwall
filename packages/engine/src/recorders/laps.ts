import { known, MAX_CARS, unknown, type ConfirmedLap, type FactRef, type Kg, type Known, type LapRecord, type FrameNumber, type SessionTime } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import type { LapCorrection, Recorder, RecorderInput, StepOutput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { carsInSession, carsWithLapData, type LiveCar } from './cars.ts';
import { lapMarkOf, lapNotBegun, lapStepOf, markActivity } from './lap-boundary.ts';
import type { LapCursor } from './lap-cursor.ts';
import { emptyChannels, lapEndSamples, lapStartSamples, observeLapFrame, unknownLapEnd } from './lap-samples.ts';
import { initialRaceStartMark, raceStartStep, type RaceStartMark } from './race-start.ts';
import { activityOf, lapInvalid, neutralisedBy, recordsNoLap, type SituationSpan } from './spans.ts';

/**
 * A lap that has a record: its provisional one with the id the log gave it (C21) until Session History confirms it, and
 * whether it is confirmed.
 */
export type RecordedLap = { provisional?: { lap: LapRecord; id: FactRef }; confirmed: boolean };

/** The laps recorder's own open state (C10); per-car arrays are indexed by `CarId`. */
export type LapsOwn = {
  cursors: Array<LapCursor | undefined>;
  /** Per car: lap number to what is recorded of it. */
  recorded: Array<Record<number, RecordedLap>>;
  /** Where the race start is (its own copy, C11). */
  raceStart: RaceStartMark;
};

const fuelAt = (car: LiveCar, at: SessionTime): Known<Kg> =>
  car.energy.fuel.known ? known(car.energy.fuel.value.kg, at) : unknown(car.energy.fuel.reason);

/** Fuel at the lap's start; unknown when the engine joined the lap after it (the car's own reason first). */
const fuelAtStart = (car: LiveCar, at: SessionTime, fromStart: boolean): Known<Kg> =>
  fromStart || !car.energy.fuel.known ? fuelAt(car, at) : unknown('notReceived');

/**
 * A new lap cursor; `fromStart` = the engine sees the lap from its start (the line crossing, or the car before it);
 * `firstLap` = the first lap the engine sees of the car.
 */
const openCursor = (car: LiveCar, at: SessionTime, fromStart: boolean): LapCursor => {
  const { timing, tyres } = car;
  return {
    ...lapMarkOf(car),
    startedAt: at,
    fuelAtStartKg: fuelAtStart(car, at, fromStart),
    tyreAgeAtStart: tyres.age,
    scMs: 0,
    vscMs: 0,
    sector1Ms: timing.sector1TimeMs,
    sector2Ms: timing.sector2TimeMs,
    invalid: false,
    lastSeenAt: at,
    trackedMs: 0,
    actualCompound: tyres.actualCompound,
    visualCompound: tyres.visualCompound,
    fromStart,
    ...lapStartSamples(car, at, fromStart),
    ...emptyChannels(),
    ersDeployedJ: undefined,
    ersHarvestedJ: undefined,
  };
};

/** Adds the time since the last frame to the lap, split by the car neutralising the session on this frame (its `neutralised` span). */
const addElapsed = (neutralised: 'SC' | 'VSC' | undefined, cursor: LapCursor, at: SessionTime): void => {
  const dt = Math.max(0, at - cursor.lastSeenAt);
  cursor.trackedMs += dt;
  if (neutralised === 'SC') cursor.scMs += dt;
  if (neutralised === 'VSC') cursor.vscMs += dt;
  cursor.lastSeenAt = at;
};

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

/** A lap of this cursor as the values LapData can give, describing frame `frame`: sector 3 is what is left of the lap time. */
const lapFromCursor = (car: LiveCar, cursor: LapCursor, lapNumber: number, lapTimeMs: number, at: SessionTime, frame: FrameNumber): LapRecord => {
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
    wearAtStartPct: cursor.wearAtStartPct,
    ersStoreAtStartJ: cursor.ersStoreAtStartJ,
    ...lapEndSamples(cursor, car, at),
    frame,
  };
};

/** A lap LapData never showed us, describing frame `frame`: only Session History has it, so what LapData would have given is unknown. */
const lapFromHistoryOnly = (car: LiveCar, lapNumber: number, lapTimeMs: number, at: SessionTime, frame: FrameNumber): LapRecord => ({
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
  frame,
});

/** Opens the car's lap cursor on this frame; the frame is the lap's first. */
const startLap = (own: LapsOwn, car: LiveCar, at: SessionTime, fromStart: boolean): LapCursor => {
  const cursor = openCursor(car, at, fromStart);
  observeLapFrame(cursor, car);
  own.cursors[car.id] = cursor;
  return cursor;
};

/**
 * The race start (`raceStartStep`): every car in the session that has had LapData starts its lap over on this frame,
 * seen from its start, as at lights out every car stands on the grid (spec 3.2); a car in the pit lane starts the race
 * from it (its activity opens `outLap`, which is no in lap). What the laps recorded stays as recorded (C24).
 */
const restartLaps = (own: LapsOwn, input: DeepReadonly<RecorderInput>): void => {
  for (const car of carsInSession(input)) if (car.updatedAt.lapData !== undefined) startLap(own, car, input.at, true);
};

/** What one frame of the recorder writes to: the log, the step's output and whether a lap was appended. */
type LapsPass = {
  at: SessionTime;
  frameNumber: FrameNumber;
  neutralised: 'SC' | 'VSC' | undefined;
  log: LogWriter;
  out: StepOutput;
  appended: boolean;
};

/**
 * The car's lap on this frame, with its activity span (`activity`, none without an activity sub-machine) and whether its
 * lap-validity span is `invalid`: the lap it is on takes the frame, or the lap completes and the next one begins on it.
 * The activity marks the lap the frame belongs to as in lap or out lap; an invalid frame makes the lap invalid.
 */
const trackLap = (own: LapsOwn, car: LiveCar, activity: SituationSpan | undefined, invalid: boolean, f: LapsPass): void => {
  const cursor = own.cursors[car.id];
  const lapStep = lapStepOf(cursor, car, activity, f.frameNumber);
  // The first lap seen, or the out lap's end at the line (practice, qualifying): what the game times from there is the
  // lap, without the in lap, garage and out lap before it.
  const lap = !cursor || lapStep === 'first' || lapStep === 'restart'
    ? startLap(own, car, f.at, lapStep === 'restart' || lapNotBegun(car))
    : addFrame(own, car, cursor, lapStep === 'next', f);
  markActivity(lap, activity, f.frameNumber);
  lap.invalid ||= invalid;
};

/** Adds the frame to the car's lap and returns it, or completes the lap (`completed`) and returns the next one, which the frame begins. */
const addFrame = (own: LapsOwn, car: LiveCar, cursor: LapCursor, completed: boolean, f: LapsPass): LapCursor => {
  const { timing } = car;
  const { at } = f;
  addElapsed(f.neutralised, cursor, at);
  if (!completed) {
    // The game resets the sectors at the line, so the last non-zero value is the lap's.
    if (timing.sector1TimeMs > 0) cursor.sector1Ms = timing.sector1TimeMs;
    if (timing.sector2TimeMs > 0) cursor.sector2Ms = timing.sector2TimeMs;
    observeLapFrame(cursor, car);
    return cursor;
  }
  const lapNumber = timing.lap - 1;
  const recorded = own.recorded[car.id];
  // Laps a lost frame swallowed have no provisional; Session History can still supply them.
  if (recorded) for (let skipped = cursor.lap; skipped < lapNumber; skipped++) recorded[skipped] ??= { confirmed: false };
  // Session History may already have confirmed this lap (a final lap the game never rolled over).
  if (!recorded?.[lapNumber]?.confirmed) {
    const provisional = lapFromCursor(car, cursor, lapNumber, timing.lastLapTimeMs, at, f.frameNumber);
    const id = f.log.append('laps', provisional);
    f.appended = true;
    if (recorded) recorded[lapNumber] = { provisional: { lap: provisional, id }, confirmed: false };
  }
  // The completing frame belongs to the next lap's ranges and totals, not to the one it ends.
  return startLap(own, car, at, true);
};

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

/**
 * The lap before Session History confirms it: the stored provisional (with its id, which the confirmed lap names, C25),
 * the car's open lap (a final lap the game never rolled over) or a lap skipped by a lap-number jump; these two have no
 * provisional in the log, so the confirmed lap names none. Laps from before the engine saw the car stay unknown. A lap
 * made now describes frame `frame`, the current one.
 */
const unconfirmedLap = (
  own: LapsOwn,
  car: LiveCar,
  entry: DeepReadonly<ConfirmedLap>,
  at: SessionTime,
  frame: FrameNumber,
): { lap: LapRecord; reported: boolean; supersedes?: FactRef } | undefined => {
  const { lapNumber } = entry;
  const slot = own.recorded[car.id]?.[lapNumber];
  if (slot?.provisional !== undefined) return { lap: slot.provisional.lap, reported: true, supersedes: slot.provisional.id };
  const cursor = own.cursors[car.id];
  if (cursor?.lap === lapNumber) return { lap: lapFromCursor(car, cursor, lapNumber, entry.lapTimeMs, at, frame), reported: false };
  return slot ? { lap: lapFromHistoryOnly(car, lapNumber, entry.lapTimeMs, at, frame), reported: false } : undefined;
};

/**
 * Appends the confirmed version of every lap of the car's confirmed laps (Session History, written by step 1) that no
 * earlier frame confirmed. Only a lap that has a provisional is compared with it; one that had none is created from the
 * entry.
 */
const confirmLaps = (own: LapsOwn, car: LiveCar, f: LapsPass): void => {
  const recorded = own.recorded[car.id];
  if (!recorded) return;
  for (const entry of car.timing.confirmedLaps) {
    const { lapNumber } = entry;
    if (recorded[lapNumber]?.confirmed) continue;
    const before = unconfirmedLap(own, car, entry, f.at, f.frameNumber);
    if (!before) continue;
    const { supersedes } = before;
    const confirmed: LapRecord = {
      ...before.lap,
      lapTimeMs: entry.lapTimeMs,
      sectorTimesMs: [...entry.sectorTimesMs],
      valid: { lap: entry.valid.lap, sectors: [...entry.valid.sectors] },
      status: 'confirmed',
      // the line crossing, not the Session History cycle that confirmed it (up to ~24 s later)
      completedAt: before.reported ? before.lap.completedAt : f.at,
      // the frame it describes is its provisional's, the crossing (C25, C26); a provisional made now describes this frame
      frame: before.lap.frame,
      // the provisional it supersedes, by its id in the current timeline (C21, C25)
      ...(supersedes !== undefined && { supersedes }),
    };
    if (before.reported) f.out.corrections.push(...corrections(before.lap, confirmed));
    f.log.append('laps', confirmed);
    f.appended = true;
    recorded[lapNumber] = { confirmed: true };
  }
};

/**
 * Laps are appended twice, never changed: provisional when the lap number goes up (from LapData), confirmed when
 * Session History holds the lap (a lap that never got a provisional is appended confirmed). The confirmed record wins;
 * what differed is reported as corrections. In lap, out lap and the restart at the line come from the car's activity
 * spans, the SC and VSC shares from the session's `neutralised` span (C10, C20); no signal is read (C13). While the car's
 * activity is `coolDown` or `notCompeting`, or the session is over (`postSession`), its lap stands still and no lap is
 * recorded; Session History still confirms a lap driven before (a finisher's final lap). Without an activity
 * sub-machine (a time trial, a pending weekend phase) laps are recorded at each crossing, neither in lap nor out lap.
 */
export const lapsRecorder: Recorder<LapsOwn> = {
  id: 'laps',
  init: () => ({
    cursors: Array.from({ length: MAX_CARS }, () => undefined),
    recorded: Array.from({ length: MAX_CARS }, () => ({})),
    raceStart: initialRaceStartMark(),
  }),
  apply(input, own, log, out) {
    const { at, live, situation } = input;
    const start = raceStartStep(own.raceStart, situation);
    own.raceStart = start.mark;
    if (start.started) restartLaps(own, input);
    const f: LapsPass = { at, frameNumber: input.frameNumber, neutralised: neutralisedBy(situation), log, out, appended: false };
    for (const car of carsWithLapData(input)) {
      if (recordsNoLap(situation, car.id, input.frameNumber)) continue;
      trackLap(own, car, activityOf(situation, car.id), lapInvalid(situation, car.id), f);
    }
    for (const car of live.cars) if (car.updatedAt.sessionHistory === at) confirmLaps(own, car, f);
    if (f.appended) out.changed.add('laps');
    return own;
  },
};
