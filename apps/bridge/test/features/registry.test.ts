// apps/bridge/test/features/registry.test.ts
import { describe, expect, it } from 'vitest';
import { TOPICS } from '@pitwall/contracts';
import { CalculatorRegistry } from '@pitwall/engine';
import { FEATURES } from '../../src/features/index.generated.ts';

describe('generated feature set', () => {
  const bindings = FEATURES.flatMap((f) => f.topics);
  it('contains the seven base features in folder order', () => {
    expect(FEATURES.map((f) => f.name)).toEqual(['car-detail', 'car-telemetry', 'cars-overview', 'feed-status', 'history', 'insights', 'session-info']);
  });
  it('calculators form a valid registry and every binding resolves', () => {
    const reg = CalculatorRegistry.build(FEATURES.flatMap((f) => f.calculators));
    for (const b of bindings) if ('from' in b) expect(reg.get(b.from), b.topic).toBeDefined();
  });
  it('binds every feed topic exactly once (global topics are published by the bridge shell, not bound by features)', () => {
    const feedTopics = Object.entries(TOPICS).filter(([, d]) => d.scope === 'feed').map(([name]) => name);
    expect(bindings.map((b) => b.topic).sort()).toEqual(feedTopics.sort());
  });
});
