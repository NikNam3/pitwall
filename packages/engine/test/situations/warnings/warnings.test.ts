// The warnings sub-machine (contract C9, C12, C15, C17, C18, C26): per car, `noWarning` until the first warning and then
// one `warned` span per count, its detail the count and the infringement of the PENA (type 5) that raised it. The span
// opens when `totalWarnings` rises, with the PENA of the same frame or of up to 16 frames before (the order the recordings
// show); the PENA waits in the machine's open state, and no span is ever withdrawn. Transition rows:
// warnings.transitions.ts. Segments: the player's first warning (practice-miami-warning), a warning whose PENA comes 16
// frames before the rise (practice-zandvoort-warning-late), a car that holds warnings when the session is joined
// (practice-wing-change).
import { beforeAll, describe, expect, it } from 'vitest';
import { known, unknown, warningsSpans, type OpenSpan, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/warnings/machine.ts';
import { all, car, events, pena } from '../../support/car-edits.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { total, warning } from './warnings.transitions.ts';

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

describe('warnings: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine warnings, its spans the car-scoped declaration in domain, applies to every phase', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['warnings', warningsSpans, 'all']);
    expect(machine.spans.scope).toBe('car');
  });
  it('reads the PENA events, totalWarnings and cornerCuttingWarnings, no value and no upstream sub-machine', () => {
    expect(machine.inputs.signals).toEqual(expect.arrayContaining(['events', 'totalWarnings', 'cornerCuttingWarnings']));
    expect([machine.inputs.values, machine.inputs.upstream]).toEqual([[], []]);
  });
});

describe('warnings: every car slot has a span from the first frame on', () => {
  it('opens noWarning for every car on the first frame, joined, on frame number 1, one span per car', () => {
    const [first] = inputs().frame().build();
    const spans = machine.openSpans(machine.step(machine.init(), first!).open);
    expect(spans.map((s) => s.carId)).toEqual(first!.signals.cars.map((_, i) => i));
    for (const s of spans) expect([s.machine, s.kind, s.id, s.start, s.startFrame, s.joinedAt, s.confirmed]).toEqual(['warnings', 'noWarning', 0, 0, 1, true, true]);
  });
  it('holds noWarning while totalWarnings is 0, without closing anything', () => {
    const r = run(inputs().frames(6));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill(['noWarning', 0]));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('warnings: a warning opens a warned span when totalWarnings rises', () => {
  it('PENA and rise on one frame: warned with the count and the PENA’s infringement, on the frame of the rise (C26)', () => {
    const r = run(inputs().frames(3).frame(all(warning(7), total(1))).frames(2));
    expect(r.open[3]).toMatchObject({ machine: 'warnings', carId: 0, kind: 'warned', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true, detail: { count: 1, infringement: known(7, 3 * FRAME_MS) } });
    expect(r.open[3]!.joinedAt).toBeUndefined();
    expect(r.open[5]).toEqual(r.open[3]);
  });
  it('closes the noWarning span on that frame, from its first frame up to the rise', () => {
    const r = run(inputs().frames(3).frame(all(warning(7), total(1))));
    expect(r.closed[3]).toMatchObject([{ machine: 'warnings', carId: 0, kind: 'noWarning', id: 0, start: 0, end: 3 * FRAME_MS, startFrame: 1, confirmed: true }]);
  });
  it('the PENA 16 frames before the rise (practice-zandvoort-warning-late): no span until the rise, then its infringement', () => {
    const r = run(inputs().frames(3).frame(warning(10)).frames(15).frame(total(1)));
    expect(r.open.slice(0, 19).map((s) => s?.kind)).toEqual(Array(19).fill('noWarning'));
    expect(r.open[19]).toMatchObject({ kind: 'warned', startFrame: 20, detail: { count: 1, infringement: known(10, 3 * FRAME_MS) } });
  });
  it('the PENA of a collision names each car’s own infringement: the other car’s PENA is not taken', () => {
    const builder = inputs().frames(2).frame(all(events(pena(0, 5, 4, 1), pena(1, 5, 4, 0)), total(1), car(1, { totalWarnings: 1 }))).frame(
      all(events(pena(1, 5, 7)), car(1, { totalWarnings: 2 })),
    );
    const [zero, one] = [run(builder, 0), run(builder, 1)];
    expect(zero.open[2]).toMatchObject({ kind: 'warned', detail: { count: 1, infringement: known(4, 2 * FRAME_MS) } });
    expect(one.open[2]).toMatchObject({ kind: 'warned', detail: { count: 1, infringement: known(4, 2 * FRAME_MS) } });
    expect(one.open[3]).toMatchObject({ kind: 'warned', detail: { count: 2, infringement: known(7, 3 * FRAME_MS) } });
    expect(zero.open[3]).toEqual(zero.open[2]);
  });
  it('only a PENA of type 5 is a warning: a time penalty on the same frame (MiR: 5/28 with 4/21) gives its infringement to nobody', () => {
    const r = run(inputs().frames(2).frame(all(events({ ...pena(0, 4, 21), timeMs: 3000 }, pena(0, 5, 28)), total(1))));
    expect(r.open[2]).toMatchObject({ kind: 'warned', detail: { count: 1, infringement: known(28, 2 * FRAME_MS) } });
  });
  it('a rise with no PENA pending opens the span all the same: the count, and the infringement unknown(notReceived), never 0 (C3)', () => {
    const r = run(inputs().frames(2).frame(total(1)));
    expect(r.open[2]).toMatchObject({ kind: 'warned', id: 1, startFrame: 3, detail: { count: 1, infringement: unknown('notReceived') } });
  });
  it('a PENA of type 5 with no rise opens nothing (the span follows the count)', () => {
    const r = run(inputs().frames(2).frame(warning(7)).frames(30));
    expect(r.open.map((s) => s?.kind)).toEqual(Array(33).fill('noWarning'));
    expect(r.closed.flat()).toEqual([]);
  });
  it('a PENA of another car is not this car’s warning', () => {
    const r = run(inputs().frames(2).frame(all(events(pena(1, 5, 7)), total(1))));
    expect(r.open[2]).toMatchObject({ kind: 'warned', detail: { count: 1, infringement: unknown('notReceived') } });
  });
  it('a PENA is used once: the next rise with no PENA does not repeat its infringement', () => {
    const r = run(inputs().frames(2).frame(all(warning(7), total(1))).frames(3).frame(total(2)));
    expect(r.open[2]).toMatchObject({ detail: { count: 1, infringement: known(7, 2 * FRAME_MS) } });
    expect(r.open[6]).toMatchObject({ kind: 'warned', detail: { count: 2, infringement: unknown('notReceived') } });
  });
});

describe('warnings: one warned span per count', () => {
  it('each further warning closes the span it follows and opens the next, ids counting the car’s spans', () => {
    const r = run(inputs().frames(2).frame(all(warning(7), total(1))).frames(3).frame(all(warning(27), total(2))).frames(2).frame(all(warning(7), total(3))));
    expect(r.open.map((s) => (s ? [s.id, s.kind, (s.detail as { count?: number })?.count] : undefined)).filter((_, i) => [1, 2, 6, 9].includes(i))).toEqual([
      [0, 'noWarning', undefined],
      [1, 'warned', 1],
      [2, 'warned', 2],
      [3, 'warned', 3],
    ]);
    expect(r.closed[6]).toMatchObject([{ kind: 'warned', id: 1, start: 2 * FRAME_MS, end: 6 * FRAME_MS, startFrame: 3, detail: { count: 1, infringement: known(7, 2 * FRAME_MS) } }]);
  });
  it('a car’s warnings do not touch another car’s spans', () => {
    const r = run(inputs().frames(2).frame(all(warning(7), total(1))).frames(2), 1);
    expect(r.open.map((s) => s?.kind)).toEqual(Array(5).fill('noWarning'));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('warnings: any change of the count opens a span with the new count', () => {
  it('a rise of more than 1 opens one warned span with the new count and the latest pending PENA (a rise of 2: PENA 5/7, then 5/27)', () => {
    const r = run(inputs().frames(2).frame(warning(7)).frame(warning(27)).frame(total(2)));
    expect(r.open.slice(4).map((s) => [s?.kind, s?.id])).toEqual([['warned', 1]]);
    expect(r.open[4]).toMatchObject({ startFrame: 5, detail: { count: 2, infringement: known(27, 3 * FRAME_MS) } });
    expect(r.closed[4]).toMatchObject([{ kind: 'noWarning', id: 0 }]);
  });
  // Not yet seen (C19): no recording shows the count falling; implemented from the game's spec (an accumulated count).
  it('a fall to a lower count opens a warned span with it, infringement unknown(notReceived) (not yet seen, C19)', () => {
    const r = run(inputs().frames(2).frame(all(warning(7), total(3))).frames(2).frame(total(2)));
    expect(r.open[2]).toMatchObject({ kind: 'warned', id: 1, detail: { count: 3 } });
    expect(r.open[5]).toMatchObject({ kind: 'warned', id: 2, startFrame: 6, detail: { count: 2, infringement: unknown('notReceived') } });
    expect(r.closed[5]).toMatchObject([{ kind: 'warned', id: 1, detail: { count: 3 } }]);
  });
  it('a fall to 0 opens noWarning (not yet seen, C19)', () => {
    const r = run(inputs().frames(2).frame(all(warning(7), total(1))).frames(2).frame(total(0)));
    expect(r.open[5]).toMatchObject({ kind: 'noWarning', id: 2, startFrame: 6 });
    expect(r.closed[5]).toMatchObject([{ kind: 'warned', id: 1, detail: { count: 1 } }]);
  });
});

describe('warnings: joining a session in progress (C26: the first frame, joinedAt)', () => {
  it('a car that already holds 3 warnings opens warned with count 3, infringement unknown(notReceived), joined, and keeps the span while the count holds', () => {
    const r = run(inputs().frames(5, total(3)));
    expect(r.open[0]).toMatchObject({ kind: 'warned', id: 0, startFrame: 1, joinedAt: true, detail: { count: 3, infringement: unknown('notReceived') } });
    for (const s of r.open) expect(s).toEqual(r.open[0]);
    expect(r.closed.flat()).toEqual([]);
  });
});

/** Car `index`’s spans of a segment: kind, detail, the frames it covers; and the frame totalWarnings of the car first reached `count`. */
const spansOf = (run: SegmentRun<readonly number[]>, index: number) =>
  run.spans('warnings').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, detail: s.detail, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }));
const reached = (run: SegmentRun<readonly number[]>, index: number, count: number): number => run.frames.find((f) => f.value[index]! >= count)!.frameNumber;
const totals = (state: { signals: { cars: ReadonlyArray<{ totalWarnings: number }> } }): readonly number[] => state.signals.cars.map((c) => c.totalWarnings);

describe('warnings: practice-miami-warning (the player’s first warning, PENA 5/7 and the rise on one frame)', () => {
  let seg: SegmentRun<readonly number[]>;
  beforeAll(async () => {
    seg = await replaySegment('practice-miami-warning.pwrec.gz', totals);
  });
  it('car 19 is noWarning, then warned (count 1, infringement 7) from the frame totalWarnings rose, to the frame after the last', () => {
    const rise = reached(seg, 19, 1);
    expect(rise).toBeGreaterThan(1);
    expect(spansOf(seg, 19)).toMatchObject([
      { kind: 'noWarning', joinedAt: true, startFrame: 1, endFrame: rise },
      { kind: 'warned', detail: { count: 1, infringement: { known: true, value: 7 } }, startFrame: rise, endFrame: seg.frames.at(-1)!.frameNumber + 1 },
    ]);
  });
});

describe('warnings: practice-zandvoort-warning-late (the PENA 5/10 of car 1, the rise 16 frames later)', () => {
  let seg: SegmentRun<readonly number[]>;
  beforeAll(async () => {
    seg = await replaySegment('practice-zandvoort-warning-late.pwrec.gz', totals);
  });
  it('car 1 turns warned (count 1, infringement 10) on the frame totalWarnings rose, not on the PENA’s frame', () => {
    const rise = reached(seg, 1, 1);
    expect(spansOf(seg, 1)).toMatchObject([
      { kind: 'noWarning', joinedAt: true, startFrame: 1, endFrame: rise },
      { kind: 'warned', detail: { count: 1, infringement: { known: true, value: 10 } }, startFrame: rise },
    ]);
  });
});

describe('warnings: practice-wing-change (car 19 holds 3 warnings when the segment starts)', () => {
  it('car 19 is one warned span, count 3, joined, for the whole segment', async () => {
    const seg = await replaySegment('practice-wing-change.pwrec.gz', totals);
    expect(spansOf(seg, 19)).toMatchObject([{ kind: 'warned', detail: { count: 3, infringement: unknown('notReceived') }, joinedAt: true, startFrame: 1, endFrame: seg.frames.at(-1)!.frameNumber + 1 }]);
  });
});
