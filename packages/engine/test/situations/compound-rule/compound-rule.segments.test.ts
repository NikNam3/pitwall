// The compound-rule sub-machine on a committed segment (contract C14, C17, C26, C84; facts in fixtures/index.json):
// race-singapore-wet-start, a start on wets. Every expected span is read from the segment's own frames by the machine's
// rule (the waiver counts from the lights out: the frame of the first LGOT, where the race session phase opens `racing`),
// never a fact of the recording.
import { beforeAll, describe, expect, it } from 'vitest';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';

type Seen = { compounds: string[]; lightsOut: boolean };
const seenOf = (state: { cars: ReadonlyArray<{ tyres: { visualCompound: string } }>; signals: { events: ReadonlyArray<{ code: string }> } }): Seen => ({
  compounds: state.cars.map((c) => c.tyres.visualCompound),
  lightsOut: state.signals.events.some((e) => e.code === 'LGOT'),
});

describe('compound-rule: race-singapore-wet-start (every car on wets before and after the lights out)', () => {
  let seg: SegmentRun<Seen>;
  beforeAll(async () => {
    seg = await replaySegment('race-singapore-wet-start.pwrec.gz', seenOf);
  });

  it('a car on intermediates or wets is required (joined) until the lights out, then waived from that frame to the end', () => {
    const wet = seg.frames[0]!.value.compounds.flatMap((c, i) => (c === 'wet' || c === 'inter' ? [i] : []));
    expect(wet.length).toBeGreaterThan(0);
    const lightsOut = seg.frames.find((f) => f.value.lightsOut)!.frameNumber;
    const last = seg.frames.at(-1)!.frameNumber;
    for (const index of wet) {
      expect(seg.spans('compound-rule').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }))).toMatchObject([
        { kind: 'required', joinedAt: true, endFrame: lightsOut },
        { kind: 'waived', startFrame: lightsOut, endFrame: last + 1 },
      ]);
    }
  });
});
