// apps/bridge/test/features/registry.test.ts
import { describe, expect, it } from 'vitest';
import { TOPICS, type TopicName } from '@pitwall/contracts';
import { CalculatorRegistry } from '@pitwall/engine';
import { FEATURES } from '../../src/features/index.generated.ts';
import { NOT_YET_BOUND } from '../helpers/not-yet-bound.ts';

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
  it('cars.overview is bound live, and no registered calculator has its id (C42, C55)', () => {
    const ids = FEATURES.flatMap((f) => f.calculators).map((c) => c.id as string);
    expect(ids).not.toContain('cars.overview');
    expect(bindings.find((b) => b.topic === 'cars.overview')).toHaveProperty('fromLive');
    expect(bindings.find((b) => b.topic === 'cars.overview')).not.toHaveProperty('from');
  });
  it('binds every feed topic exactly once, core and analysis alike (global topics are published by the bridge shell, replay.status by the ReplayController, calibration.active and config.effective by the feed pipeline; none is bound by features)', () => {
    const published = new Set(['replay.status', 'calibration.active', 'config.effective']);
    const feedTopics = Object.entries(TOPICS).filter(([name, d]) => d.scope === 'feed' && !published.has(name) && !NOT_YET_BOUND.has(name as TopicName)).map(([name]) => name);
    const bound = bindings.map((b) => b.topic);
    expect(new Set(bound).size).toBe(bound.length);
    expect([...bound].sort()).toEqual(feedTopics.sort());
  });
  it('binds an analysis topic only in the feature of its owner (its contract is committed before the feature exists, ADR 0014)', () => {
    for (const f of FEATURES) for (const b of f.topics) if (TOPICS[b.topic].owner !== 'core') expect(TOPICS[b.topic].owner, b.topic).toBe(f.name);
  });
});
