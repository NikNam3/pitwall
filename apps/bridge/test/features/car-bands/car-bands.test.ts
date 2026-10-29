import { describe, expect, it } from 'vitest';
import type { CarBands } from '@pitwall/domain';
import { CAR_BANDS, CAR_BANDS_CONFIG, carBandsCalculator } from '@pitwall/analysis';
import type { QuickCalculator } from '@pitwall/engine';
import type { TopicBinding } from '../../../src/features/feature.ts';
import carBandsFeature from '../../../src/features/car-bands/register.ts';
import { carState, engineView } from '../../../../../test-support/builders/index.ts';
import { carId } from '../../../../../packages/domain/src/index.ts';

const binding = carBandsFeature.topics.find((t) => t.topic === 'carBands.car') as Extract<TopicBinding, { from: string }>;
const view = engineView({ cars: [carState({ id: carId(0) }), carState({ id: carId(1) })] });
const output = (carBandsFeature.calculators.find((c) => c.id === CAR_BANDS) as QuickCalculator<Record<number, CarBands>>).compute(view);

describe('car-bands feature', () => {
  it('registers the calculator, its config and the carBands.car topic', () => {
    expect(carBandsFeature.name).toBe('car-bands');
    expect(carBandsFeature.calculators).toContain(carBandsCalculator);
    expect(carBandsFeature.config).toContain(CAR_BANDS_CONFIG);
    expect(binding.from).toBe(CAR_BANDS);
    expect(binding.select).toBeTypeOf('function');
  });

  it('select returns the bands of params.carId', () => {
    expect(binding.select!(output, { carId: 1 })).toEqual(output[1]);
    expect(binding.select!(output, { carId: 0 })).toEqual(output[0]);
  });

  it('select gives undefined for an unknown car or bad params', () => {
    expect(binding.select!(output, { carId: 99 })).toBeUndefined();
    expect(binding.select!(output, { carId: -1 })).toBeUndefined();
    expect(binding.select!(output, { carId: 1.5 })).toBeUndefined();
    expect(binding.select!(output, {})).toBeUndefined();
  });
});
