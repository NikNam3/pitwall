// Where a car's lap begins, the one rule for every recorder that needs it (C11: each keeps its own `LapMark`; the laps
// recorder's cursor is one; Task 17's activity spans replace it).
import type { Metres, Ms } from '@pitwall/domain';
import type { LiveCar } from './cars.ts';

/** What a recorder keeps of the lap a car is on to tell where the next begins. */
export type LapMark = {
  lap: number;
  /** The car entered the pits on this lap (in-lap). */
  pitted: boolean;
  /** The lap is an out lap: it began in the pit lane or from the garage, or the car left the pit lane on it. */
  outLap: boolean;
  /** The car's lap distance on the lap's newest LapData frame; negative before the line (an out lap from the garage). */
  lapDistanceM: Metres;
  /** The lap timer on the lap's newest LapData frame; a drop tells the line after an out lap on the same lap number. */
  lapTimeMs: Ms;
};

/**
 * What this frame is for the car's lap: `first` (the first LapData of the car, or a lap number that went down: start over
 * without a lap), `restart` (an out lap that reached the line on the same lap number: the lap begins there), `next` (the
 * lap number went up: the lap completed) or `same`.
 */
export type LapStep = 'first' | 'restart' | 'next' | 'same';

/**
 * The car has not begun its lap on the first frame a recorder sees of it: before the line (lap distance not above 0)
 * or with the lap timer not running (on the grid before the start, in the garage).
 */
export const lapNotBegun = (car: LiveCar): boolean => car.timing.lapDistanceM <= 0 || car.timing.currentLapTimeMs === 0;

/**
 * The car reached the line since the previous frame without the lap number going up: the lap distance went from below 0
 * to at least 0 (an out lap from the garage), it wrapped (a drop of more than half the track), or the lap timer reset.
 */
const crossedLine = (mark: LapMark, car: LiveCar, trackLengthM: number): boolean => {
  const { lapDistanceM, currentLapTimeMs } = car.timing;
  if (mark.lapDistanceM < 0 && lapDistanceM >= 0) return true;
  if (trackLengthM > 0 && mark.lapDistanceM - lapDistanceM > trackLengthM / 2) return true;
  return currentLapTimeMs < mark.lapTimeMs;
};

/**
 * An out lap that crosses the line on track without the lap number going up: in qualifying and practice the lap number
 * does not advance through the garage, so the car leaves it on the lap it then times from the line, and the lap restarts
 * there. In the pit lane (which may pass the line) it does not.
 */
const outLapReachesLine = (mark: LapMark, car: LiveCar, trackLengthM: number): boolean =>
  mark.outLap && car.timing.pitStatus === 'none' && crossedLine(mark, car, trackLengthM);

export const lapStepOf = (mark: LapMark | undefined, car: LiveCar, trackLengthM: number): LapStep => {
  if (!mark || car.timing.lap < mark.lap) return 'first';
  if (car.timing.lap === mark.lap) return outLapReachesLine(mark, car, trackLengthM) ? 'restart' : 'same';
  return 'next';
};

/**
 * The mark of a lap that begins on this frame. Starting in the pit lane, or the first lap from the garage, is an out lap;
 * leaving the pit lane later makes one too. The driver status alone does not: the game turns it from "out lap" only
 * after the line.
 */
export const lapMarkOf = (car: LiveCar, firstLap: boolean): LapMark => ({
  lap: car.timing.lap,
  pitted: false,
  outLap: car.timing.pitStatus !== 'none' || (firstLap && car.timing.driverStatus === 'outLap'),
  lapDistanceM: car.timing.lapDistanceM,
  lapTimeMs: car.timing.currentLapTimeMs,
});

/** The pit lane's marks on the lap: an entry makes it the in lap, an exit the out lap (a pit exit at the line marks the lap it ends). */
export const markPitLane = (mark: LapMark | undefined, pit: { entered: boolean; left: boolean }): void => {
  if (!mark) return;
  if (pit.entered) mark.pitted = true;
  if (pit.left) mark.outLap = true;
};
