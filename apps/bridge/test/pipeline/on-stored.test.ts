// A live session's end reaches the calibration store (C62a, spec 3.2, ruling R14): once its log is stored complete, the
// pipeline calls `storage.onStored`, which `serve` wires to `recompute('sessionEnd')` (the candidates change).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { ArraySource } from '../helpers/array-source.ts';
import { HookedSource } from '../helpers/hooked-source.ts';

const F = 'test' as FeedId;

describe('FeedPipeline: storage.onStored', () => {
  it('a stored session triggers onStored once', async () => {
    const packets = new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(40, () => {}).packets()
      .map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
    const onStored = vi.fn();
    // while the session runs nothing is stored complete: the session ends with the input
    const callsWhileRunning: number[] = [];
    const source = new HookedSource(new ArraySource(F, packets), { after: () => callsWhileRunning.push(onStored.mock.calls.length) });
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'on-stored-')), 'live.db'));
    const pipeline = new FeedPipeline({
      feedId: F,
      source,
      hub: new TopicHub({ now: () => 0 }),
      features: [],
      log: createLogger({ level: 'silent' }),
      storage: { db, rulesVersion: 'unversioned', onStored },
    });
    pipeline.start();
    await pipeline.done;
    expect(new Set(callsWhileRunning)).toEqual(new Set([0]));
    expect(onStored).toHaveBeenCalledTimes(1);
  });
});
