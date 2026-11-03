// The lap-validity sub-machine (contract C9, C12, C15, C17, C18, C26): per car, `valid` while `currentLapInvalid` is
// clear and `invalid` (detail `{ reason, scope }`) while it is set. The PENA of types 10-15 gives `reason` (its
// infringement) and `scope` (10, 12 this lap; 11, 13 this and the next; 14, 15 this and the previous); a flag with no such
// PENA is `invalid` with scope `this`. The PENA comes on the frame the flag rises (the order the recordings show) or
// a frame before; it waits in the machine's open state (C18). Transition rows: lap-validity.transitions.ts. Segment:
// practice-miami-invalid (PENA 12/7 and the flag on one frame), practice-wing-change (a valid lap throughout).
import { beforeAll, describe, expect, it } from 'vitest';
import { lapValiditySpans, type InvalidLapDetail, type OpenSpan, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/lap-validity/machine.ts';
import { all, events, pena } from '../../support/car-edits.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { flag, invalidation } from './lap-validity.transitions.ts';

type Run = { open: Array<OpenSpan | undefined>; closed: Array<Array<Omit<Span, 'endFrame'>>> };

/** Steps the machine through the frames: car `index`'s open span after each, and the spans each frame closed. */
const run = (builder: ReturnType<typeof inputs>, index = 0): Run => {
  let open = machine.init();
  const result: Run = { open: [], closed: [] };
  for (const input of builder.build()) {
    const step = machine.step(open, input);
    open = step.open;
    result.open.push(machine.openSpans(open).find((s) => s.carId === index));
    result.closed.push(step.closed.filter((s) => s.carId === index));
  }
  return result;
};

describe('lap-validity: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine lap-validity, its spans the car-scoped declaration in domain, applies to every phase', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['lap-validity', lapValiditySpans, 'all']);
    expect(machine.spans.scope).toBe('car');
  });
  it('reads the PENA events and currentLapInvalid, no value and no upstream sub-machine', () => {
    expect(machine.inputs.signals).toEqual(expect.arrayContaining(['events', 'currentLapInvalid']));
    expect([machine.inputs.values, machine.inputs.upstream]).toEqual([[], []]);
  });
});

describe('lap-validity: every car slot has a span from the first frame on', () => {
  it('opens valid for every car on the first frame, joined, on frame number 1, one span per car', () => {
    const [first] = inputs().frame().build();
    const spans = machine.openSpans(machine.step(machine.init(), first!).open);
    expect(spans.map((s) => s.carId)).toEqual(first!.signals.cars.map((_, i) => i));
    for (const s of spans) expect([s.machine, s.kind, s.id, s.start, s.startFrame, s.joinedAt, s.confirmed]).toEqual(['lap-validity', 'valid', 0, 0, 1, true, true]);
  });
  it('holds valid while the flag is clear, without closing anything', () => {
    const r = run(inputs().frames(6));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill(['valid', 0]));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('lap-validity: the flag rises, the PENA gives the reason and the scope', () => {
  it('PENA 12/7 and the flag on one frame (MiP): invalid, reason 7, this lap, from the frame of the flag (C26)', () => {
    const r = run(inputs().frames(3).frame(all(invalidation(12, 7), flag(true))).frames(2));
    expect(r.open[3]).toMatchObject({ machine: 'lap-validity', carId: 0, kind: 'invalid', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true, detail: { reason: 7, scope: 'this' } });
    expect(r.open[3]!.joinedAt).toBeUndefined();
    expect(r.open[5]).toEqual(r.open[3]);
    expect(r.closed[3]).toMatchObject([{ kind: 'valid', id: 0, start: 0, end: 3 * FRAME_MS, startFrame: 1 }]);
  });
  const SCOPES: ReadonlyArray<[type: number, scope: InvalidLapDetail['scope']]> = [
    [10, 'this'],
    [11, 'thisAndNext'],
    [12, 'this'],
    [13, 'thisAndNext'],
    [14, 'thisAndPrevious'],
    [15, 'thisAndPrevious'],
  ];
  it.each(SCOPES)('PENA type %i gives the scope %s and the infringement as the reason (the game’s spec, C19)', (type, scope) => {
    const r = run(inputs().frames(2).frame(all(invalidation(type, 26), flag(true))));
    expect(r.open[2]).toMatchObject({ kind: 'invalid', detail: { reason: 26, scope } });
  });
  it('the PENA a frame before the flag: matched when the flag rises, the span opens on the flag’s frame', () => {
    const r = run(inputs().frames(2).frame(invalidation(13, 26)).frame(flag(true)));
    expect(r.open.map((s) => s?.kind)).toEqual(['valid', 'valid', 'valid', 'invalid']);
    expect(r.open[3]).toMatchObject({ startFrame: 4, detail: { reason: 26, scope: 'thisAndNext' } });
  });
  it('a flag with no invalidating PENA (MiR: 5/28 and 4/21 on the frame) is invalid for this lap', () => {
    const r = run(inputs().frames(2).frame(all(events(pena(0, 5, 28), { ...pena(0, 4, 21), timeMs: 3000 }), flag(true))));
    expect(r.open[2]).toMatchObject({ kind: 'invalid', id: 1, startFrame: 3, detail: { scope: 'this' } });
  });
  it('only this car’s PENA counts: another car’s invalidation gives this car no reason or scope', () => {
    const r = run(inputs().frames(2).frame(all(events(pena(1, 13, 26)), flag(true))));
    expect(r.open[2]).toMatchObject({ kind: 'invalid', detail: { scope: 'this' } });
    expect((r.open[2]!.detail as InvalidLapDetail).reason).not.toBe(26);
  });
  it('a PENA with no flag opens nothing: the span follows the flag', () => {
    const r = run(inputs().frames(2).frame(invalidation(12, 7)).frames(20));
    expect(r.open.map((s) => s?.kind)).toEqual(Array(23).fill('valid'));
  });
  it('a PENA is used once: the next invalidation with no PENA does not repeat its reason or scope', () => {
    const r = run(inputs().frames(2).frame(all(invalidation(13, 26), flag(true))).frames(2).frame(flag(false)).frames(2).frame(flag(true)));
    expect(r.open[2]).toMatchObject({ detail: { reason: 26, scope: 'thisAndNext' } });
    expect(r.open[8]).toMatchObject({ kind: 'invalid', detail: { scope: 'this' } });
    expect((r.open[8]!.detail as InvalidLapDetail).reason).not.toBe(26);
  });
});

describe('lap-validity: invalid while the flag is set, valid when it clears', () => {
  it('a "this and next" penalty’s flag that stays set over the next lap is one span; clearing closes it and opens valid (TT 13/26)', () => {
    const r = run(inputs().frames(2).frame(all(invalidation(13, 26), flag(true))).frames(40).frame(flag(false)).frames(2));
    const invalid = r.open[2]!;
    expect(r.open.slice(2, 43).map((s) => s?.id)).toEqual(Array(41).fill(invalid.id));
    expect(r.open[43]).toMatchObject({ kind: 'valid', id: 2, start: 43 * FRAME_MS, startFrame: 44 });
    expect(r.closed[43]).toMatchObject([{ kind: 'invalid', id: 1, start: 2 * FRAME_MS, end: 43 * FRAME_MS, startFrame: 3, detail: { reason: 26, scope: 'thisAndNext' } }]);
    expect(r.open.slice(43).map((s) => s?.kind)).toEqual(['valid', 'valid', 'valid']);
  });
  it('a second invalid lap after the flag cleared is a new span with its own reason', () => {
    const r = run(inputs().frames(2).frame(all(invalidation(12, 7), flag(true))).frame(flag(false)).frames(2).frame(all(invalidation(10, 25), flag(true))));
    expect(r.open[6]).toMatchObject({ kind: 'invalid', id: 3, detail: { reason: 25, scope: 'this' } });
  });
  it('a car’s flag does not touch another car’s spans', () => {
    const r = run(inputs().frames(2).frame(all(invalidation(12, 7), flag(true))).frames(2), 1);
    expect(r.open.map((s) => s?.kind)).toEqual(Array(5).fill('valid'));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('lap-validity: joining a session in progress (C26: the first frame, joinedAt)', () => {
  it('a car whose lap is already invalid opens invalid, joined, scope this, and keeps the span while the flag holds', () => {
    const r = run(inputs().frames(5, flag(true)));
    expect(r.open[0]).toMatchObject({ kind: 'invalid', id: 0, startFrame: 1, joinedAt: true, detail: { scope: 'this' } });
    for (const s of r.open) expect(s).toEqual(r.open[0]);
  });
});

/** Each frame's `currentLapInvalid` of every car. */
const flags = (state: { signals: { cars: ReadonlyArray<{ currentLapInvalid: boolean }> } }): readonly boolean[] => state.signals.cars.map((c) => c.currentLapInvalid);
const spansOf = (seg: SegmentRun<readonly boolean[]>, index: number) =>
  seg.spans('lap-validity').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, detail: s.detail, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }));

describe('lap-validity: practice-miami-invalid (PENA 12/7 and the flag on one frame, the flag set to the segment’s end)', () => {
  let seg: SegmentRun<readonly boolean[]>;
  beforeAll(async () => {
    seg = await replaySegment('practice-miami-invalid.pwrec.gz', flags);
  });
  it('car 19 is valid, then invalid (reason 7, this lap) from the frame the flag rose, to the frame after the last', () => {
    const rise = seg.frames.find((f) => f.value[19])!.frameNumber;
    expect(rise).toBeGreaterThan(1);
    expect(spansOf(seg, 19)).toMatchObject([
      { kind: 'valid', joinedAt: true, startFrame: 1, endFrame: rise },
      { kind: 'invalid', detail: { reason: 7, scope: 'this' }, startFrame: rise, endFrame: seg.frames.at(-1)!.frameNumber + 1 },
    ]);
  });
});

describe('lap-validity: practice-wing-change (a valid lap throughout)', () => {
  it('car 19 is one valid span, joined, for the whole segment', async () => {
    const seg = await replaySegment('practice-wing-change.pwrec.gz', flags);
    expect(spansOf(seg, 19)).toMatchObject([{ kind: 'valid', joinedAt: true, startFrame: 1, endFrame: seg.frames.at(-1)!.frameNumber + 1 }]);
  });
});
