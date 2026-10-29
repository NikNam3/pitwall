import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown, type CarId, type Known } from '@pitwall/domain';
import type { CarCodeCell } from '../../kit/car/car-label.ts';
import { referenceText } from './text.ts';

describe('referenceText', () => {
  const at = toSessionTime(0);
  const code = (id: number): CarCodeCell => (id === 5 ? { text: 'LEC' } : { text: '', reason: 'notReceived' });
  const none = unknown('notApplicable');
  const text = (kind: 'leaderAverage' | 'carAverage' | 'fixed', car: Known<CarId>, lap: Known<number>) =>
    referenceText({ reference: { kind, carId: car }, referenceLapMs: lap }, code).text;
  const reason = (kind: 'leaderAverage' | 'carAverage' | 'fixed', car: Known<CarId>, lap: Known<number>) =>
    referenceText({ reference: { kind, carId: car }, referenceLapMs: lap }, code).reason;

  it('names the leader average with the reference lap time', () => {
    expect(text('leaderAverage', none, known(105_123, at))).toBe('ref leader avg 1:45.123');
  });

  it('names a car average with the car code of the car the gapper used', () => {
    expect(text('carAverage', known(carId(5), at), known(106_000, at))).toBe('ref LEC avg 1:46.000');
  });

  it('names a fixed reference with the lap time the gapper used', () => {
    expect(text('fixed', none, known(100_000, at))).toBe('ref fixed 1:40.000');
  });

  it('leaves an unknown lap time out, with its reason for the hover', () => {
    expect(text('leaderAverage', none, unknown('insufficientData'))).toBe('ref leader avg');
    expect(reason('leaderAverage', none, unknown('insufficientData'))).toBe('insufficientData');
    expect(text('carAverage', known(carId(5), at), unknown('insufficientData'))).toBe('ref LEC avg');
    expect(reason('leaderAverage', none, known(105_123, at))).toBeUndefined();
  });

  it('names a car average whose car the field lacks "car avg", with the code\'s reason', () => {
    expect(text('carAverage', known(carId(9), at), known(106_000, at))).toBe('ref car avg 1:46.000');
    expect(reason('carAverage', known(carId(9), at), known(106_000, at))).toBe('notReceived');
  });
});
