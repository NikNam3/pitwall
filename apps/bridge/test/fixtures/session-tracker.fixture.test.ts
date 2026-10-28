import { expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { trackFixture } from './replay.ts';

const started = (r: Awaited<ReturnType<typeof trackFixture>>) => r.lifecycle.filter((e) => e.type === 'sessionStarted').map((e) => e.sessionUid);

describeWithFixture('menuOnly', 'menu-only recording', () => {
  it('opens no session', async () => {
    const r = await trackFixture('menuOnly');
    expect([r.lifecycle, r.frames]).toEqual([[], 0]);
    expect(r.metrics).toMatchObject({ droppedBeforeSession: 230, droppedUid0: 155 });
  });
});

describeWithFixture('raceSingapore', 'Singapore race', () => {
  it('one session ended by SEND; the UID-0 SessionHistory bulk lands in its last frame', async () => {
    let uid0History = 0;
    const r = await trackFixture('raceSingapore', (f) => {
      uid0History += f.sessionHistory.filter((p) => p.header.sessionUid === 0n).length;
    });
    expect(started(r)).toEqual([0xb3cd07e2790bdcben]);
    expect(r.lifecycle.at(-1)).toEqual({ type: 'sessionEnded', sessionUid: 0xb3cd07e2790bdcben, reason: 'SEND' });
    expect(r.frames).toBe(4139);
    expect(uid0History).toBe(20);
    expect(r.lastFrame!.frameId).toBe(4138);
    expect(r.lastFrame!.sessionHistory.filter((p) => p.header.sessionUid === 0n).map((p) => p.carIdx)).toEqual([...Array(20).keys()]);
    expect(r.lastFrame!.events.at(-1)!.details.code).toBe('SEND');
    expect(r.metrics).toMatchObject({ droppedBeforeSession: 8, droppedUid0: 0, latePackets: 0, incompleteFrames: 2 });
  });
});

describeWithFixture('ttZandvoort', 'Zandvoort time trial', () => {
  it('keeps the UID-0 bulk and the post-SEND FinalClassification; drops the menu afterwards', async () => {
    const r = await trackFixture('ttZandvoort');
    expect(started(r)).toEqual([0x1a4f5531395c7884n]);
    expect(r.lifecycle.at(-1)).toMatchObject({ type: 'sessionEnded', reason: 'SEND' });
    expect(r.frames).toBe(71448);
    expect(r.lastFrame!.sessionHistory.filter((p) => p.header.sessionUid === 0n).map((p) => p.carIdx)).toEqual([...Array(15).keys()]);
    expect(r.lastFrame!.finalClassification).toBeDefined();
    expect(r.metrics).toMatchObject({ droppedBeforeSession: 17, droppedUid0: 94, latePackets: 0 }); // 1 SSTA before; 16 own-UID packets at +10.3 s
  });
});
