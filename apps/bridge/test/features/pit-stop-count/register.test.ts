// The `pit-stop-count` feature (M7-R, final review F2; C53, C55, C56): it registers the analysis and binds its output to
// `pitStopCount.byCar` as it is (`bindState`, no select); the stop count left the core topic `cars.overview` (C54).
import { PIT_STOP_COUNT, pitStopCountCalculator } from '@pitwall/analysis';
import { TOPICS } from '@pitwall/contracts';
import { describe, expect, it } from 'vitest';
import type { TopicBinding } from '../../../src/features/feature.ts';
import pitStopCount from '../../../src/features/pit-stop-count/register.ts';

describe('pit-stop-count feature', () => {
  it('registers the analysis pit-stop-count and binds pitStopCount.byCar to its output, as it is', () => {
    expect(pitStopCount.name).toBe('pit-stop-count');
    expect(pitStopCount.calculators).toEqual([pitStopCountCalculator]);
    expect(pitStopCount.topics).toHaveLength(1);
    const binding = pitStopCount.topics[0] as Extract<TopicBinding, { from: string }>;
    expect(binding).toMatchObject({ topic: 'pitStopCount.byCar', from: PIT_STOP_COUNT });
    expect(binding.select).toBeUndefined();
  });

  it('the topic is owned by the analysis (C56)', () => {
    expect(TOPICS['pitStopCount.byCar']).toMatchObject({ owner: 'pit-stop-count', mode: 'state', scope: 'feed' });
  });
});
