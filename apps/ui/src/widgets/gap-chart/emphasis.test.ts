import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown, type CarId, type Known } from '@pitwall/domain';
import { lineRole } from './emphasis.ts';
import { referenceText } from './text.ts';

describe('lineRole', () => {
  const ours = new Set([carId(0), carId(1)]);

  it('is ownCar for the player car', () => {
    expect(lineRole(carId(0), ours)).toBe('ownCar');
  });

  it('is ownCar for the teammate too (the dash is the series\' business, not the role\'s)', () => {
    expect(lineRole(carId(1), ours)).toBe('ownCar');
  });

  it('is undefined for another car: its colour is the team colour', () => {
    expect(lineRole(carId(7), ours)).toBeUndefined();
  });

  it('is undefined for every car when none is ours', () => {
    expect(lineRole(carId(0), new Set())).toBeUndefined();
  });
});

describe('referenceText', () => {
  const at = toSessionTime(0);
  const code = (id: number): string => (id === 5 ? 'LEC' : `#${id}`);
  const none = unknown('notApplicable');
  const text = (kind: 'leaderAverage' | 'carAverage' | 'fixed', car: Known<CarId>, lap: Known<number>) =>
    referenceText({ reference: { kind, carId: car }, referenceLapMs: lap }, code);

  it('names the leader average with the reference lap time', () => {
    expect(text('leaderAverage', none, known(105_123, at))).toBe('ref leader avg 1:45.123');
  });

  it('names a car average with the car code of the car the gapper used', () => {
    expect(text('carAverage', known(carId(5), at), known(106_000, at))).toBe('ref LEC avg 1:46.000');
  });

  it('names a fixed reference with the lap time the gapper used', () => {
    expect(text('fixed', none, known(100_000, at))).toBe('ref fixed 1:40.000');
  });

  it('shows -- for an unknown lap time of a car or leader average', () => {
    expect(text('leaderAverage', none, unknown('insufficientData'))).toBe('ref leader avg --');
    expect(text('carAverage', known(carId(5), at), unknown('insufficientData'))).toBe('ref LEC avg --');
  });
});
