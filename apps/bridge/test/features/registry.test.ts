// apps/bridge/test/features/registry.test.ts
import { describe, expect, it } from 'vitest';
import { TOPICS } from '@pitwall/contracts';
import { CalculatorRegistry } from '@pitwall/engine';
import { FEATURES } from '../../src/features/index.generated.ts';

describe('generated feature set', () => {
  const bindings = FEATURES.flatMap((f) => f.topics);
  it('contains every base feature, in folder order', () => {
    const names = FEATURES.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['car-detail', 'car-telemetry', 'cars-overview', 'feed-status', 'history', 'insights', 'realism', 'session-info']));
    expect(names).toEqual([...names].sort());
  });
  it('calculators form a valid registry and every binding resolves', () => {
    const reg = CalculatorRegistry.build(FEATURES.flatMap((f) => f.calculators));
    for (const b of bindings) if ('from' in b) expect(reg.get(b.from), b.topic).toBeDefined();
  });
  it('binds every feed topic exactly once, core and analysis alike (global topics are published by the bridge shell, replay.status by the ReplayController; neither is bound by features)', () => {
    const feedTopics = Object.entries(TOPICS).filter(([name, d]) => d.scope === 'feed' && name !== 'replay.status').map(([name]) => name);
    const bound = bindings.map((b) => b.topic);
    expect(new Set(bound).size).toBe(bound.length);
    expect([...bound].sort()).toEqual(feedTopics.sort());
  });
  it('binds an analysis topic only in the feature of its owner (its contract is committed before the feature exists, ADR 0014)', () => {
    for (const f of FEATURES) for (const b of f.topics) if (TOPICS[b.topic].owner !== 'core') expect(TOPICS[b.topic].owner, b.topic).toBe(f.name);
  });
});
