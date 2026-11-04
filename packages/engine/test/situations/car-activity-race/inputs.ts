// Shared by car-activity-race's transition table and unit tests (contract C9, C12, C14, C15, C17, C85): the input edits
// that put a frame into the race and give a car the signals, values and upstream spans the machine reads. The machine
// runs only in the race (C14), after its upstream sub-machines, so stepped on its own each frame carries their open
// spans: `weekend-phase`, `session-phase-race` (racing unless a frame says otherwise), `car-status` (cars 0 and 1
// competing, every other slot absent), `car-location` (cars 0 and 1 on track, every other slot in its garage) and
// `penalties` (every slot clear). Each frame starts as the frame before left it (`MachineInput`'s builder), so an edit
// holds until another changes it. This file is no table (`loadTransitionTables` loads only
// `car-activity-race.transitions.ts`).
import { carId, unknown, type OpenSpan, type PitStatus, type ResultStatus, type WeekendPhase } from '@pitwall/domain';
import type { SituationEvent } from '../../../src/signals/types.ts';
import type { MachineInput } from '../../../src/situations/machine.ts';
import { FRAME_MS, type InputEdit } from '../../support/transition-table.ts';

export const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };
/** The machine's id and its upstream sub-machines (C15). */
export const MACHINE = 'car-activity-race';
const SESSION_PHASE = 'session-phase-race';
const CAR_STATUS = 'car-status';
const CAR_LOCATION = 'car-location';
const PENALTIES = 'penalties';

/** The cars in the session: car 0, the subject of the rows, and car 1. */
const IN_SESSION: readonly number[] = [0, 1];
/** A lap distance far into the lap, m: a fall below it is a line crossing. */
export const LATE_IN_LAP_M = 5400;

export type SessionPhaseRaceKind = 'grid' | 'formation' | 'startLights' | 'racing' | 'neutralised' | 'suspended' | 'finished' | 'postSession';
export type CarStatusKind = 'competing' | 'retired' | 'disqualified' | 'absent';
export type LocationKind = 'garage' | 'pitLane' | 'track';
export type PenaltiesKind = 'clear' | 'timePenalty' | 'driveThroughPending' | 'stopGoPending';

/** An upstream span as its sub-machine has it open. */
const upstreamSpan = (machine: string, kind: string, car: number | undefined, id: number, detail: unknown): OpenSpan => ({
  machine,
  id,
  ...(car !== undefined && { carId: carId(car) }),
  kind,
  start: 0,
  startFrame: 1,
  confirmed: true,
  detail,
});

/** The open span of `machine` for car `car` on this frame, if one is. */
export const upstreamOf = (i: MachineInput, machine: string, car: number): OpenSpan | undefined => i.upstream[machine]?.find((s) => s.carId === car);

/**
 * Car `car`'s span of `machine` is of `kind` from this frame on: the same span while the kind and detail hold, else the
 * next id (`id` sets it).
 */
const setCarSpan = (i: MachineInput, machine: string, car: number, kind: string, detail: unknown, id?: number): void => {
  const before = upstreamOf(i, machine, car);
  const same = before !== undefined && before.kind === kind && JSON.stringify(before.detail) === JSON.stringify(detail);
  const next = id ?? (before === undefined ? 0 : same ? before.id : before.id + 1);
  const others = (i.upstream[machine] ?? []).filter((s) => s.carId !== car);
  i.upstream[machine] = [...others, same && id === undefined ? before : upstreamSpan(machine, kind, car, next, detail)].sort((a, b) => (a.carId ?? 0) - (b.carId ?? 0));
};

/**
 * The frame lies in the race (C14), in the race session phase `phase` (default `racing`, after the lights out). On the
 * first frame (no car-status span yet) it gives every slot its upstream spans: cars 0 and 1 competing on track on lap 1,
 * late in the lap, nothing owed; every other slot absent in its garage.
 */
export const race = (phase: SessionPhaseRaceKind = 'racing'): InputEdit => (i) => {
  i.weekendPhase = RACE;
  const { kind, ...detail } = RACE;
  i.upstream['weekend-phase'] = [{ machine: 'weekend-phase', id: 0, kind, start: 0, startFrame: 1, confirmed: true, detail }];
  i.upstream[SESSION_PHASE] = [upstreamSpan(SESSION_PHASE, phase, undefined, 0, {})];
  if (i.upstream[CAR_STATUS] !== undefined) return;
  i.signals.cars.forEach((signals, car) => {
    const competing = IN_SESSION.includes(car);
    setCarSpan(i, CAR_STATUS, car, competing ? 'competing' : 'absent', {});
    setCarSpan(i, CAR_LOCATION, car, competing ? 'track' : 'garage', undefined);
    setCarSpan(i, PENALTIES, car, 'clear', {});
    signals.pitStatus = 'none';
    signals.pitLaneTimerActive = false;
    signals.resultStatus = competing ? 'active' : 'invalid';
    const timing = i.live.cars[car]!.timing;
    Object.assign(timing, { lap: 1, lapDistanceM: 3000, pitLaneTimeMs: 0, pitStopTimerMs: 0 });
  });
};

/** Every edit in order on one frame. */
export const all = (...edits: InputEdit[]): InputEdit => (i, index) => {
  for (const edit of edits) edit(i, index);
};

/** Where car `car` is: its car-location span, its pit status and pit lane timer (signals, C12). */
const where = (car: number, location: LocationKind, pitStatus: PitStatus, timerActive: boolean): InputEdit => (i) => {
  setCarSpan(i, CAR_LOCATION, car, location, undefined);
  const signals = i.signals.cars[car]!;
  signals.pitStatus = pitStatus;
  signals.pitLaneTimerActive = timerActive;
};

/** On track (pit status none): from the pit lane, the pit exit; the pit timers read 0 again (inventory §2.5). */
export const onTrack = (car = 0): InputEdit => (i, index) => {
  where(car, 'track', 'none', false)(i, index);
  Object.assign(i.live.cars[car]!.timing, { pitLaneTimeMs: 0, pitStopTimerMs: 0 });
};
/** In the pit lane, not in the box (pit status pitting): from the track, the pit entry; from the box, leaving it (the pit stop timer stays as the box left it). */
export const inPitLane = (car = 0): InputEdit => where(car, 'pitLane', 'pitting', true);
/** In the box (pit status in the pit area), the pit stop timer counting. */
export const inBox = (car = 0): InputEdit => (i, index) => {
  where(car, 'pitLane', 'inPitArea', true)(i, index);
  i.live.cars[car]!.timing.pitStopTimerMs += FRAME_MS;
};
/** Car `car`'s pit stop timer reads `ms` (a value, C8): above 0 once it stopped in its box on this visit. */
export const stopTimer = (car: number, ms: number): InputEdit => (i) => {
  i.live.cars[car]!.timing.pitStopTimerMs = ms;
};

/** Car `car` is on lap `lap` (a value, C8). */
export const lap = (car: number, n: number): InputEdit => (i) => {
  i.live.cars[car]!.timing.lap = n;
};
/** Car `car`'s lap distance reads `m` (a value, C8). */
export const distance = (car: number, m: number): InputEdit => (i) => {
  i.live.cars[car]!.timing.lapDistanceM = m;
};
/** Car `car` crosses the line on this frame: its lap distance falls from late in the lap to just past the line (the lap number stays, as at the finish, inventory §2.10). */
export const crosses = (car = 0): InputEdit => distance(car, 2);
/** Car `car` is late in its lap: the frame before a crossing. */
export const lateInLap = (car = 0): InputEdit => distance(car, LATE_IN_LAP_M);
/** Car `car` drives on just past the line (after a crossing). */
export const pastLine = (car = 0, m = 4): InputEdit => distance(car, m);

/** Car `car`'s result status from this frame on (a signal, C12). */
export const result = (car: number, status: ResultStatus): InputEdit => (i) => {
  i.signals.cars[car]!.resultStatus = status;
};
/** Car `car`'s car-status span is of `kind` from this frame on (the upstream car-status, C43). */
export const status = (car: number, kind: CarStatusKind): InputEdit => (i) => setCarSpan(i, CAR_STATUS, car, kind, {});
/** Car `car` has no car-status span: its Participants data is not in the live state yet (C3). */
export const unknownCar = (car: number): InputEdit => (i) => {
  i.upstream[CAR_STATUS] = (i.upstream[CAR_STATUS] ?? []).filter((s) => s.carId !== car);
};
/**
 * Car `car`'s penalties span is of `kind` from this frame on, id `id` when given (the upstream penalties, C17): a pending
 * drive-through or stop-go with one penalty of that type and an unknown infringement.
 */
export const owes = (car: number, kind: PenaltiesKind, id?: number): InputEdit => (i) => {
  const detail =
    kind === 'clear'
      ? {}
      : kind === 'timePenalty'
        ? { totalMs: 5000 }
        : { driveThroughs: kind === 'driveThroughPending' ? 1 : 0, stopGos: kind === 'stopGoPending' ? 1 : 0, infringement: unknown('notReceived'), totalMs: 0 };
  setCarSpan(i, PENALTIES, car, kind, detail, id);
};

/** The frame carries `list` (only this frame: the builder clears the events of the frame before). */
export const events = (...list: SituationEvent[]): InputEdit => (i) => {
  i.signals.events = [...i.signals.events, ...list];
};
/** DTSV: car `car` has served its drive-through. */
export const dtsv = (car = 0): SituationEvent => ({ code: 'DTSV', carId: carId(car) });
/** SGSV: car `car` has served its stop-go. */
export const sgsv = (car = 0): SituationEvent => ({ code: 'SGSV', carId: carId(car), stopTimeMs: 10_000 });
/** The frame's race-clock time is `ms` (a time far after the frames before it). */
export const atMs = (ms: number): InputEdit => (i) => {
  i.at = ms;
};
