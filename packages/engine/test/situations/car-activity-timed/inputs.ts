// Shared by the transition tables and unit tests of the qualifying and practice car-activity sub-machines (contract C9,
// C14, C15, C17, C85): the input edits that put a frame into the weekend phase and give it the signals, values and
// upstream spans the machines read. Stepped on its own, each frame carries what step 2 gives a per-phase machine: the
// weekend phase and its weekend-phase span (`inPhase`), the car-status spans (cars 0 and 1 competing, every other slot
// absent, unless an edit sets them, `carStatus`), the phase's session-phase span (`running` unless `sessionPhase` sets
// it) and the car-location spans, which the frame derives from the cars' signals as car-location decides them (`garage`
// while the driver status is in the garage, else `pitLane` while the pit status is pitting or in the pit area, else
// `track`; a new span on every change; a slot's first span on the first frame its Participants data is in the live
// state, with `joinedAt`; inventory §2.1-2.5, Task 10). The track is `TRACK_M` long. This folder holds no table file,
// so `loadTransitionTables` skips it.
import { carId as toCarId, type DriverStatus, type MachineId, type OpenSpan, type PitStatus, type ResultStatus, type WeekendPhase } from '@pitwall/domain';
import type { MachineInput } from '../../../src/situations/machine.ts';
import { participants } from '../../support/car-edits.ts';
import type { InputEdit } from '../../support/transition-table.ts';
import { all, inPhase } from '../session-phase/inputs.ts';

export { carStatus, PRACTICE, QUALIFYING } from '../session-phase/inputs.ts';
export { all };

/** The track's length in the scripted sessions, m (the session area's `trackLengthM`). */
export const TRACK_M = 5000;

type Location = 'garage' | 'pitLane' | 'track';

/** Where a car is by its driver and pit status, as car-location decides it. */
const locationOf = (driverStatus: DriverStatus, pitStatus: PitStatus): Location => {
  if (driverStatus === 'inGarage') return 'garage';
  return pitStatus === 'none' ? 'track' : 'pitLane';
};

/** The span `kind` of `machine` for the frame, `before` (the previous frame's span of the scope) kept while the kind holds. */
const successor = (machine: MachineId, kind: string, before: OpenSpan | undefined, i: MachineInput, carId?: number): OpenSpan => {
  if (before !== undefined && before.kind === kind) return before;
  return {
    machine,
    id: before === undefined ? 0 : before.id + 1,
    ...(carId === undefined ? {} : { carId: toCarId(carId) }),
    kind,
    start: i.at,
    startFrame: i.frameNumber,
    confirmed: true,
    detail: undefined,
    ...(before === undefined ? { joinedAt: true as const } : {}),
  };
};

/** The frame's car-location spans, from its signals, for every slot whose Participants data is in the live state. */
const deriveLocations = (i: MachineInput, before: readonly OpenSpan[]): OpenSpan[] =>
  i.signals.cars.flatMap((signals, index): OpenSpan[] => {
    if (i.live.cars[index]?.updatedAt.participants === undefined) return [];
    const was = before.find((s) => s.carId === index);
    return [successor('car-location', locationOf(signals.driverStatus, signals.pitStatus), was, i, index)];
  });

/** The edits of one sub-machine's phase: the qualifying (`QUALIFYING`, `session-phase-qualifying`) or practice one. */
export type Timed = {
  /** A frame of the phase with Participants data (every slot's car-location span), edited by `edits` in order. */
  frame(...edits: InputEdit[]): InputEdit;
  /** A frame of the phase before any Participants data: no car-location span. */
  bare(...edits: InputEdit[]): InputEdit;
  /** The phase's session-phase span is of kind `kind` from this frame on (a new span when the kind changes). */
  sessionPhase(kind: string): InputEdit;
};

/** The edits of `phase`, whose session-phase sub-machine is `sessionPhaseId`. */
export const timed = (phase: WeekendPhase, sessionPhaseId: MachineId): Timed => {
  const make = (withParticipants: boolean) => (...edits: InputEdit[]): InputEdit => (i, index) => {
    const kept = { location: i.upstream['car-location'] ?? [], session: i.upstream[sessionPhaseId] };
    inPhase(phase)(i, index);
    i.live.session.trackLengthM = TRACK_M;
    if (withParticipants) participants(i, index);
    i.upstream = { ...i.upstream, [sessionPhaseId]: kept.session ?? [successor(sessionPhaseId, 'running', undefined, i)] };
    for (const edit of edits) edit(i, index);
    i.upstream = { ...i.upstream, 'car-location': deriveLocations(i, kept.location) };
  };
  return {
    frame: make(true),
    bare: make(false),
    sessionPhase: (kind) => (i) => {
      i.upstream = { ...i.upstream, [sessionPhaseId]: [successor(sessionPhaseId, kind, i.upstream[sessionPhaseId]?.[0], i)] };
    },
  };
};

/** What a car shows on one frame: its signals (driver, pit and result status) and values (lap, lap distance, lap timer). */
export type CarFrame = { ds: DriverStatus; ps: PitStatus; d: number; lap?: number; timerMs?: number; rs?: ResultStatus };

/**
 * Car `index` shows `c` from this frame on: the signals `driverStatus`, `pitStatus` and `resultStatus` (active unless
 * given) and the values lap (1 unless given), lap distance and lap timer (0 unless given) of its timing area.
 */
export const car = (index: number, c: CarFrame): InputEdit => (i) => {
  const signals = i.signals.cars[index]!;
  const timing = i.live.cars[index]!.timing;
  const rs = c.rs ?? 'active';
  Object.assign(signals, { driverStatus: c.ds, pitStatus: c.ps, resultStatus: rs });
  Object.assign(timing, { driverStatus: c.ds, pitStatus: c.ps, resultStatus: rs, lap: c.lap ?? 1, lapDistanceM: c.d, currentLapTimeMs: c.timerMs ?? 0 });
};

/** Car 0 shows `c` (`car(0, c)`). */
export const car0 = (c: CarFrame): InputEdit => car(0, c);

// Car 0 in the places the rows put it (driver status, pit status, lap distance), lap 1 unless given.
/** In its garage box (ds 0, ps 1). */
export const inGarage = (d = 60, lap = 1): InputEdit => car0({ ds: 'inGarage', ps: 'pitting', d, lap });
/** Leaving the garage: ds 0 -> 3 with ps still 1, in the pit lane (MiP 641.422). */
export const leavingGarage = (d = 69, lap = 1): InputEdit => car0({ ds: 'outLap', ps: 'pitting', d, lap });
/** On its out lap on track (ds 3, ps 0); the out lap's timer stands at 0 (practice-garage-exit, SgQ). */
export const onOutLap = (d: number, lap = 1): InputEdit => car0({ ds: 'outLap', ps: 'none', d, lap });
/** On a push or flying lap on track (ds 1, ps 0), its timer running. */
export const pushing = (d: number, lap = 1, timerMs = Math.max(0, Math.round(d * 18))): InputEdit => car0({ ds: 'flyingLap', ps: 'none', d, lap, timerMs });
/** On track with the in-lap driver status (ds 2, ps 0), its timer running. */
export const inLapOnTrack = (d: number, lap = 1, timerMs = Math.max(0, Math.round(d * 18))): InputEdit => car0({ ds: 'inLap', ps: 'none', d, lap, timerMs });
/** In the pit lane on the in lap (ds 2, ps 1). */
export const inPitLane = (d: number, lap = 1): InputEdit => car0({ ds: 'inLap', ps: 'pitting', d, lap });
