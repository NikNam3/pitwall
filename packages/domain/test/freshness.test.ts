// What the UI needs for its stale check: the data sources, how often each is expected, and that 'stale' is no
// reason a value can be unknown (the UI decides staleness).
import { describe, expect, expectTypeOf, it } from 'vitest';
import { SOURCE_INTERVAL_MS, unknown, type CarState, type DataSource, type SessionTime, type UnknownReason } from '../src/index.ts';

describe('SOURCE_INTERVAL_MS', () => {
  it('names the menu-rate sources and gives the rest their interval from the F1 25 spec', () => {
    expect(SOURCE_INTERVAL_MS).toEqual({
      lapData: 'menuRate',
      motion: 'menuRate',
      telemetry: 'menuRate',
      status: 'menuRate',
      motionEx: 'menuRate',
      damage: 100,
      setups: 500,
      participants: 5000,
      tyreSets: 1100,
      sessionHistory: 1100,
    });
  });
  it('has one entry per data source', () => {
    expectTypeOf(SOURCE_INTERVAL_MS).toEqualTypeOf<Record<DataSource, number | 'menuRate'>>();
    expectTypeOf<DataSource>().toEqualTypeOf<
      'lapData' | 'motion' | 'telemetry' | 'status' | 'motionEx' | 'damage' | 'tyreSets' | 'sessionHistory' | 'participants' | 'setups'
    >();
    expect(Object.keys(SOURCE_INTERVAL_MS)).toHaveLength(10);
  });
});

describe('CarState.updatedAt', () => {
  it('maps a data source to the session time of its last update', () => {
    expectTypeOf<CarState['updatedAt']>().toEqualTypeOf<Partial<Record<DataSource, SessionTime>>>();
  });
});

describe('UnknownReason', () => {
  it('no longer accepts "stale"', () => {
    expectTypeOf<UnknownReason>().toEqualTypeOf<'restricted' | 'notReceived' | 'notApplicable' | 'realism'>();
    // @ts-expect-error 'stale' is no UnknownReason: the UI decides when a value is too old
    const reason: UnknownReason = 'stale';
    // @ts-expect-error nothing can make a value unknown('stale')
    const value = unknown('stale');
    void [reason, value];
  });
});
