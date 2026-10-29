import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
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

  it('names the leader average with the reference lap time', () => {
    expect(referenceText({ kind: 'leaderAverage' }, known(105_123, at), code)).toBe('ref leader avg 1:45.123');
  });

  it('names a car average with the car code', () => {
    expect(referenceText({ kind: 'carAverage', carId: carId(5) }, known(106_000, at), code)).toBe('ref LEC avg 1:46.000');
  });

  it('names a fixed reference with its own lap time', () => {
    expect(referenceText({ kind: 'fixed', lapMs: 100_000 }, known(100_000, at), code)).toBe('ref fixed 1:40.000');
    expect(referenceText({ kind: 'fixed', lapMs: 100_000 }, unknown('insufficientData'), code)).toBe('ref fixed 1:40.000');
  });

  it('shows -- for an unknown lap time of a car or leader average', () => {
    expect(referenceText({ kind: 'leaderAverage' }, unknown('insufficientData'), code)).toBe('ref leader avg --');
    expect(referenceText({ kind: 'carAverage', carId: carId(5) }, unknown('insufficientData'), code)).toBe('ref LEC avg --');
  });
});
