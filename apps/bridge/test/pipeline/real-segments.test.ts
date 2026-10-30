// The real pipeline and features over the committed segments of normal sessions: clean runs, and the topic behaviours
// that need real packets (session info, positions gained, band alarms).
import { describe, expect, it } from 'vitest';
import type { InsightEntry } from '@pitwall/contracts';
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
const BAND_KINDS = new Set(['bandOut', 'bandOutLap']);

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

  // B3: the alarm list flashed "FL brake below band" on and off all lap. Band advisories judge the last completed lap, so
  // after the line a band alarm raises once; an advisory that resolves again within its lap gives way to the critical
  // `bandOutLap` of the same channel at the same moment, it does not flash.
  it('band alarms raise once per key; an advisory resolved within its lap is escalated to bandOutLap at that moment', async () => {
    const r = await replayTopics(segmentPath('race-zandvoort-lap10.pwrec.gz'), [['insights', 'insights', {}]]);
    const entries = r.entries('insights') as InsightEntry[];
    const raises = entries.flatMap((e) => (e.type === 'raised' && BAND_KINDS.has(e.insight.kind) ? [{ key: e.insight.key, at: e.insight.raisedAt }] : []));
    const resolves = entries.flatMap((e) => (e.type === 'resolved' && e.key.startsWith('bandOut') ? [{ key: e.key, at: e.at }] : []));
    expect(raises.length).toBeGreaterThan(0);
    expect(resolves.length).toBeGreaterThan(0);
    const keys = raises.map((e) => e.key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    const escalated = (e: { key: string; at: number }) => raises.some((x) => x.key === e.key.replace(/^bandOut:/, 'bandOutLap:') && x.at === e.at);
    expect(resolves.filter((e) => !e.key.startsWith('bandOut:') || !escalated(e))).toEqual([]);
  });
});
