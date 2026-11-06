// SP4.1a f34 (F3, C43, C60): a stored session carries the teammate the engine placed (`live.teammateCar`: the active
// same-team slot that is not the player), the newest of the session's run, `null` when the engine placed none. Storage
// takes it from the engine's state; no rule of the bridge over the slots' teams decides it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { ArraySource } from '../helpers/array-source.ts';

const F = 'test' as FeedId;

/** Runs `builder`'s session through a live pipeline with storage and returns the stored rows of its weekend. */
async function storedRows(builder: ScenarioBuilder) {
  const packets = builder.frames(40, () => {}).packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'stored-teammate-')), 'live.db'));
  const pipeline = new FeedPipeline({
    feedId: F,
    source: new ArraySource(F, packets),
    hub: new TopicHub({ now: () => 0 }),
    features: [],
    log: createLogger({ level: 'silent' }),
    storage: { db, rulesVersion: 'unversioned' },
  });
  pipeline.start();
  await pipeline.done;
  const repo = new WeekendRepository(db);
  const weekend = repo.newestWeekendId();
  expect(weekend).toBeDefined();
  return repo.sessionsOf(weekend!);
}

describe('FeedPipeline: the stored teammate', () => {
  it('a stored session records the teammate the engine placed', async () => {
    // Player 0 (team 0); car 1 of another team; cars 2 and 3 of team 0, car 3 in a slot the session does not use
    // (numActiveCars 3): the engine places car 2, the active same-team slot.
    const placed = await storedRows(new ScenarioBuilder({ sessionUid: 77n, cars: 4 }).session()
      .participants({ numActiveCars: 3, participants: { 1: { teamId: 5 }, 2: { teamId: 0 }, 3: { teamId: 0 } } }));
    expect(placed).toEqual([expect.objectContaining({ sessionUid: '77', playerCar: 0, teammateCar: 2, complete: true })]);
  });

  it('a stored session the engine placed no teammate in records none', async () => {
    // The only other slot of team 0 (car 3) is not in use (numActiveCars 3): no teammate, whatever the slots' teams.
    const alone = await storedRows(new ScenarioBuilder({ sessionUid: 78n, cars: 4 }).session()
      .participants({ numActiveCars: 3, participants: { 1: { teamId: 5 }, 2: { teamId: 6 }, 3: { teamId: 0 } } }));
    expect(alone).toEqual([expect.objectContaining({ sessionUid: '78', playerCar: 0, teammateCar: null, complete: true })]);
  });
});
