// The median of a segment (mini-sector) over a car's last eligible laps. Eligibility stays with the caller, which knows its spans.
import type { CarId, Ms } from '@pitwall/domain';

/** The median of a segment is taken over the car's last this many laps that have it... */
export const MEDIAN_LAPS = 5;
/** ...and needs at least this many. */
export const MEDIAN_MIN_LAPS = 3;

/** One car's samples per segment, the newest `MEDIAN_LAPS` of each, oldest first. */
export type CarSegmentSamples = Ms[][];
/** Every car's samples. */
export type SegmentSamples = Map<CarId, CarSegmentSamples>;

/** The `k`-th smallest of a few values (0-based), by counting; no sorted copy, since it runs for every mini-sector. */
const kth = (values: readonly Ms[], k: number): Ms => {
  for (const v of values) {
    let less = 0;
    let lessOrEqual = 0;
    for (const w of values) {
      if (w < v) less++;
      if (w <= v) lessOrEqual++;
    }
    if (less <= k && k < lessOrEqual) return v;
  }
  return NaN;
};

const median = (values: readonly Ms[]): Ms => {
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? kth(values, mid) : (kth(values, mid - 1) + kth(values, mid)) / 2;
};

/** Folds one eligible sample of a segment into one car's samples. */
export function foldCarSample(car: CarSegmentSamples, segment: number, ms: Ms): void {
  const samples = (car[segment] ??= []);
  samples.push(ms);
  if (samples.length > MEDIAN_LAPS) samples.shift();
}

/** The median of a segment of one car; `'fewLaps'` below `MEDIAN_MIN_LAPS` samples. */
export function carSegmentMedian(car: CarSegmentSamples, segment: number): Ms | 'fewLaps' {
  const samples = car[segment];
  return samples !== undefined && samples.length >= MEDIAN_MIN_LAPS ? median(samples) : 'fewLaps';
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
