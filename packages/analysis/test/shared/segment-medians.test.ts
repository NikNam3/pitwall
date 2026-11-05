import { carId, type Ms } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import {
  foldSegmentSample,
  MEDIAN_LAPS,
  MEDIAN_MIN_LAPS,
  segmentMedian,
  type SegmentSamples,
} from '../../src/shared/segment-medians.ts';

const car = carId(3);
// The empty value of `SegmentSamples` is an empty map (per car, per segment).
const empty = (): SegmentSamples => new Map();
const fold = (samples: SegmentSamples, values: number[], who = car, segment = 4) => {
  for (const ms of values) foldSegmentSample(samples, who, segment, ms as Ms);
};
const value = (samples: SegmentSamples, who = car, segment = 4) => segmentMedian(samples, who, segment);

describe('segment medians', () => {
  it('uses the last 5 samples and needs at least 3', () => {
    expect(MEDIAN_LAPS).toBe(5);
    expect(MEDIAN_MIN_LAPS).toBe(3);
  });

  it('is 'fewLaps' with no sample or fewer than 3', () => {
    const samples = empty();
    expect(segmentMedian(samples, car, 4)).toBe('fewLaps');
    fold(samples, [1000, 1100]);
    expect(segmentMedian(samples, car, 4)).toBe('fewLaps');
  });

  it('is a number from the third sample on', () => {
    const samples = empty();
    fold(samples, [1000, 1100, 1200]);
    expect(value(samples)).toBe(1100);
  });

  it('is the middle value for an odd count, whatever the order', () => {
    const samples = empty();
    fold(samples, [1300, 1000, 1200, 1100, 1400]);
    expect(value(samples)).toBe(1200);
  });

  it('is the mean of the two middle values for an even count', () => {
    const samples = empty();
    fold(samples, [1000, 1400, 1200, 1100]);
    expect(value(samples)).toBe(1150);
  });

  it('keeps only the 5 newest samples', () => {
    const samples = empty();
    fold(samples, [9000, 9000, 9000, 1000, 1100, 1200, 1300, 1400]);
    expect(value(samples)).toBe(1200);
  });

  it('keeps cars and segments apart', () => {
    const samples = empty();
    fold(samples, [1000, 1000, 1000], car, 4);
    fold(samples, [2000, 2000, 2000], car, 5);
    fold(samples, [3000, 3000, 3000], carId(7), 4);
    expect(value(samples, car, 4)).toBe(1000);
    expect(value(samples, car, 5)).toBe(2000);
    expect(value(samples, carId(7), 4)).toBe(3000);
    expect(segmentMedian(samples, carId(7), 5)).toBe('fewLaps');
  });
});
