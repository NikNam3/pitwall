// spec 10.2 fixture facts, acceptance criterion 1
import { expect, it } from 'vitest';
import type { CarOverview } from '@pitwall/contracts';
import type { LapRecord, RaceEvent } from '@pitwall/domain';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { trackFixture } from '../fixtures/replay.ts';
import { replayTopics } from './replay-topics.ts';

const SUBS = [
  ['info', 'session.info', {}],
  ['overview', 'cars.overview', {}],
  ['laps', 'laps', {}],
  ['events', 'events', {}],
  ['insights', 'insights', {}],
  ['feed', 'feed.status', {}],
] as const;
type Replay = Awaited<ReturnType<typeof replayTopics>>;
const activeCars = (r: Replay) => (r.value('overview') as CarOverview[]).filter((c) => c.timing.resultStatus !== 'invalid' && c.timing.resultStatus !== 'inactive');
const latestLaps = (r: Replay) => [...new Map((r.entries('laps') as LapRecord[]).map((l) => [`${l.carId}:${l.lapNumber}`, l])).values()];
const kinds = (r: Replay) => (r.entries('events') as RaceEvent[]).reduce<Record<string, number>>((n, e) => ({ ...n, [e.kind]: (n[e.kind] ?? 0) + 1 }), {});
function expectCleanRun(r: Replay) {
  expect(r.errored).toEqual([]);
  expect(JSON.stringify(r.entries('insights'))).not.toContain('calculatorError');
  expect(r.value('feed')).toMatchObject({ decodeErrors: 0 });
}

describeWithFixture('ttZandvoort', 'acceptance: TT Zandvoort', (path) => {
  it('one car, 15 confirmed laps with the recorded times, lap 16 unfinished, no fuel use, FTLP x4', async () => {
    const r = await replayTopics(path, SUBS);
    expectCleanRun(r);
    expect(r.value('info')).toMatchObject({ sessionUid: '1895827638050388100', playerCar: 0, session: { trackId: 26, sessionType: 18, numActiveCars: 1 } });
    expect(activeCars(r).map((c) => c.id)).toEqual([0]);
    const laps = latestLaps(r).filter((l) => l.carId === 0 && l.status === 'confirmed').sort((a, b) => a.lapNumber - b.lapNumber);
    expect(laps.map((l) => l.lapNumber)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect([laps[0]!.lapTimeMs, laps[3]!.lapTimeMs, laps[8]!.lapTimeMs]).toEqual([71_910, 71_081, 73_253]);
    for (const l of laps) {
      expect(Math.abs(l.sectorTimesMs[0] + l.sectorTimesMs[1] + l.sectorTimesMs[2] - l.lapTimeMs), `lap ${l.lapNumber}`).toBeLessThanOrEqual(2);
      expect([l.fuelAtStartKg, l.fuelAtEndKg]).toMatchObject([{ known: true, value: 10 }, { known: true, value: 10 }]);
    }
    expect(latestLaps(r).some((l) => l.lapNumber === 16)).toBe(false);
    expect(kinds(r)).toMatchObject({ fastestLap: 4 });
  });
  it('lap 15 appears in the SessionHistory of the last frame only, where the UID-0 bulk is; the last frame time is not inflated by it', async () => {
    let firstLap15Frame: number | undefined;
    let uid0Car0: { numLaps: number; lap15Ms: number } | undefined;
    let previousTime: number | undefined;
    let timeStep: number | undefined;
    const r = await trackFixture('ttZandvoort', (f) => {
      timeStep = f.sessionTime - (previousTime ?? f.sessionTime);
      previousTime = f.sessionTime;
      for (const p of f.sessionHistory) {
        if (p.carIdx !== 0) continue;
        if (p.lapHistoryData[14]!.lapTimeInMs > 0) firstLap15Frame ??= f.frameId;
        if (p.header.sessionUid === 0n) uid0Car0 = { numLaps: p.numLaps, lap15Ms: p.lapHistoryData[14]!.lapTimeInMs };
      }
    });
    expect(firstLap15Frame).toBe(r.lastFrame!.frameId);
    expect(uid0Car0).toEqual({ numLaps: 16, lap15Ms: 71_626 });
    // in-grace packets are attached to the last frame; they must not push its sessionTime past the frame's own packets
    expect(r.lastFrame!.sessionTime).toBe(1_158_146);
    expect(r.lastFrame!.sessionTime).toBe(Math.round(r.lastFrame!.lapData!.header.sessionTime * 1000));
    expect(timeStep).toBeGreaterThanOrEqual(0);
    expect(timeStep).toBeLessThanOrEqual(100); // one frame step, not a jump
  });
});

describeWithFixture('raceSingapore', 'acceptance: race Singapore', (path) => {
  it('20 cars, the only human at index 19, start lights and race events, no lap completed', async () => {
    const r = await replayTopics(path, SUBS);
    expectCleanRun(r);
    expect(r.value('info')).toMatchObject({ sessionUid: '12956020372289608894', playerCar: 19, session: { trackId: 12, sessionType: 15, numActiveCars: 20 } });
    expect(activeCars(r)).toHaveLength(20);
    expect(activeCars(r).filter((c) => !c.identity.ai).map((c) => c.id)).toEqual([19]);
    expect(kinds(r)).toMatchObject({ startLights: 5, lightsOut: 1, overtake: 39, collision: 4, penalty: 6 });
    expect(r.entries('laps')).toEqual([]);
  });
  it('the final UID-0 SessionHistory bulk (sent just before SEND) belongs to the session', async () => {
    const uid0Cars: number[] = [];
    let lastFrameTimes: number[] = [];
    const r = await trackFixture('raceSingapore', (f) => {
      uid0Cars.push(...f.sessionHistory.filter((p) => p.header.sessionUid === 0n).map((p) => p.carIdx));
      lastFrameTimes = [f.sessionTime, f.lapData ? Math.round(f.lapData.header.sessionTime * 1000) : -1];
    });
    expect(uid0Cars.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(r.metrics.droppedUid0).toBe(0);
    expect(r.lifecycle.filter((e) => e.type === 'sessionStarted')).toHaveLength(1);
    expect(r.lifecycle.at(-1)).toMatchObject({ type: 'sessionEnded', reason: 'SEND' });
    // the attached bulk and SEND carry the frame's own time: the last frame's sessionTime is not inflated
    expect(lastFrameTimes).toEqual([63_318, 63_318]);
  });
});

describeWithFixture('menuOnly', 'acceptance: menu-only recording', (path) => {
  it('opens no session: every packet dropped, no topic values', async () => {
    const r = await trackFixture('menuOnly');
    expect(r.lifecycle).toEqual([]);
    expect(r.frames).toBe(0);
    expect(r.metrics.droppedBeforeSession + r.metrics.droppedUid0).toBe(385);
    const replay = await replayTopics(path, SUBS);
    expect(replay.value('info')).toBeUndefined();
    expect([replay.entries('laps'), replay.entries('events')]).toEqual([[], []]);
  });
});
