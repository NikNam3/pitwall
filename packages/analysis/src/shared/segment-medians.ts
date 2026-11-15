// The median of a segment (mini-sector) over a car's last eligible laps. Eligibility stays with the caller, which knows its spans.
import type { CarId, Ms } from '@pitwall/domain';
import { median } from './stats.ts';

/** The median of a segment is taken over the car's last this many laps that have it... */
export const MEDIAN_LAPS = 5;
/** ...and needs at least this many. */
export const MEDIAN_MIN_LAPS = 3;

/** One car's samples per segment, the newest `MEDIAN_LAPS` of each, oldest first. */
export type CarSegmentSamples = Ms[][];
/** Every car's samples. */
export type SegmentSamples = Map<CarId, CarSegmentSamples>;

/** Folds one eligible sample of a segment into one car's samples. */
export function foldCarSample(car: CarSegmentSamples, segment: number, ms: Ms): void {
  const samples = (car[segment] ??= []);
  samples.push(ms);
  if (samples.length > MEDIAN_LAPS) samples.shift();
}

/** The median of a segment of one car; `'fewLaps'` below `MEDIAN_MIN_LAPS` samples. */
export function carSegmentMedian(car: CarSegmentSamples, segment: number): Ms | 'fewLaps' {
  const samples = car[segment];
  // `MEDIAN_MIN_LAPS` is at least one, so a median exists
  return samples !== undefined && samples.length >= MEDIAN_MIN_LAPS ? (median(samples) as Ms) : 'fewLaps';
}

export function foldSegmentSample(samples: SegmentSamples, carId: CarId, segment: number, ms: Ms): void {
  let car = samples.get(carId);
  if (car === undefined) samples.set(carId, (car = []));
  foldCarSample(car, segment, ms);
}

export function segmentMedian(samples: SegmentSamples, carId: CarId, segment: number): Ms | 'fewLaps' {
  const car = samples.get(carId);
  return car === undefined ? 'fewLaps' : carSegmentMedian(car, segment);
}
