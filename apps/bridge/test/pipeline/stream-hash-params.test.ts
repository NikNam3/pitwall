// The determinism hash sees every per-car topic for every car and with every param a select reads (final review 1b,
// Important 1): the player of raceSingapore is car 19, and gaps.gapper and lapTimes.board need more than `carId`.
//
// Each probe binds a value that changes on every run (a counter that outlives the runs) to one car or one param only.
// Two hashes of the same recording differ exactly when the hash subscribed to that car or param.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TopicName } from '@pitwall/contracts';
import { carId, type CarId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { bindState, defineFeature, type TopicBinding } from '../../src/features/feature.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/tt-zandvoort-lap1.pwrec.gz');
const bindAny = bindState as unknown as (topic: TopicName, calc: QuickCalculator<unknown>, select: (out: unknown, params: object) => unknown) => TopicBinding;

/** Counts across runs of the hash, so every run publishes other values. */
let runs = 0;

/** A feature whose calculator changes on every run; `select` decides which subscriptions see the change. */
const probe = (topic: TopicName, select: (n: number, params: Record<string, unknown>) => unknown) => {
  const counter: QuickCalculator<number> = { kind: 'quick', id: `probe-${topic}`, reads: ['session'], cadence: 'sessionChange', compute: () => ++runs };
  return defineFeature({ name: `probe-${topic}`, calculators: [counter], topics: [bindAny(topic, counter, (n, params) => select(n as number, params as Record<string, unknown>))] });
};

const changesTheHash = async (feature: ReturnType<typeof probe>): Promise<boolean> =>
  (await topicStreamHash(SEGMENT, { features: [feature] })) !== (await topicStreamHash(SEGMENT, { features: [feature] }));

describe('topicStreamHash subscribes per car and with every param', () => {
  it('a per-car topic is hashed for car 19, not only car 0', async () => {
    const car19: CarId = carId(19);
    expect(await changesTheHash(probe('battle.cards', (n, p) => (p['carId'] === car19 ? { n } : undefined)))).toBe(true);
  });

  it('lapTimes.board is hashed with a referenceCarId', async () => {
    expect(await changesTheHash(probe('lapTimes.board', (n, p) => (typeof p['referenceCarId'] === 'number' ? { n } : undefined)))).toBe(true);
  });

  it('gaps.gapper is hashed with the leader-average reference', async () => {
    const leaderAverage = (p: Record<string, unknown>) => (p['reference'] as { kind?: unknown } | undefined)?.kind === 'leaderAverage';
    expect(await changesTheHash(probe('gaps.gapper', (n, p) => (leaderAverage(p) ? { n } : undefined)))).toBe(true);
  });

  it('control: a value no subscription selects leaves the hash as it is', async () => {
    expect(await changesTheHash(probe('battle.cards', () => undefined))).toBe(false);
  });
});
