import { ALARMS_CONFIG, alarmsCalculator, ALARMS } from '@pitwall/analysis';
import { describe, expect, it } from 'vitest';
import alarms from '../../../src/features/alarms/register.ts';

describe('alarms feature', () => {
  it('registers the calculator and its config and binds no topic of its own', () => {
    expect(alarms.name).toBe('alarms');
    expect(alarms.calculators.map((c) => c.id)).toEqual([ALARMS]);
    expect(alarms.calculators).toContain(alarmsCalculator);
    expect(alarms.config).toEqual([ALARMS_CONFIG]);
    expect(alarms.topics).toEqual([]);
  });
});
