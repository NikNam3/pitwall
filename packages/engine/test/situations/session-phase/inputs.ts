// Shared by the transition tables and unit tests of the three session-phase sub-machines (contract C9, C14, C17, C85):
// the input edits that put a frame into a weekend phase and give it the signals and values the machines read. A
// session-phase machine runs only while its weekend phase is decided (C14, `runMachine`); stepped on its own, each frame
// carries the phase (`weekendPhase`) and the weekend-phase span as its upstream, and the car-status spans (Task 10: the
// cars in the session are those whose status is not absent, C43). Two cars are in the session, car 0 the leader. This
// folder holds no table file, so `loadTransitionTables` skips it.
import type { CarId, OpenSpan, WeekendPhase } from '@pitwall/domain';
import type { SituationEvent } from '../../../src/signals/types.ts';
import type { MachineInput } from '../../../src/situations/machine.ts';
import { FRAME_MS, type InputEdit } from '../../support/transition-table.ts';

export const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };
export const QUALIFYING: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 2 };
export const PRACTICE: WeekendPhase = { kind: 'practice', format: 'practice', segment: 1 };

/** The session's duration in the scripted practice and qualifying, ms. */
export const DURATION_MS = 3_600_000;

/** The cars in the session: car 0 leads, car 1 runs second. */
const CARS: readonly CarId[] = [0 as CarId, 1 as CarId];

/** A car's status as car-status's open span says it (the upstream of the session-phase machines). */
export type CarStatusKind = 'competing' | 'retired' | 'disqualified' | 'absent';

/** The car-status span of slot `car`. */
const carStatusSpan = (car: number, kind: CarStatusKind): OpenSpan => ({
  machine: 'car-status',
  id: 0,
  carId: car as CarId,
  kind,
  start: 0,
  startFrame: 1,
  confirmed: true,
  detail: {},
});

/** The frame's car-status spans: as a frame before set them, else cars 0 and 1 competing and every other slot absent. */
const carStatusOf = (i: MachineInput): readonly OpenSpan[] =>
  i.upstream['car-status'] ?? i.signals.cars.map((_, car) => carStatusSpan(car, CARS.includes(car as CarId) ? 'competing' : 'absent'));

/**
 * The frame lies in `phase` (C14): the weekend phase decided, its weekend-phase span the upstream, the session's
 * duration, two cars in the session on lap 1 with their lap timers at 0. Every row starts each frame with it. The
 * car-status upstream: cars 0 and 1 competing, every other slot absent, unless a frame before set it (`carStatus`).
 */
export const inPhase = (phase: WeekendPhase): InputEdit => (i) => {
  i.weekendPhase = phase;
  const { kind, ...detail } = phase;
  i.upstream = { 'weekend-phase': [{ machine: 'weekend-phase', id: 0, kind, start: 0, startFrame: 1, confirmed: true, detail }], 'car-status': carStatusOf(i) };
  i.live.session.durationMs = DURATION_MS;
  i.signals.session.numActiveCars = CARS.length;
  CARS.forEach((id, k) => {
    i.live.cars[id]!.timing.position = k + 1;
  });
};

/** Every edit in order. */
export const all = (...edits: InputEdit[]): InputEdit => (i, index) => {
  for (const edit of edits) edit(i, index);
};

/** The frame carries `events` (only this frame: the builder clears the events of the frame before). */
export const events = (...list: SituationEvent[]): InputEdit => (i) => {
  i.signals.events = [...i.signals.events, ...list];
};

/** The safety car status (a signal, C12), from this frame on: `green`, `sc`, `vsc` or `formation`. */
export const status = (flag: 'green' | 'sc' | 'vsc' | 'formation'): InputEdit => (i) => {
  i.signals.session.safetyCarStatus = flag;
};

/** The leader on lap `lap` with its lap timer at `ms` (values, C8), from this frame on. */
export const leader = (lap: number, ms: number): InputEdit => (i) => {
  const timing = i.live.cars[0]!.timing;
  timing.lap = lap;
  timing.currentLapTimeMs = ms;
};

/** A race under way: the leader on lap 3, 30 s into it. */
export const underWay: InputEdit = leader(3, 30_000);

/** Car 1's lap timer at `ms`, the leader's at 0: a car standing past the line on the grid shows 510 ms (inventory 7, S3). */
export const timerOfCar1 = (ms: number): InputEdit => (i) => {
  i.live.cars[1]!.timing.currentLapTimeMs = ms;
};

/**
 * Both cars' result status (a signal, C12), from this frame on, and their car-status spans as car-status decides them
 * (retired for a retired car, competing otherwise).
 */
export const results = (car0: 'active' | 'finished' | 'retired', car1: 'active' | 'finished' | 'retired'): InputEdit => (i, index) => {
  [car0, car1].forEach((status, id) => {
    i.signals.cars[id]!.resultStatus = status;
    carStatus(id, status === 'retired' ? 'retired' : 'competing')(i, index);
  });
};

/** Slot `car`'s car-status span is of `kind` from this frame on (the upstream car-status, C43). */
export const carStatus = (car: number, kind: CarStatusKind): InputEdit => (i) => {
  const spans = carStatusOf(i).filter((s) => s.carId !== car);
  i.upstream = { ...i.upstream, 'car-status': [...spans, carStatusSpan(car, kind)].sort((a, b) => (a.carId ?? 0) - (b.carId ?? 0)) };
};

/** The session clock stands at race-clock time `at` (the grid's held clock), the time left at the full duration. */
export const heldAt = (at: number): InputEdit => (i) => {
  i.at = at;
  i.live.session.timeLeftMs = DURATION_MS;
};

/** The session clock runs: the time left below the duration by the race-clock time (the builder's `at`). */
export const clockRuns: InputEdit = (i) => {
  i.live.session.timeLeftMs = DURATION_MS - Math.max(i.at, 1);
};

/** Step 0's clock read the simulated end of the session on this frame (C36): its `simulatedEnd` fact at the previous frame's time. */
export const simulatedEnd: InputEdit = (i) => {
  i.clock.simulatedEnd = i.at - FRAME_MS;
};

// The C12 events as step 1 converts them (`SituationEvent`).
export const STLG = (lights: number): SituationEvent => ({ code: 'STLG', lights });
export const LGOT: SituationEvent = { code: 'LGOT' };
export const RDFL: SituationEvent = { code: 'RDFL' };
export const CHQF: SituationEvent = { code: 'CHQF' };
export const SEND: SituationEvent = { code: 'SEND' };
export const RCWN: SituationEvent = { code: 'RCWN', carId: 0 as CarId };
export const scar = (car: 'none' | 'SC' | 'VSC' | 'formation', stage: 'deployed' | 'returning' | 'returned' | 'resume'): SituationEvent => ({ code: 'SCAR', car, stage });
