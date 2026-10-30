// The reference line of the gap chart. Contract (wave 2 T6, review RU8): `referenceText` returns the line's parts in
// order, a known part `{ text }` and an unknown part `{ reason }`; the display joins them with one space and shows the
// unknown mark (with the reason on hover) at the unknown part's place, so the mark sits where the value is missing.
import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown, type CarId, type Known, type UnknownReason } from '@pitwall/domain';
import type { CarCodeCell } from '../../kit/car/car-label.ts';
import { referenceText } from './text.ts';

type Kind = 'leaderAverage' | 'carAverage' | 'fixed';

describe('referenceText', () => {
  const at = toSessionTime(0);
  const code = (id: number): CarCodeCell => (id === 5 ? { text: 'LEC' } : { text: '', reason: 'notReceived' });
  const none = unknown('notApplicable');
  const partsOf = (kind: Kind, car: Known<CarId>, lap: Known<number>): Array<{ text: string } | { reason: UnknownReason }> =>
    referenceText({ reference: { kind, carId: car }, referenceLapMs: lap }, code);
  /** The line as the display shows it: the parts joined by a space, an unknown part as `[reason]`. */
  const line = (kind: Kind, car: Known<CarId>, lap: Known<number>): string =>
    partsOf(kind, car, lap).map((p) => ('reason' in p ? `[${p.reason}]` : p.text)).join(' ');

  it('names the leader average with the reference lap time', () => {
    expect(line('leaderAverage', none, known(105_123, at))).toBe('ref leader avg 1:45.123');
  });

  it('names a car average with the car code of the car the gapper used', () => {
    expect(line('carAverage', known(carId(5), at), known(106_000, at))).toBe('ref LEC avg 1:46.000');
  });

  it('names a fixed reference with the lap time the gapper used', () => {
    expect(line('fixed', none, known(100_000, at))).toBe('ref fixed 1:40.000');
  });

  it('puts an unknown lap time where the lap time goes, with its reason', () => {
    expect(line('leaderAverage', none, unknown('insufficientData'))).toBe('ref leader avg [insufficientData]');
    expect(line('carAverage', known(carId(5), at), unknown('insufficientData'))).toBe('ref LEC avg [insufficientData]');
  });

  it('puts the unknown code of a car the field lacks where the code goes, before the known lap time', () => {
    expect(line('carAverage', known(carId(9), at), known(106_000, at))).toBe('ref [notReceived] avg 1:46.000');
  });

  it('shows each unknown part at its own place when both are unknown', () => {
    expect(line('carAverage', known(carId(9), at), unknown('insufficientData'))).toBe('ref [notReceived] avg [insufficientData]');
  });

  it('has no unknown part when everything is known', () => {
    expect(partsOf('leaderAverage', none, known(105_123, at)).filter((p) => 'reason' in p)).toEqual([]);
    expect(partsOf('carAverage', known(carId(5), at), known(106_000, at)).filter((p) => 'reason' in p)).toEqual([]);
  });
});
