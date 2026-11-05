// Where a car's lap begins and what it is, the one rule for every recorder that needs it (contract C10, C11, C13: each
// keeps its own `LapMark`; the laps recorder's cursor is one). The lap number is a value; the in lap, the out lap and
// the restart at the line come from the car's activity spans (`spans.ts`), never from a signal.
import type { FrameNumber } from '@pitwall/domain';
import type { LiveCar } from './cars.ts';
import { pitEntryOpened, pushOpened, type SituationSpan } from './spans.ts';

/** What a recorder keeps of the lap a car is on to tell where the next begins. */
export type LapMark = {
  lap: number;
  /** The car's activity opened a pit entry on this lap (`inLap` or `servingPenalty`): the in lap. */
  pitted: boolean;
  /** An `outLap` span of the car's activity was open on a frame of this lap: the out lap. */
  outLap: boolean;
};

/**
 * What this frame is for the car's lap: `first` (the first LapData of the car, or a lap number that went down: start over
 * without a lap), `restart` (the timed activity opened a push or flying lap at the line on the same lap number, after an
 * out lap: the lap begins there), `next` (the lap number went up: the lap completed) or `same`.
 */
export type LapStep = 'first' | 'restart' | 'next' | 'same';

/**
 * The car has not begun its lap on the first frame a recorder sees of it: before the line (lap distance not above 0)
 * or with the lap timer not running (on the grid before the start, in the garage).
 */
export const lapNotBegun = (car: LiveCar): boolean => car.timing.lapDistanceM <= 0 || car.timing.currentLapTimeMs === 0;

/**
 * The step of the car's lap on this frame (frame number `frameNumber`), given its activity span. In practice and
 * qualifying the lap number does not advance through the garage, so the car leaves it on the lap it then times from the
 * line: the push span opens there and the lap restarts. A race's lap number always rolls over at the line.
 */
export const lapStepOf = (mark: Pick<LapMark, 'lap'> | undefined, car: LiveCar, activity: SituationSpan | undefined, frameNumber: FrameNumber): LapStep => {
  if (!mark || car.timing.lap < mark.lap) return 'first';
  if (car.timing.lap === mark.lap) return pushOpened(activity, frameNumber) ? 'restart' : 'same';
  return 'next';
};

/** The mark of a lap that begins on this frame; the activity marks it on this frame and every later one (`markActivity`). */
export const lapMarkOf = (car: LiveCar): LapMark => ({ lap: car.timing.lap, pitted: false, outLap: false });

/** The activity's marks on the lap: a pit entry opened on this frame makes it the in lap, an open `outLap` span the out lap. */
export const markActivity = (mark: LapMark | undefined, activity: SituationSpan | undefined, frameNumber: FrameNumber): void => {
  if (!mark) return;
  if (pitEntryOpened(activity, frameNumber)) mark.pitted = true;
  if (activity?.kind === 'outLap') mark.outLap = true;
};
