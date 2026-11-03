// The race's race-control sub-machine on a committed segment (contract C14, C26, C84; facts in fixtures/index.json):
// race-zandvoort-vsc, cut mid-race (no lights out in it), holds one DRSD. Every expected frame is read from the segment's
// own frames by the machine's rule (the first frame, the frame of the first DRSD event), never a fact of the recording.
import { beforeAll, describe, expect, it } from 'vitest';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';

const MACHINE = 'race-control-race';
/** The reasons of the DRSD events each frame carried. */
const drsdOf = (state: { signals: { events: ReadonlyArray<{ code: string; reason?: string }> } }): string[] =>
  state.signals.events.flatMap((e) => (e.code === 'DRSD' ? [e.reason ?? 'none'] : []));

describe('race-control-race: race-zandvoort-vsc (joined mid-race; the DRSD of the VSC deployment)', () => {
  let seg: SegmentRun<string[]>;
  beforeAll(async () => {
    seg = await replaySegment('race-zandvoort-vsc.pwrec.gz', drsdOf);
  });

  it('DRS is on from the first frame the weekend phase is decided (C14; joined, no lights out in the segment) up to the frame of the DRSD, then off with that DRSD’s reason to the end', () => {
    const first = seg.frames.find((f) => f.value.length > 0)!;
    expect(first.frameNumber).toBeGreaterThan(1);
    const last = seg.frames.at(-1)!.frameNumber;
    expect(seg.spans(MACHINE).map((s) => ({ kind: s.kind, detail: s.detail, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }))).toMatchObject([
      { kind: 'drsOn', joinedAt: true, endFrame: first.frameNumber },
      { kind: 'drsOff', detail: { reason: first.value[0] }, startFrame: first.frameNumber, endFrame: last + 1 },
    ]);
  });
  it('the span list has no gap: two spans, the second opens on the frame the first closed on', () => {
    const [a, b, ...rest] = seg.spans(MACHINE);
    expect(rest).toEqual([]);
    expect(b!.startFrame).toBe(a!.endFrame);
  });
});
