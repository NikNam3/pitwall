// Test sessions for `lap-times`: lap records and mini-sector crossings with car states that agree with them.
import { carId, type CarId, type CarState, type CarTiming, type LapRecord, type MiniSectorCrossing, type SessionState } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { carState, crossings, engineView, lap, type DeepPartial } from '../../../../test-support/builders/index.ts';
import { lapTimesCalculator } from '../../src/lap-times/calculator.ts';
import type { LapTimesOutput } from '../../src/lap-times/index.ts';

/** Session parts by their session type code (F1 25 appendix "Session types"); the builder does not derive `kind`. */
export const PRACTICE = { sessionType: 1, kind: 'practice' } as const;
export const Q1 = { sessionType: 5, kind: 'qualifying' } as const;
export const RACE = { sessionType: 15, kind: 'race' } as const;

/** A lap of `car` with these three sector times; `lapTimeMs` is their sum. */
export function sectorLap(car: number, lapNumber: number, sectorTimesMs: [number, number, number], completedAt: number, over: Partial<LapRecord> = {}): LapRecord {
  const lapTimeMs = sectorTimesMs[0] + sectorTimesMs[1] + sectorTimesMs[2];
  return lap({ carId: carId(car), lapNumber, lapTimeMs, sectorTimesMs, completedAt, ...over });
}

/**
 * The crossings of a lap in progress: those of an evenly paced `paceMs` lap started at `startAt`, up to and including
 * `segment`, the last one `upMs` earlier (so the car is `upMs` up at `segment` on a lap at `paceMs`).
 */
export function lapInProgress(car: number, lapNumber: number, paceMs: number, startAt: number, segment: number, upMs = 0): MiniSectorCrossing[] {
  const list = crossings(carId(car), lapNumber, paceMs, startAt).slice(0, segment + 1);
  const last = list[list.length - 1]!;
  list[list.length - 1] = { ...last, at: last.at - upMs };
  return list;
}

/** Active cars 0..count-1 with default timing, `timing[i]` merged onto car i. */
export function activeCars(count: number, timing: Record<number, Partial<CarTiming>> = {}): CarState[] {
  return Array.from({ length: count }, (_, i) => carState({ id: carId(i), timing: timing[i] ?? {} }));
}

/** The view of a session over these laps and crossings (each list in the order the history appends it: by time). */
export function scene({
  laps = [],
  miniSectors = [],
  cars,
  session = PRACTICE,
  sessionTime = 0,
  config = {},
}: {
  laps?: LapRecord[];
  miniSectors?: MiniSectorCrossing[];
  cars: CarState[];
  session?: DeepPartial<SessionState>;
  sessionTime?: number;
  config?: EngineView['config'];
}): EngineView {
  return engineView({
    cars,
    history: { laps: [...laps].sort((a, b) => a.completedAt - b.completedAt), miniSectors: [...miniSectors].sort((a, b) => a.at - b.at) },
    session: { numActiveCars: cars.length, ...session },
    sessionTime,
    config,
  });
}

/** `init` over the view, as the scheduler does on a fresh run. */
export const run = (view: EngineView): LapTimesOutput => lapTimesCalculator.output(lapTimesCalculator.init(view));

/** The row of one car. */
export const rowOf = (out: LapTimesOutput, id: number) => out.rows.find((r) => r.carId === (id as CarId));
