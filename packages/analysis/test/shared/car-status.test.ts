// The shared car-status reads (`shared/car-status.ts`, contract C17, C20, C43): a unit reads whether a car is in the
// session or competes from car-status's open span, never from `car.active` or the game's result status.
import { carId, known, unknown, type OpenSpan } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { UndeclaredReadError } from '../../../engine/test/support/guarded-input.ts';
import { engineView } from '../../../../test-support/builders/index.ts';
import { CAR_STATUS_READS, carStatusKind, competing, inSession } from '../../src/shared/car-status.ts';

/** An open car-status span of car `car`, since `start`. */
const status = (car: number, kind: string, start = 2_000): OpenSpan => ({
  machine: 'car-status',
  id: 0,
  carId: carId(car),
  kind,
  start,
  confirmed: true,
  detail: kind === 'retired' ? { cause: unknown('notReceived') } : undefined,
  startFrame: 1,
});

/** A race view in which car `i` has the car-status span `kinds[i]` open. */
const viewOf = (...kinds: string[]) =>
  engineView({
    situation: { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: { 'car-status': kinds.map((kind, i) => status(i, kind, 1_000 * (i + 1))) } },
  });

describe('car status', () => {
  const view = viewOf('competing', 'retired', 'disqualified', 'absent');

  it('carStatusKind is the kind of the car span open now, known since it started', () => {
    expect(carStatusKind(view, carId(0))).toEqual(known('competing', 1_000));
    expect(carStatusKind(view, carId(1))).toEqual(known('retired', 2_000));
    expect(carStatusKind(view, carId(3))).toEqual(known('absent', 4_000));
  });

  it('carStatusKind is notReceived while car-status has no span open for the car', () => {
    expect(carStatusKind(view, carId(7))).toEqual(unknown('notReceived'));
    expect(carStatusKind(engineView(), carId(0))).toEqual(unknown('notReceived'));
  });

  it('inSession: any status but absent; not while no span is open', () => {
    expect([0, 1, 2, 3, 7].map((id) => inSession(view, carId(id)))).toEqual([true, true, true, false, false]);
  });

  it('competing: only the status competing', () => {
    expect([0, 1, 2, 3, 7].map((id) => competing(view, carId(id)))).toEqual([true, false, false, false, false]);
  });

  it('reads car-status as spans:car-status (C41)', () => {
    expect(inSession(guardedView(view, [CAR_STATUS_READS]), carId(0))).toBe(true);
    expect(() => competing(guardedView(view, ['timing']), carId(0))).toThrow(UndeclaredReadError);
  });
});
