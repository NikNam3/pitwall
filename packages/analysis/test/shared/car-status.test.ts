// The shared car-status reads (`shared/car-status.ts`, contract C17, C20, C43): a unit reads whether a car is in the
// session from car-status's open span, never from `car.active` or the game's result status. SP4.3c Task 5 (O7): one
// in-session row set (`IN_SESSION_ROWS`) the units spread into their behaviour tables instead of copying it; the unused
// `carStatusKind`, `inSession` and `competing` are deleted with their tests.
import { carId, carStatusSpans, unknown, type OpenSpan } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { UndeclaredReadError } from '../../../engine/test/support/guarded-input.ts';
import { engineView } from '../../../../test-support/builders/index.ts';
import { CAR_STATUS_READS, carsInSession, IN_SESSION_ROWS } from '../../src/shared/car-status.ts';
import { loadUnitFolders } from '../units.ts';

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

  it('carsInSession: every car with any status but absent, by id ascending; none while no span is open', () => {
    expect(carsInSession(view)).toEqual([0, 1, 2]);
    expect(carsInSession(engineView())).toEqual([]);
  });

  it('reads car-status as spans:car-status (C41)', () => {
    expect(carsInSession(guardedView(view, [CAR_STATUS_READS]))).toEqual([0, 1, 2]);
    expect(() => carsInSession(guardedView(view, ['timing']))).toThrow(UndeclaredReadError);
  });
});

describe('IN_SESSION_ROWS: one in-session row set (SP4.3c Task 5, O7)', () => {
  it('one row per car-status kind: every status but absent is in the session', () => {
    expect(Object.keys(IN_SESSION_ROWS).sort()).toEqual([...carStatusSpans.kinds].sort());
    expect(IN_SESSION_ROWS).toEqual({ competing: { inSession: true }, retired: { inSession: true }, disqualified: { inSession: true }, absent: { inSession: false } });
  });

  /** The units that copied the in-session rows before Task 5 (the plan's list). */
  const COPIERS = ['car-bands', 'damage', 'degradation', 'ers', 'fuel', 'pit-stop-count', 'tyre-life'];

  it('every unit that copied the rows spreads them: each car-status row agrees with IN_SESSION_ROWS', async () => {
    const folders = await loadUnitFolders();
    const problems: string[] = [];
    for (const unit of COPIERS) {
      const rows = folders.find((f) => f.unit === unit)?.table?.[carStatusSpans.machine] as Readonly<Record<string, unknown>> | undefined;
      if (rows === undefined) {
        problems.push(`${unit}: no car-status rows`);
        continue;
      }
      for (const kind of carStatusSpans.kinds) {
        const row = rows[kind] as Record<string, unknown> | undefined;
        if (row?.['inSession'] !== IN_SESSION_ROWS[kind].inSession) problems.push(`${unit} ${kind}: inSession ${String(row?.['inSession'])}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
