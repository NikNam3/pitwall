// The shared behaviour tables (`shared/behaviour.ts`, contract C43, C44): `behaviourFor` gives a unit the rows of the
// spans open now, the session's and the car's, read through `openSpansOf` (a read of `spans:<machine>`, C41).
import { carId, type OpenSpan } from '@pitwall/domain';
import type { ChangeTag } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { UndeclaredReadError } from '../../../engine/test/support/guarded-input.ts';
import { engineView } from '../../../../test-support/builders/index.ts';
import { behaviourFor, type BehaviourTable } from '../../src/shared/behaviour.ts';

/** An open span of `machine` of `kind`, for car `car` when given. */
const open = (machine: string, kind: string, car?: number, zone?: number): OpenSpan => ({
  machine,
  id: 0,
  kind,
  start: 1_000,
  confirmed: true,
  detail: undefined,
  startFrame: 1,
  ...(car !== undefined && { carId: carId(car) }),
  ...(zone !== undefined && { zone }),
});

/** A view whose situation holds these open spans. */
const viewWith = (...spans: OpenSpan[]) => {
  const byMachine: Record<string, OpenSpan[]> = {};
  for (const span of spans) (byMachine[span.machine] ??= []).push(span);
  return engineView({ situation: { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine } });
};

type Row = 'live' | 'frozen' | 'notApplicable' | 'onTrack' | 'inPits' | 'garage' | 'clear' | 'flagged';

const TABLE: BehaviourTable<Row> = {
  'weekend-phase': { practice: 'live', qualifying: 'live', race: 'live', none: 'notApplicable' },
  'session-phase-race': {
    grid: 'frozen',
    formation: 'frozen',
    startLights: 'frozen',
    racing: 'live',
    neutralised: 'frozen',
    suspended: 'frozen',
    finished: 'frozen',
    postSession: 'frozen',
  },
  'car-location': { garage: 'garage', pitLane: 'inPits', track: 'onTrack' },
};

describe('behaviourFor', () => {
  it('gives the rows of the session spans open now, in the order of the table', () => {
    const view = viewWith(open('session-phase-race', 'racing'), open('weekend-phase', 'race'));
    expect(behaviourFor(TABLE, view)).toEqual(['live', 'live']);
  });

  it('gives a car-scoped machine the row of that car only, and none without a car', () => {
    const view = viewWith(open('car-location', 'pitLane', 3), open('car-location', 'track', 4), open('weekend-phase', 'race'));
    expect(behaviourFor(TABLE, view, carId(3))).toEqual(['live', 'inPits']);
    expect(behaviourFor(TABLE, view, carId(4))).toEqual(['live', 'onTrack']);
    expect(behaviourFor(TABLE, view)).toEqual(['live']);
  });

  it('gives a zone-scoped machine the rows of every zone', () => {
    const table: BehaviourTable<Row> = { 'zone-flags': { noFlag: 'clear', green: 'clear', blue: 'clear', yellow: 'flagged', unknown: 'clear' } };
    const view = viewWith(open('zone-flags', 'noFlag', undefined, 0), open('zone-flags', 'yellow', undefined, 1));
    expect(behaviourFor(table, view, carId(0))).toEqual(['clear', 'flagged']);
  });

  it('gives a resting kind its row like any other kind', () => {
    expect(behaviourFor(TABLE, viewWith(open('car-location', 'garage', 0)), carId(0))).toEqual(['garage']);
  });

  it('gives the weekend phase none its notApplicable row (C14)', () => {
    expect(behaviourFor(TABLE, viewWith(open('weekend-phase', 'none')))).toEqual(['notApplicable']);
  });

  it('gives no row for a machine with no open span', () => {
    expect(behaviourFor(TABLE, viewWith(), carId(0))).toEqual([]);
  });

  it('throws on a span whose kind has no row, and on a machine without a span declaration (a bug in the table, C3)', () => {
    expect(() => behaviourFor({ 'car-location': { track: 'onTrack' } }, viewWith(open('car-location', 'garage', 0)), carId(0))).toThrow(/no row for car-location garage/);
    expect(() => behaviourFor({ 'no-such-machine': {} }, viewWith())).toThrow(/no-such-machine has no span declaration/);
  });

  it('reads each machine of the table as spans:<machine> (C41)', () => {
    const view = viewWith(open('weekend-phase', 'race'), open('session-phase-race', 'racing'), open('car-location', 'track', 0));
    const reads: ChangeTag[] = ['spans:weekend-phase', 'spans:session-phase-race', 'spans:car-location'];
    const paths: string[] = [];
    expect(behaviourFor(TABLE, guardedView(view, reads, { onRead: (p) => paths.push(p) }), carId(0))).toEqual(['live', 'live', 'onTrack']);
    expect(paths.filter((p) => p.startsWith('situation.byMachine.'))).toEqual(['situation.byMachine.weekend-phase', 'situation.byMachine.session-phase-race', 'situation.byMachine.car-location']);
    expect(() => behaviourFor(TABLE, guardedView(view, reads.slice(1)), carId(0))).toThrow(UndeclaredReadError);
  });
});
