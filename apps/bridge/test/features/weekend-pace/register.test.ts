// The `weekend-pace` feature (SP4.3d2 Task 6b; C42, C47, C63): a calculator other units read (no topic, C42), with its
// config section (`minLongRunLaps`, `raceTrimOffsetMs`, `qualifyingPaceSdMs`, C47).
import { describe, expect, it } from 'vitest';
import weekendPace from '../../../src/features/weekend-pace/register.ts';

describe('weekend-pace feature', () => {
  it('registers the calculator weekend-pace, no topic', () => {
    expect(weekendPace.name).toBe('weekend-pace');
    expect(weekendPace.calculators.map((c) => c.id)).toEqual(['weekend-pace']);
    expect(weekendPace.topics).toEqual([]);
  });

  it('registers its config section with minLongRunLaps, raceTrimOffsetMs, qualifyingPaceSdMs and noPaceStandInOffsetMs', () => {
    expect((weekendPace.config ?? []).map((d) => d.key)).toEqual(['weekend-pace']);
    expect(Object.keys(weekendPace.config?.[0]?.defaults ?? {}).sort()).toEqual(['minLongRunLaps', 'noPaceStandInOffsetMs', 'qualifyingPaceSdMs', 'raceTrimOffsetMs']);
  });
});
