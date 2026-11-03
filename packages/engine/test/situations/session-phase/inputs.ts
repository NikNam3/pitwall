// Shared by the transition tables and unit tests of the three session-phase sub-machines (contract C9, C14, C17, C85):
// the input edits that put a frame into a weekend phase and give it the signals and values the machines read. A
// session-phase machine runs only while its weekend phase is decided (C14, `runMachine`); stepped on its own, each frame
// carries the phase (`weekendPhase`) and the weekend-phase span as its upstream. Two cars are in the session, car 0 the
// leader. This folder holds no table file, so `loadTransitionTables` skips it.
import type { CarId, WeekendPhase } from '@pitwall/domain';
import type { SituationEvent } from '../../../src/signals/types.ts';
import { FRAME_MS, type InputEdit } from '../../support/transition-table.ts';

export const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };
export const QUALIFYING: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 2 };
export const PRACTICE: WeekendPhase = { kind: 'practice', format: 'practice', segment: 1 };

/** The session's duration in the scripted practice and qualifying, ms. */
export const DURATION_MS = 3_600_000;

/** The cars in the session: car 0 leads, car 1 runs second. */
const CARS: readonly CarId[] = [0 as CarId, 1 as CarId];

/**
 * The frame lies in `phase` (C14): the weekend phase decided, its weekend-phase span the upstream, the session's kind
 * and duration, two cars in the session on lap 1 with their lap timers at 0. Every row starts each frame with it.
 */
export const inPhase = (phase: WeekendPhase): InputEdit => (i) => {
  i.weekendPhase = phase;
  const { kind, ...detail } = phase;
  i.upstream = { 'weekend-phase': [{ machine: 'weekend-phase', id: 0, kind, start: 0, startFrame: 1, confirmed: true, detail }] };
  i.live.session.kind = kind === 'race' ? 'race' : kind === 'qualifying' ? 'qualifying' : 'practice';
  i.live.session.durationMs = DURATION_MS;
  i.signals.session.numActiveCars = CARS.length;
  i.live.session.numActiveCars = CARS.length;
  CARS.forEach((id, k) => {
    const car = i.live.cars[id]!;
    car.active = true;
    car.timing.position = k + 1;
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

/** Both cars' result status (a signal, C12, and the live value step 1 writes), from this frame on. */
export const results = (car0: 'active' | 'finished' | 'retired', car1: 'active' | 'finished' | 'retired'): InputEdit => (i) => {
  [car0, car1].forEach((status, id) => {
    i.signals.cars[id]!.resultStatus = status;
    i.live.cars[id]!.timing.resultStatus = status;
  });
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
