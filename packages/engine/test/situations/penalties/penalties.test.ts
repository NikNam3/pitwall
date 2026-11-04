// The penalties sub-machine (contract C9, C12, C15, C17, C18, C19, C26, C85): per car, race only, one span for what the
// car owes now: `clear`, `timePenalty` (detail `{ totalMs }`), `driveThroughPending` or `stopGoPending` (detail
// `{ driveThroughs, stopGos, infringement, totalMs }`, named after the oldest unserved penalty), a new span on every
// change of what it owes. A pending span opens when the unserved count rises, with the infringement of the PENA (type 0
// or 1) of the same frame or before it, and closes when the count falls; DTSV and SGSV are matched in the open state
// and never open, close or rewrite a span (C18). Transition rows: penalties.transitions.ts. Segment: the drive-through
// of race-drive-through. Stop-gos and a drive-through and a stop-go at once are not yet seen (C19): synthetic.
import { beforeAll, describe, expect, it } from 'vitest';
import { known, penaltiesSpans, unknown, type OpenSpan, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/penalties/machine.ts';
import { all, car, events, pena } from '../../support/car-edits.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { dt, dtPena, dtsv, sg, sgPena, sgsv, time, timePena } from './penalties.transitions.ts';

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
const kinds = (r: Run) => r.open.map((s) => s?.kind);
const pending = (driveThroughs: number, stopGos: number, infringement: object, totalMs = 0) => ({ driveThroughs, stopGos, infringement, totalMs });

describe('penalties: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine penalties, its spans the car-scoped declaration in domain, race only', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['penalties', penaltiesSpans, ['race']]);
    expect(machine.spans.scope).toBe('car');
  });
  it('reads the events, the unserved counts and the time penalties, no value, and weekend-phase upstream (C14, C15)', () => {
    expect(machine.inputs.signals).toEqual(expect.arrayContaining(['events', 'unservedDriveThroughs', 'unservedStopGos', 'timePenaltyMs']));
    expect([machine.inputs.values, machine.inputs.upstream]).toEqual([[], ['weekend-phase']]);
  });
});

describe('penalties: every car slot has a span from the first frame on', () => {
  it('opens clear for every car on the first frame, joined, frame number 1, one span per car', () => {
    const [first] = inputs().frame().build();
    const spans = machine.openSpans(machine.step(machine.init(), first!).open);
    expect(spans.map((s) => s.carId)).toEqual(first!.signals.cars.map((_, i) => i));
    for (const s of spans) expect([s.machine, s.kind, s.id, s.start, s.startFrame, s.joinedAt, s.confirmed]).toEqual(['penalties', 'clear', 0, 0, 1, true, true]);
  });
  it('holds clear while nothing is owed, closing nothing', () => {
    const r = run(inputs().frames(6));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill(['clear', 0]));
    expect(r.closed.flat()).toEqual([]);
  });
  it('a PENA with no count (a warning, a grid penalty, a PENA 0 or 1 with no rise) and shouldServePenalty alone owe nothing', () => {
    const r = run(inputs().frames(2).frame(events(pena(0, 5, 7), pena(0, 2, 1), pena(0, 0, 38), pena(0, 1, 7))).frame(car(0, { shouldServePenalty: true })).frames(30));
    expect(kinds(r)).toEqual(Array(34).fill('clear'));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('penalties: a time penalty', () => {
  it('opens timePenalty with the total when penalties rises, on that frame, closing clear', () => {
    const r = run(inputs().frames(3).frame(timePena()).frame(time(3000)).frames(2));
    expect(r.open[3]).toMatchObject({ kind: 'clear' });
    expect(r.open[4]).toMatchObject({ machine: 'penalties', carId: 0, kind: 'timePenalty', id: 1, start: 4 * FRAME_MS, startFrame: 5, confirmed: true, detail: { totalMs: 3000 } });
    expect(r.open[4]!.joinedAt).toBeUndefined();
    expect(r.open[6]).toEqual(r.open[4]);
    expect(r.closed[4]).toMatchObject([{ kind: 'clear', id: 0, start: 0, end: 4 * FRAME_MS, startFrame: 1 }]);
  });
  it('a further time penalty is a new timePenalty span with the new total', () => {
    const r = run(inputs().frames(2).frame(time(3000)).frames(2).frame(time(8000)));
    expect(r.open[5]).toMatchObject({ kind: 'timePenalty', id: 2, startFrame: 6, detail: { totalMs: 8000 } });
    expect(r.closed[5]).toMatchObject([{ kind: 'timePenalty', id: 1, detail: { totalMs: 3000 } }]);
  });
  it('the total falling to 0 opens clear', () => {
    const r = run(inputs().frames(2).frame(time(3000)).frames(2).frame(time(0)));
    expect(r.open[5]).toMatchObject({ kind: 'clear', id: 2, startFrame: 6 });
    expect(r.closed[5]).toMatchObject([{ kind: 'timePenalty', id: 1, detail: { totalMs: 3000 } }]);
  });
  it('a PENA 4 with no change of penalties owes nothing (the span follows the total)', () => {
    expect(kinds(run(inputs().frames(2).frame(timePena()).frames(20)))).toEqual(Array(23).fill('clear'));
  });
  it('a time penalty of another car is not this car’s', () => {
    const r = run(inputs().frames(2).frame(car(1, { timePenaltyMs: 3000 })).frames(2), 0);
    expect(kinds(r)).toEqual(Array(5).fill('clear'));
    expect(run(inputs().frames(2).frame(car(1, { timePenaltyMs: 3000 })).frames(2), 1).open[2]).toMatchObject({ kind: 'timePenalty', detail: { totalMs: 3000 } });
  });
});

// Migration Task 21 (ruling 1, C3, C13): a timePenalty span names the infringement of the PENA (type 4) that raised the
// total, as a pending span names its PENA's; without one it is unknown('notReceived'), never 0.
describe('penalties: a time penalty names the infringement of the PENA that raised the total', () => {
  const timed = (totalMs: number, infringement: object) => ({ totalMs, infringement });
  it('PENA 4 one frame before the rise (the recorded order): the span names its infringement', () => {
    const r = run(inputs().frames(3).frame(timePena(21)).frame(time(3000)).frames(2));
    expect(r.open[4]).toMatchObject({ kind: 'timePenalty', startFrame: 5 });
    expect(r.open[4]!.detail).toEqual(timed(3000, known(21, 3 * FRAME_MS)));
    expect(r.open[6]).toEqual(r.open[4]);
  });
  it('PENA 4 on the frame of the rise gives the same infringement', () => {
    expect(run(inputs().frames(3).frame(all(timePena(21), time(3000)))).open[3]!.detail).toEqual(timed(3000, known(21, 3 * FRAME_MS)));
  });
  it('a rise with no PENA: the infringement is unknown(notReceived), never 0 (C3)', () => {
    expect(run(inputs().frames(2).frame(time(3000))).open[2]!.detail).toEqual(timed(3000, unknown('notReceived')));
  });
  it('the PENA of another car, or of another type (a warning, a drive-through), is not taken', () => {
    const r = run(inputs().frames(2).frame(all(events(pena(1, 4, 21), pena(0, 5, 7), pena(0, 0, 38)), time(3000))));
    expect(r.open[2]!.detail).toEqual(timed(3000, unknown('notReceived')));
  });
  it('a further time penalty names its own PENA; a PENA is used once: a later rise with no PENA does not repeat it', () => {
    const r = run(inputs().frames(2).frame(timePena(21)).frame(time(3000)).frames(2).frame(timePena(7)).frame(time(8000)).frames(2).frame(time(13000)));
    expect(r.open[3]!.detail).toEqual(timed(3000, known(21, 2 * FRAME_MS)));
    expect(r.open[7]).toMatchObject({ kind: 'timePenalty', id: 2, detail: timed(8000, known(7, 6 * FRAME_MS)) });
    expect(r.open[10]).toMatchObject({ kind: 'timePenalty', id: 3, detail: timed(13000, unknown('notReceived')) });
  });
  it('joined holding time penalties: the infringement is unknown(notReceived)', () => {
    expect(run(inputs().frames(3, time(3000))).open[0]).toMatchObject({ kind: 'timePenalty', joinedAt: true, detail: timed(3000, unknown('notReceived')) });
  });
  it('serving a drive-through while the time penalty stands: timePenalty again, naming the infringement that raised the total', () => {
    const r = run(inputs().frames(2).frame(timePena(21)).frame(time(3000)).frame(dtPena(38)).frame(dt(1)).frames(2).frame(all(dtsv(), dt(0))));
    expect(r.open[3]!.detail).toEqual(timed(3000, known(21, 2 * FRAME_MS)));
    expect(r.open[8]).toMatchObject({ kind: 'timePenalty', startFrame: 9, detail: timed(3000, known(21, 2 * FRAME_MS)) });
  });
});

describe('penalties: a drive-through is pending from the rise of the unserved count', () => {
  it('PENA one frame before the rise (the recorded order): the span opens on the rise with the PENA’s infringement, closing clear', () => {
    const r = run(inputs().frames(3).frame(dtPena(38)).frame(dt(1)).frames(2));
    expect(kinds(r).slice(0, 4)).toEqual(Array(4).fill('clear'));
    expect(r.open[4]).toMatchObject({
      machine: 'penalties',
      carId: 0,
      kind: 'driveThroughPending',
      id: 1,
      start: 4 * FRAME_MS,
      startFrame: 5,
      confirmed: true,
      detail: pending(1, 0, known(38, 3 * FRAME_MS)),
    });
    expect(r.open[6]).toEqual(r.open[4]);
    expect(r.closed[4]).toMatchObject([{ kind: 'clear', id: 0, end: 4 * FRAME_MS }]);
  });
  it('PENA on the frame of the rise, or several frames before it, gives the same infringement', () => {
    expect(run(inputs().frames(3).frame(all(dtPena(38), dt(1)))).open[3]).toMatchObject({ kind: 'driveThroughPending', detail: pending(1, 0, known(38, 3 * FRAME_MS)) });
    expect(run(inputs().frames(3).frame(dtPena(38)).frames(3).frame(dt(1))).open[7]).toMatchObject({ kind: 'driveThroughPending', detail: pending(1, 0, known(38, 3 * FRAME_MS)) });
  });
  it('a rise with no PENA opens the span, the infringement unknown(notReceived), never 0 (C3)', () => {
    expect(run(inputs().frames(2).frame(dt(1))).open[2]).toMatchObject({ kind: 'driveThroughPending', detail: pending(1, 0, unknown('notReceived')) });
  });
  it('the PENA of another car, or of another type, is not taken', () => {
    expect(run(inputs().frames(2).frame(all(events(pena(1, 0, 38), pena(0, 5, 7), pena(0, 4, 21)), dt(1)))).open[2]).toMatchObject({ detail: pending(1, 0, unknown('notReceived')) });
  });
  it('a PENA is used once: a later rise with no PENA does not repeat its infringement', () => {
    const r = run(inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frames(2).frame(dt(2)).frame(dt(1)));
    expect(r.open[3]).toMatchObject({ detail: pending(1, 0, known(38, 2 * FRAME_MS)) });
    expect(r.open[6]).toMatchObject({ kind: 'driveThroughPending', id: 2, detail: pending(2, 0, known(38, 2 * FRAME_MS)) });
    expect(r.open[7]).toMatchObject({ kind: 'driveThroughPending', id: 3, detail: pending(1, 0, unknown('notReceived')) });
  });
  it('a car’s drive-through does not touch another car’s spans', () => {
    const r = run(inputs().frames(2).frame(all(dtPena(38), dt(1))).frames(2), 1);
    expect(kinds(r)).toEqual(Array(5).fill('clear'));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('penalties: serving a drive-through (the count falls; DTSV is matched, never acted on, C18)', () => {
  const base = () => inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frames(3);
  it('the count falls on the frame of DTSV: the span closes there and clear opens', () => {
    const r = run(base().frame(all(dtsv(), dt(0))).frames(2));
    expect(r.open[7]).toMatchObject({ kind: 'clear', id: 2, startFrame: 8 });
    expect(r.closed[7]).toMatchObject([{ kind: 'driveThroughPending', id: 1, start: 3 * FRAME_MS, end: 7 * FRAME_MS, startFrame: 4, confirmed: true, detail: pending(1, 0, known(38, 2 * FRAME_MS)) }]);
  });
  it('DTSV before the count falls: the span stays pending until the count falls, with no new span', () => {
    const r = run(base().frame(dtsv()).frames(3).frame(dt(0)));
    expect(r.open.slice(3, 11).map((s) => [s?.kind, s?.id])).toEqual(Array(8).fill(['driveThroughPending', 1]));
    expect(r.open[11]).toMatchObject({ kind: 'clear', id: 2, startFrame: 12 });
    expect(r.closed.slice(0, 11).flat()).toMatchObject([{ kind: 'clear', id: 0 }]);
  });
  it('the count falls before DTSV: the span closes at the fall; a later DTSV opens and changes nothing', () => {
    const r = run(base().frame(dt(0)).frames(2).frame(dtsv()).frames(2));
    expect(r.open[7]).toMatchObject({ kind: 'clear', id: 2, startFrame: 8 });
    expect(r.open[12]).toEqual(r.open[7]);
    expect(r.closed.slice(8).flat()).toEqual([]);
  });
  it('a DTSV or SGSV of another car, or with nothing owed, changes nothing', () => {
    const r = run(inputs().frames(2).frame(all(dtsv(), sgsv(), dtsv(1))).frames(3));
    expect(kinds(r)).toEqual(Array(6).fill('clear'));
    const p = run(base().frame(dtsv(1)).frames(2));
    expect(p.open.slice(3).map((s) => s?.id)).toEqual(Array(7).fill(1));
  });
  it('no closed span is ever unconfirmed or rewritten: every span a run closes has confirmed true (C18)', () => {
    const r = run(base().frame(all(dtsv(), dt(0))).frames(2).frame(all(dtPena(40), dt(1))).frames(2).frame(dt(0)));
    for (const s of r.closed.flat()) expect(s.confirmed).toBe(true);
    expect(r.closed.flat().map((s) => s.kind)).toEqual(['clear', 'driveThroughPending', 'clear', 'driveThroughPending']);
  });
});

describe('penalties: a time penalty standing while a drive-through is pending', () => {
  it('the pending span carries the total; the time penalty does not close it, a change of the total opens a new pending span', () => {
    const r = run(inputs().frames(2).frame(time(3000)).frame(dtPena(38)).frame(dt(1)).frames(2).frame(time(8000)));
    expect(r.open[2]).toMatchObject({ kind: 'timePenalty' });
    expect(r.open[4]).toMatchObject({ kind: 'driveThroughPending', id: 2, detail: pending(1, 0, known(38, 3 * FRAME_MS), 3000) });
    expect(r.open[7]).toMatchObject({ kind: 'driveThroughPending', id: 3, startFrame: 8, detail: pending(1, 0, known(38, 3 * FRAME_MS), 8000) });
    expect(r.closed[7]).toMatchObject([{ kind: 'driveThroughPending', id: 2, detail: pending(1, 0, known(38, 3 * FRAME_MS), 3000) }]);
  });
  it('serving the drive-through leaves the time penalty: timePenalty with the total, not clear', () => {
    const r = run(inputs().frames(2).frame(time(3000)).frame(dtPena(38)).frame(dt(1)).frames(2).frame(all(dtsv(), dt(0))));
    expect(r.open[7]).toMatchObject({ kind: 'timePenalty', id: 3, startFrame: 8, detail: { totalMs: 3000 } });
  });
  it('the time penalty arriving while the drive-through is pending (PENA 4 and penalties rise) opens a new pending span', () => {
    const r = run(inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frames(2).frame(timePena()).frame(time(5000)));
    expect(r.open[7]).toMatchObject({ kind: 'driveThroughPending', id: 2, detail: pending(1, 0, known(38, 2 * FRAME_MS), 5000) });
  });
});

describe('penalties: two drive-throughs pending (synthetic, C19)', () => {
  const two = () => inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frames(2).frame(dtPena(40)).frame(dt(2)).frames(2);
  it('the second opens a new span with count 2, still named after the oldest: its infringement', () => {
    const r = run(two());
    expect(r.open[3]).toMatchObject({ kind: 'driveThroughPending', id: 1, detail: pending(1, 0, known(38, 2 * FRAME_MS)) });
    expect(r.open[7]).toMatchObject({ kind: 'driveThroughPending', id: 2, startFrame: 8, detail: pending(2, 0, known(38, 2 * FRAME_MS)) });
  });
  it('serving the oldest (count 2 -> 1) opens a pending span of the next one’s infringement, then clear at 0', () => {
    const r = run(two().frame(all(dtsv(), dt(1))).frames(2).frame(all(dtsv(), dt(0))));
    expect(r.open[10]).toMatchObject({ kind: 'driveThroughPending', id: 3, detail: pending(1, 0, known(40, 6 * FRAME_MS)) });
    expect(r.open[13]).toMatchObject({ kind: 'clear', id: 4 });
  });
  it('the count falling before its DTSV and DTSV coming late (one DTSV per drive-through) changes no span', () => {
    const r = run(two().frame(dt(1)).frames(2).frame(dtsv()).frame(dt(0)).frame(dtsv()).frames(2));
    expect(r.open.map((s) => s?.id).filter((_, i) => i >= 10)).toEqual([3, 3, 3, 3, 4, 4, 4, 4]);
  });
});

// Not yet seen (C19): no recording shows a stop-go or a drive-through and a stop-go at once; implemented from the game's
// spec (PENA type 1 stop-go, `numUnservedStopGoPens`, SGSV).
describe('penalties: stop-gos and both kinds at once (not yet seen, C19)', () => {
  it('a stop-go opens stopGoPending with its PENA’s infringement and serves like a drive-through (SGSV)', () => {
    const r = run(inputs().frames(2).frame(sgPena(7)).frame(sg(1)).frames(3).frame(all(sgsv(), sg(0))).frames(2));
    expect(r.open[3]).toMatchObject({ kind: 'stopGoPending', id: 1, startFrame: 4, detail: pending(0, 1, known(7, 2 * FRAME_MS)) });
    expect(r.open[7]).toMatchObject({ kind: 'clear', id: 2, startFrame: 8 });
    expect(r.closed[7]).toMatchObject([{ kind: 'stopGoPending', id: 1, confirmed: true }]);
  });
  it('a drive-through and a stop-go owed at once are one span, named after the oldest, counting both', () => {
    const r = run(inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frame(sgPena(7)).frame(sg(1)).frames(2));
    expect(r.open[3]).toMatchObject({ kind: 'driveThroughPending', id: 1, detail: pending(1, 0, known(38, 2 * FRAME_MS)) });
    expect(r.open[5]).toMatchObject({ kind: 'driveThroughPending', id: 2, startFrame: 6, detail: pending(1, 1, known(38, 2 * FRAME_MS)) });
    expect(r.closed[5]).toMatchObject([{ kind: 'driveThroughPending', id: 1 }]);
  });
  it('serving the older leaves the other: the span is named after the one still owed, with its infringement', () => {
    const r = run(inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frame(sgPena(7)).frame(sg(1)).frames(2).frame(all(dtsv(), dt(0))));
    expect(r.open[8]).toMatchObject({ kind: 'stopGoPending', id: 3, detail: pending(0, 1, known(7, 4 * FRAME_MS)) });
  });
  it('serving the newer leaves the older: still driveThroughPending, the stop-go gone from the counts', () => {
    const r = run(inputs().frames(2).frame(dtPena(38)).frame(dt(1)).frame(sgPena(7)).frame(sg(1)).frames(2).frame(all(sgsv(), sg(0))));
    expect(r.open[8]).toMatchObject({ kind: 'driveThroughPending', id: 3, detail: pending(1, 0, known(38, 2 * FRAME_MS)) });
  });
  it('a rise of both counts on one frame is one span, the drive-through first (the game lists it first)', () => {
    const r = run(inputs().frames(2).frame(all(dt(1), sg(1))).frames(2));
    expect(r.open[2]).toMatchObject({ kind: 'driveThroughPending', id: 1, detail: pending(1, 1, unknown('notReceived')) });
    expect(r.closed[2]).toHaveLength(1);
  });
  it('a penalty type never seen (a grid penalty 2, reminders 3, disqualification 6) with no count owes nothing', () => {
    const r = run(inputs().frames(2).frame(events(pena(0, 2, 1), pena(0, 3, 1), pena(0, 6, 1), pena(0, 99, 1))).frames(5));
    expect(kinds(r)).toEqual(Array(8).fill('clear'));
  });
});

describe('penalties: joining a session in progress (C26: the first frame, joinedAt)', () => {
  it('a car that already owes a drive-through opens driveThroughPending joined, infringement unknown(notReceived), and keeps it while the count holds', () => {
    const r = run(inputs().frames(5, dt(1)));
    expect(r.open[0]).toMatchObject({ kind: 'driveThroughPending', id: 0, startFrame: 1, joinedAt: true, detail: pending(1, 0, unknown('notReceived')) });
    for (const s of r.open) expect(s).toEqual(r.open[0]);
    expect(r.closed.flat()).toEqual([]);
  });
  it('a car that holds time penalties opens timePenalty joined; one that owes a stop-go opens stopGoPending joined', () => {
    expect(run(inputs().frames(3, time(3000))).open[0]).toMatchObject({ kind: 'timePenalty', joinedAt: true, detail: { totalMs: 3000 } });
    expect(run(inputs().frames(3, sg(1))).open[0]).toMatchObject({ kind: 'stopGoPending', joinedAt: true, detail: pending(0, 1, unknown('notReceived')) });
  });
  it('a car joined owing a drive-through is served: the span closes, clear opens, not joined', () => {
    const r = run(inputs().frames(4, dt(1)).frame(all(dtsv(), dt(0))));
    expect(r.open[4]).toMatchObject({ kind: 'clear', id: 1, startFrame: 5 });
    expect(r.open[4]!.joinedAt).toBeUndefined();
  });
});

/** Car `index`'s spans of a segment: kind, detail, the frames it covers; and the frame the car's unserved drive-throughs first reached `count`. */
const spansOf = (run: SegmentRun<readonly number[]>, index: number) =>
  run.spans('penalties').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, detail: s.detail, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }));
const reached = (run: SegmentRun<readonly number[]>, index: number, count: number): number => run.frames.find((f) => f.value[index]! >= count)!.frameNumber;
const unserved = (state: { signals: { cars: ReadonlyArray<{ unservedDriveThroughs: number }> } }): readonly number[] => state.signals.cars.map((c) => c.unservedDriveThroughs);

describe('penalties: race-drive-through (PENA 0/38 of car 19, the count rises one frame later, served outside the segment)', () => {
  let seg: SegmentRun<readonly number[]>;
  beforeAll(async () => {
    seg = await replaySegment('race-drive-through.pwrec.gz', unserved);
  });
  it('car 19 is clear, then driveThroughPending (1, infringement 38) from the frame the count rose to the frame after the last', () => {
    const rise = reached(seg, 19, 1);
    expect(rise).toBeGreaterThan(1);
    expect(spansOf(seg, 19)).toMatchObject([
      { kind: 'clear', joinedAt: true, startFrame: 1, endFrame: rise },
      { kind: 'driveThroughPending', detail: { driveThroughs: 1, stopGos: 0, infringement: { known: true, value: 38 } }, startFrame: rise, endFrame: seg.frames.at(-1)!.frameNumber + 1 },
    ]);
  });
});
