import { PACE } from '@pitwall/analysis';
import { describe, expect, it } from 'vitest';
import pace from '../../../src/features/pace/register.ts';

describe('pace feature', () => {
  it('registers the pace calculator and binds no topic', () => {
    expect(pace.name).toBe('pace');
    expect(pace.calculators.map((c) => c.id)).toEqual([PACE]);
    expect(pace.topics).toEqual([]);
  });
});
