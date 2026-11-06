// The `stint-analysis` feature (spec 5): registers the analysis and binds `stintAnalysis.car` per car with `selectCar`
// (C55, C56); a rival's value is the analysis's `notApplicable`.
import { STINT_ANALYSIS, type StintAnalysisOutput } from '@pitwall/analysis';
import { carId, known, unknown } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import stintAnalysis from '../../../src/features/stint-analysis/register.ts';

describe('stint-analysis feature', () => {
  it('registers the analysis and the topic stintAnalysis.car', () => {
    expect(stintAnalysis.name).toBe('stint-analysis');
    expect(stintAnalysis.calculators.map((c) => c.id)).toEqual([STINT_ANALYSIS]);
    expect(stintAnalysis.topics).toHaveLength(1);
    expect(stintAnalysis.topics[0]).toMatchObject({ topic: 'stintAnalysis.car', from: STINT_ANALYSIS });
  });

  it('select returns the value for params.carId: ours known, a rival notApplicable, an unknown car undefined', () => {
    const ours = known({ stints: [], compounds: [] }, 0);
    const out: StintAnalysisOutput = { [carId(0)]: ours, [carId(3)]: unknown('notApplicable') };
    const binding = stintAnalysis.topics[0] as unknown as { select: (out: unknown, params: object) => unknown };
    expect(binding.select(out, { carId: 0 })).toEqual(ours);
    expect(binding.select(out, { carId: 3 })).toEqual(unknown('notApplicable'));
    expect(binding.select(out, { carId: 7 })).toBeUndefined();
    expect(binding.select(out, {})).toBeUndefined();
  });
});
