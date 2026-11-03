// The compound-rule sub-machine on a committed segment (contract C14, C17, C26, C84; facts in fixtures/index.json):
// race-singapore-wet-start, a start on wets. Every expected span is read from the segment's own first frame by the
// machine's rule (a car on intermediates or wets is waived), never a fact of the recording.
import { beforeAll, describe, expect, it } from 'vitest';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';

const compoundsOf = (state: { cars: ReadonlyArray<{ tyres: { visualCompound: string } }> }): string[] => state.cars.map((c) => c.tyres.visualCompound);

describe('compound-rule: race-singapore-wet-start (a car on wets from the first frame)', () => {
  let seg: SegmentRun<string[]>;
  beforeAll(async () => {
    seg = await replaySegment('race-singapore-wet-start.pwrec.gz', compoundsOf);
  });

  it('every car on intermediates or wets on the first frame is one waived span, joined, for the whole segment', () => {
    const wet = seg.frames[0]!.value.flatMap((c, i) => (c === 'wet' || c === 'inter' ? [i] : []));
    expect(wet.length).toBeGreaterThan(0);
    const last = seg.frames.at(-1)!.frameNumber;
    for (const index of wet) {
      expect(seg.spans('compound-rule').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }))).toEqual([
        { kind: 'waived', joinedAt: true, startFrame: expect.any(Number), endFrame: last + 1 },
      ]);
    }
    // the weekend phase is decided within the segment's first frames (C14), every car's span opens on the same frame
    const starts = new Set(seg.spans('compound-rule').map((s) => s.startFrame));
    expect(starts.size).toBe(1);
    expect([...starts][0]).toBeLessThan(10);
  });
});
