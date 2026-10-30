// SessionTracker on real packets: sessions open and end, and the UID-0 packets the game sends around a session's end
// join its last frame (spec 5.3).
import { describe, expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { segmentPath, trackFile, trackFixture, type TrackedFixture } from './replay.ts';

const started = (r: TrackedFixture) => r.lifecycle.filter((e) => e.type === 'sessionStarted').map((e) => e.sessionUid);
const uid0History = (r: TrackedFixture) => r.lastFrame!.sessionHistory.filter((p) => p.header.sessionUid === 0n).map((p) => p.carIdx);

describeWithFixture('menuOnly', 'menu-only recording', () => {
  it('opens no session', async () => {
    const r = await trackFixture('menuOnly');
    expect([r.lifecycle, r.frames]).toEqual([[], 0]);
    expect(r.metrics).toMatchObject({ droppedBeforeSession: 230, droppedUid0: 155 });
  });
});

describe('session end on committed segments', () => {
  it('race-singapore-end: SEND ends the session; the UID-0 SessionHistory bulk before it lands in the last frame', async () => {
    let lastFrameTimes: number[] = [];
    const r = await trackFile(segmentPath('race-singapore-end.pwrec.gz'), (f) => {
      lastFrameTimes = [f.sessionTime, f.lapData ? Math.round(f.lapData.header.sessionTime * 1000) : -1];
    });
    expect(started(r)).toEqual([0xb3cd07e2790bdcben]);
    expect(r.lifecycle.at(-1)).toEqual({ type: 'sessionEnded', sessionUid: 0xb3cd07e2790bdcben, reason: 'SEND' });
    expect(uid0History(r)).toEqual([...Array(20).keys()]);
    expect(r.lastFrame!.events.at(-1)!.details.code).toBe('SEND');
    expect(r.metrics).toMatchObject({ droppedUid0: 0, latePackets: 0 });
    // the attached bulk and SEND carry the frame's own time: the last frame's sessionTime is not inflated by them
    expect(lastFrameTimes).toEqual([63_318, 63_318]);
  });

  it('qualifying-singapore-end: keeps the UID-0 bulk before SEND and the SessionHistory and FinalClassification after it', async () => {
    let lastFrameTimes: number[] = [];
    const r = await trackFile(segmentPath('qualifying-singapore-end.pwrec.gz'), (f) => {
      lastFrameTimes = [f.sessionTime, f.lapData ? Math.round(f.lapData.header.sessionTime * 1000) : -1];
    });
    expect(started(r)).toEqual([15181744301848451228n]);
    expect(r.lifecycle.at(-1)).toMatchObject({ type: 'sessionEnded', reason: 'SEND' });
    expect(uid0History(r)).toEqual([...Array(15).keys()]);
    const own = r.lastFrame!.sessionHistory.filter((p) => p.header.sessionUid !== 0n).map((p) => p.carIdx);
    expect(own).toEqual(expect.arrayContaining([...Array(15).keys()]));
    expect(r.lastFrame!.finalClassification).toMatchObject({ numCars: 15 });
    expect(r.metrics).toMatchObject({ droppedUid0: 0, latePackets: 0 });
    expect(lastFrameTimes).toEqual([900_594, 900_594]);
  });

  // User ruling 2026-10-30: once our driver has retired there is nothing left to engineer, so the bulks of a session
  // the game simulates to its end without SEND are not kept.
  it('race-zandvoort-retire: without SEND the UID-0 SessionHistory and FinalClassification bulks are dropped', async () => {
    const r = await trackFile(segmentPath('race-zandvoort-retire.pwrec.gz'));
    expect(started(r)).toEqual([13536157633115227668n]);
    expect(r.lastFrame!.finalClassification).toBeUndefined();
    expect(uid0History(r)).toEqual([]);
    expect(r.metrics.droppedUid0).toBeGreaterThan(0);
  });
});
