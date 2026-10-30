// The real pipeline and features over the committed segments of normal sessions: clean runs, and the topic behaviours
// that need real packets (session info, positions gained).
import { describe, expect, it } from 'vitest';
import type { Interval } from '@pitwall/domain';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { SEGMENT_FILES, segmentPath } from '../fixtures/replay.ts';
import { replayTopics } from '../helpers/replay-topics.ts';

const SUBS = [
  ['info', 'session.info', {}],
  ['overview', 'cars.overview', {}],
  ['laps', 'laps', {}],
  ['events', 'events', {}],
  ['insights', 'insights', {}],
  ['feed', 'feed.status', {}],
  ['intervals', 'gaps.intervals', {}],
] as const;
type Replay = Awaited<ReturnType<typeof replayTopics>>;

function expectCleanRun(r: Replay) {
  expect(r.errors).toEqual([]);
  expect(r.errored).toEqual([]);
  expect(JSON.stringify(r.entries('insights'))).not.toContain('calculatorError');
  expect(r.value('feed')).toMatchObject({ decodeErrors: 0 });
}

describe('the pipeline over every committed segment', () => {
  it.each(SEGMENT_FILES)('%s: no error, no errored topic, no calculator error, no decode error', async (file) => {
    expectCleanRun(await replayTopics(segmentPath(file), SUBS));
  });
});

describeWithFixture('menuOnly', 'the pipeline over the menu-only recording', (path) => {
  it('opens no session: no topic values', async () => {
    const r = await replayTopics(path, SUBS);
    expectCleanRun(r);
    expect(r.value('info')).toBeUndefined();
    expect([r.entries('laps'), r.entries('events')]).toEqual([[], []]);
  });
});

describe('race-zandvoort-lap10 through the pipeline', () => {
  it('session.info names the session and the player; positions gained are known and net to zero over the field', async () => {
    const r = await replayTopics(segmentPath('race-zandvoort-lap10.pwrec.gz'), SUBS);
    expect(r.value('info')).toMatchObject({ sessionUid: '13536157633115227668', playerCar: 1, session: { trackId: 26, sessionType: 15, numActiveCars: 20 } });
    const gained = (r.value('intervals') as Interval[]).map((i) => i.positionsGained);
    expect(gained).toHaveLength(20);
    expect(gained.every((g) => g.known)).toBe(true);
    expect(gained.reduce((sum, g) => sum + (g.known ? g.value : 0), 0)).toBe(0);
  });
});
