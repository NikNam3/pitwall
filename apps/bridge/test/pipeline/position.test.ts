// FeedPipeline.position(): where the replay is, for ReplayController (Task 5).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/race-zandvoort-lap10.pwrec.gz');
const F = 'replay' as FeedId;
const pipelineOf = (source: ManualSource | PwrecSource) =>
  new FeedPipeline({ feedId: F, source, hub: new TopicHub({ now: () => performance.now() }), features: FEATURES, log: createLogger({ level: 'silent' }) });

describe('FeedPipeline.position()', () => {
  it('is undefined before any session frame', async () => {
    const source = new ManualSource(F);
    const pipeline = pipelineOf(source);
    pipeline.start();
    expect(pipeline.position()).toBeUndefined();
    await pipeline.stop();
  });
  it('is the newest session time in integer ms and the player lap after a replay, and stays readable once the replay ended', async () => {
    const pipeline = pipelineOf(new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' }));
    pipeline.start();
    await pipeline.done;
    const position = pipeline.position();
    expect(position).toBeDefined();
    expect(Number.isInteger(position!.sessionTimeMs)).toBe(true);
    expect(position!.sessionTimeMs).toBeGreaterThan(30_000);
    expect(Number.isInteger(position!.playerLap)).toBe(true);
    expect(position!.playerLap).toBeGreaterThanOrEqual(1);
  });
  it('only moves forward while a replay runs', async () => {
    let last = -1;
    const source = new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' });
    const pipeline = pipelineOf(source);
    const original = source.start.bind(source);
    source.start = (onPacket) => original((packet) => { onPacket(packet); const t = pipeline.position()?.sessionTimeMs; if (t !== undefined) { expect(t).toBeGreaterThanOrEqual(last); last = t; } });
    pipeline.start();
    await pipeline.done;
    expect(last).toBeGreaterThan(0);
  });
});
