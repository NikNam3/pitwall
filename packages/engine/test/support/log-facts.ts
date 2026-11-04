// Facts for the log and projection tests, built directly so the tests depend on no sub-machine. Each fact records the
// frame number it describes and each span the frame numbers it opened and closed on (C26); frame 0 is no applied frame.
import type { CarId, ClockFact, FrameNumber, MachineId, MiniSectorCrossing, OpenSpan, RaceEvent, SessionTime, Span, SpanId, VoidFact, WeekendPhase } from '@pitwall/domain';
import type { Situation } from '../../src/situations/situation.ts';

/** An overtake at `at` describing `frame`, by `carId` when given (a car's fact). */
export const event = (at: SessionTime, frame: FrameNumber = 0, carId?: CarId): RaceEvent => ({
  at, kind: 'overtake', ...(carId !== undefined && { carId }), params: {}, frame,
});

export const clockJump = (at: SessionTime, frame: FrameNumber = 0): ClockFact => ({ kind: 'jump', at, fromMs: at, toMs: at + 1000, frame });

/** Car `carId`'s crossing of segment 0 of lap 1 at `at`, describing `frame`. */
export const crossing = (carId: CarId, at: SessionTime, frame: FrameNumber): MiniSectorCrossing => ({ carId, lap: 1, segment: 0, at, frame });

/** Where a span lies in frames, and its car for a car sub-machine's span. */
export type SpanFrames = { startFrame: FrameNumber; endFrame: FrameNumber; carId?: CarId };

/** A closed span from `start` to `end` over the frames `[startFrame, endFrame)`; by default it covers no frame. */
export const span = (
  machine: MachineId,
  id: SpanId,
  kind: string,
  start: SessionTime,
  end: SessionTime,
  { startFrame, endFrame, carId }: SpanFrames = { startFrame: 0, endFrame: 0 },
): Span => ({
  machine, id, ...(carId !== undefined && { carId }), kind, start, end, confirmed: true, detail: undefined, startFrame, endFrame,
});

/** An open span from `start`, opened on frame `startFrame` (0 by default). */
export const openSpan = (
  machine: MachineId,
  id: SpanId,
  kind: string,
  start: SessionTime,
  { startFrame, carId }: Omit<SpanFrames, 'endFrame'> = { startFrame: 0 },
): OpenSpan => ({
  machine, id, ...(carId !== undefined && { carId }), kind, start, confirmed: true, detail: undefined, startFrame,
});

/** A void fact whose target is frame `frameId` at `at`, of frame number `frame` (0 by default). */
export const voidFact = (frameId: number, at: SessionTime, ranges: VoidFact['ranges'], frame: FrameNumber = 0): VoidFact => ({ target: { frameId, at }, ranges, frame });

const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };

/** A situation with the given open spans, grouped by their sub-machine. */
export const situation = (...open: OpenSpan[]): Situation => {
  const byMachine: Record<MachineId, OpenSpan[]> = {};
  for (const s of open) (byMachine[s.machine] ??= []).push(s);
  return { weekendPhase: RACE, byMachine };
};

export const NOTHING_OPEN: Situation = situation();
