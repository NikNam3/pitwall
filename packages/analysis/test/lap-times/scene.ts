// Test sessions for `lap-times`: lap records and mini-sector crossings with car states that agree with them, and the
// spans the machine would have open (the weekend phase, per car its status, location and activity, C14, C17, C20).
// The live session keeps the builder's defaults (a race): the unit must take the phase from the situation, not from
// `session.kind` or a session type code.
import { carId, type CarId, type CarState, type CarTiming, type LapRecord, type MachineId, type MiniSectorCrossing, type OpenSpan, type SessionState, type WeekendPhase } from '@pitwall/domain';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import type { EngineView } from '@pitwall/engine';
import { carState, crossings, engineView, lap, type DeepPartial } from '../../../../test-support/builders/index.ts';
import { lapTimesCalculator } from '../../src/lap-times/calculator.ts';
import type { LapTimesOutput } from '../../src/lap-times/index.ts';
import { scheduled } from '../scheduled.ts';

/** Weekend phases (`view.situation.weekendPhase`, C14) with the formats and segments the unit tells apart. */
export const PRACTICE: WeekendPhase = { kind: 'practice', format: 'practice', segment: undefined };
export const Q1: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 1 };
export const Q2: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 2 };
export const Q3: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 3 };
export const SS1: WeekendPhase = { kind: 'qualifying', format: 'sprintShootout', segment: 1 };
export const SS2: WeekendPhase = { kind: 'qualifying', format: 'sprintShootout', segment: 2 };
export const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };
export const NONE: WeekendPhase = { kind: 'none' };
export const PENDING: WeekendPhase = { kind: 'pending' };

/** The activity sub-machine of a weekend phase (C17: per phase). */
export const ACTIVITY_MACHINE: Record<'practice' | 'qualifying' | 'race', MachineId> = {
  practice: 'car-activity-practice',
  qualifying: 'car-activity-qualifying',
  race: 'car-activity-race',
};

/** The default activity of a car on a lap of the phase: what a car projects on. */
const ON_LAP: Record<'practice' | 'qualifying' | 'race', string> = { practice: 'flyingLap', qualifying: 'pushLap', race: 'racingLap' };

/**
 * The kinds of the spans open for one car; absent ones default to a competing car on the track on a lap. `validity` opens
 * the car's lap-validity span (none when absent).
 */
export type CarKinds = { status?: string; location?: string; activity?: string; validity?: 'valid' | 'invalid' };

const open = (machine: MachineId, car: number, kind: string, detail: unknown = undefined): OpenSpan => ({ machine, id: 0, carId: carId(car), kind, start: 0, confirmed: true, detail, startFrame: 1 });

/** The weekend phase's open span (none while the phase is pending: it is not decided yet). */
const phaseSpan = (phase: WeekendPhase): OpenSpan[] =>
  phase.kind === 'pending'
    ? []
    : [{ machine: 'weekend-phase', id: 0, kind: phase.kind, start: 0, confirmed: true, detail: 'format' in phase ? { format: phase.format, segment: 'segment' in phase ? phase.segment : undefined } : undefined, startFrame: 1 }];

/** The situation of a session in `phase` with these cars' spans open (each car in `cars` has the defaults unless `kinds` says otherwise). */
export function situationOf(phase: WeekendPhase, cars: readonly CarState[], kinds: Record<number, CarKinds> = {}): EngineView['situation'] {
  const byMachine: Record<MachineId, OpenSpan[]> = {};
  const add = (span: OpenSpan): void => void (byMachine[span.machine] ??= []).push(span);
  phaseSpan(phase).forEach(add);
  const phaseKind = phase.kind === 'practice' || phase.kind === 'qualifying' || phase.kind === 'race' ? phase.kind : undefined;
  for (const car of cars) {
    const k = kinds[car.id] ?? {};
    add(open('car-status', car.id, k.status ?? 'competing', k.status === 'retired' ? { cause: { known: false, reason: 'notReceived' } } : undefined));
    add(open('car-location', car.id, k.location ?? 'track'));
    if (phaseKind !== undefined) add(open(ACTIVITY_MACHINE[phaseKind], car.id, k.activity ?? ON_LAP[phaseKind]));
    if (k.validity !== undefined) add(open('lap-validity', car.id, k.validity));
  }
  return { weekendPhase: phase, byMachine };
}

/** A lap of `car` with these three sector times; `lapTimeMs` is their sum. */
export function sectorLap(car: number, lapNumber: number, sectorTimesMs: [number, number, number], completedAt: number, over: Partial<LapRecord> = {}): LapRecord {
  const lapTimeMs = sectorTimesMs[0] + sectorTimesMs[1] + sectorTimesMs[2];
  return lap({ carId: carId(car), lapNumber, lapTimeMs, sectorTimesMs, completedAt, ...over });
}

/**
 * The crossings of a lap in progress after its start line (engine convention: segment 0 is the line at `startAt`, which
 * `field` already holds as the closing crossing of the lap before): segments 1 to `segment` of an evenly paced `paceMs`
 * lap, the last one `upMs` earlier (so the car is `upMs` up at `segment` on a lap at `paceMs`).
 */
export function lapInProgress(car: number, lapNumber: number, paceMs: number, startAt: number, segment: number, upMs = 0): MiniSectorCrossing[] {
  const list = crossings(carId(car), lapNumber, paceMs, startAt).slice(1, segment + 1);
  const last = list[list.length - 1]!;
  list[list.length - 1] = { ...last, at: last.at - upMs };
  return list;
}

/** Cars 0..count-1 with default timing, `timing[i]` merged onto car i. */
export function activeCars(count: number, timing: Record<number, Partial<CarTiming>> = {}): CarState[] {
  return Array.from({ length: count }, (_, i) => carState({ id: carId(i), timing: timing[i] ?? {} }));
}

/** The view of a session over these laps and crossings (each list in the order the history appends it: by time). */
export function scene({
  laps = [],
  miniSectors = [],
  cars,
  phase = PRACTICE,
  kinds = {},
  session = {},
  sessionTime = 0,
  config = {},
}: {
  laps?: LapRecord[];
  miniSectors?: MiniSectorCrossing[];
  cars: CarState[];
  /** The weekend phase; the live session stays the builder's race. */
  phase?: WeekendPhase;
  /** Per car, the kinds of its open spans. */
  kinds?: Record<number, CarKinds>;
  session?: DeepPartial<SessionState>;
  sessionTime?: number;
  config?: EngineView['config'];
}): EngineView {
  return engineView({
    cars,
    history: { laps: [...laps].sort((a, b) => a.completedAt - b.completedAt), crossings: [...miniSectors].sort((a, b) => a.at - b.at) },
    situation: situationOf(phase, cars, kinds),
    session,
    sessionTime,
    config,
  });
}

/**
 * One car's current pass as a test gives it: its lap, the sector it is in, its live S1 and S2 (0 or absent: none yet, C3),
 * when it crossed the lap's line, and whether its lap is invalid.
 */
export type PassSpec = { lap: number; sector: 1 | 2 | 3; s1?: number; s2?: number; lineAt: number; invalid?: boolean };

/**
 * Cars 0..n-1 on these passes (car i on `passes[i]`): their live timing, each lap's line crossing (car, lap, 0) at
 * `lineAt`, and each car's lap-validity span; the race clock a second after the last live sector finished.
 */
export function passScene({ passes, laps = [], phase = PRACTICE }: { passes: readonly PassSpec[]; laps?: LapRecord[]; phase?: WeekendPhase }): EngineView {
  const cars = activeCars(
    passes.length,
    Object.fromEntries(passes.map((p, i) => [i, { lap: p.lap, sector: p.sector, sector1TimeMs: p.s1 ?? 0, sector2TimeMs: p.s2 ?? 0 }])),
  );
  const lines = passes.map((p, i): MiniSectorCrossing => ({ carId: carId(i), lap: p.lap, segment: 0, at: p.lineAt, frame: 0 }));
  const kinds = Object.fromEntries(passes.map((p, i): [number, CarKinds] => [i, { validity: p.invalid === true ? 'invalid' : 'valid' }]));
  const end = Math.max(...passes.map((p) => p.lineAt + (p.s1 ?? 0) + (p.s2 ?? 0)));
  return scene({ laps, miniSectors: lines, cars, phase, kinds, sessionTime: end + 1_000 });
}

/** The view as `lap-times` may see it: through its guarded view, so an undeclared read throws (C41). */
export const guarded = (view: EngineView): EngineView => guardedView(view, lapTimesCalculator.reads, { unit: 'lap-times' });

/** `lap-times` stepped by its tests: its output reads the view its accumulator was last folded on (C31.2). */
export const lapTimes = scheduled(lapTimesCalculator);

/** `init` over the view, as the scheduler does on a fresh run, through the guarded view. */
export const run = (view: EngineView): LapTimesOutput => lapTimes.output(lapTimes.init(guarded(view)));

/** The row of one car. */
export const rowOf = (out: LapTimesOutput, id: number) => out.rows.find((r) => r.carId === (id as CarId));

/**
 * A garage restart's new pass over `lapNumber` of `car`, as the mini-sector recorder appends it (Task 2): the line at
 * `startAt` (segment 0) and segments 1 to `segment` of an evenly paced `paceMs` lap, each crossing that repeats a
 * (car, lap, segment) of `history` carrying `supersedes` = the newest earlier one's fact id (C21, C25). `history` is the
 * crossings list in log order (by time, as `scene` keeps it), every crossing of it before `startAt`; the pass is appended
 * after it.
 */
export function restartPass(history: readonly MiniSectorCrossing[], car: number, lapNumber: number, paceMs: number, startAt: number, segment = 49): MiniSectorCrossing[] {
  const id = carId(car);
  return crossings(id, lapNumber, paceMs, startAt)
    .slice(0, segment + 1)
    .map((c): MiniSectorCrossing => {
      let index = -1;
      for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i]!;
        if (h.carId === id && h.lap === lapNumber && h.segment === c.segment) {
          index = i;
          break;
        }
      }
      return index < 0 ? c : { ...c, supersedes: { list: 'crossings', index } };
    });
}
