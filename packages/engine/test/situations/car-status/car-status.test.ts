// The car-status sub-machine (contract C3, C9, C12, C15, C16, C17, C18, C19, C26, C43, C85): per car slot, whether a car
// still competes in the session (competing, retired with its cause, disqualified, absent); shared by every weekend phase;
// its spans declared in domain (`carStatusSpans`, `RetiredDetail`). It is the one decider of which cars are in the
// session (C43): a slot is `absent` while no car of the session holds it (`isActiveCar` over `slotsInUse`, now in
// `situations/car-status/`), and a car is in the session while its status is not `absent`. A car's first span opens,
// with `joinedAt`, on the first frame its Participants data is in the live state (`updatedAt.participants`, the identity
// area); no span opens before it (C3; supervisor ruling, Task 10 round 2). Signals out of order (Review Focus 5,
// inventory §2.9, §2.11): `retired` opens on the earliest of a PENA 16, an RTMT and the result status, with the cause
// known on that frame, never rewritten (C18): PENA 16/42 up to 4 s before the RTMT opens it; PENA 16/41 about 1 s after
// the RTMT changes nothing. A disqualification is confirmed by a PENA of type 6 or by 2 s of the result status unchanged
// (plan Global Constraints, carried over); a pending confirmation is the machine's open state (C18). Transition rows:
// car-status.transitions.ts. Segments: the player's terminal damage with a car retired earlier (race-zandvoort-retire),
// and a full field competing (race-zandvoort-pit-stop, practice-wing-change, practice-garage-exit).
import { beforeAll, describe, expect, it } from 'vitest';
import { carStatusSpans, known, unknown, type Known, type OpenSpan, type RetiredDetail, type Span } from '@pitwall/domain';
import type { StepResult } from '../../../src/index.ts';
import machine from '../../../src/situations/car-status/machine.ts';
import type { RetirementReason, Signals } from '../../../src/signals/types.ts';
import { all, events, pena } from '../../support/car-edits.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { inSession, result, retires, rtmt } from './car-status.transitions.ts';

type Run = { open: Array<OpenSpan | undefined>; closed: Array<Array<Omit<Span, 'endFrame'>>>; all: OpenSpan[][] };

/** Steps the machine through the frames: car `index`'s open span after each, the spans of the car each frame closed, and every open span after each. */
const run = (builder: ReturnType<typeof inputs>, index = 0): Run => {
  let open = machine.init();
  const result: Run = { open: [], closed: [], all: [] };
  for (const input of builder.build()) {
    const step = machine.step(open, input);
    open = step.open;
    const spans = machine.openSpans(open);
    result.all.push(spans);
    result.open.push(spans.find((s) => s.carId === index));
    result.closed.push(step.closed.filter((s) => s.carId === index));
  }
  return result;
};
const kinds = (r: Run) => r.open.map((s) => s?.kind);
/** The kind of every slot on frame `k`. */
const slots = (r: Run, k: number) => r.all[k]!.map((s) => s.kind);
const causeOf = (span: { detail: unknown } | undefined) => (span?.detail as RetiredDetail | undefined)?.cause;

/** Two cars in the session (the Participants data in the live state). */
const field = inSession(2);
/** One second of frames (63 frames, 1008 ms). */
const SECOND = Math.ceil(1000 / FRAME_MS);

describe('car-status: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine car-status, its spans the car-scoped declaration in domain, shared by every weekend phase (C16, C17)', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['car-status', carStatusSpans, 'all']);
    expect(machine.spans.scope).toBe('car');
    expect([...carStatusSpans.kinds].sort()).toEqual(['absent', 'competing', 'disqualified', 'retired']);
  });
  it('reads the signals resultStatus, numActiveCars and the events (RTMT, PENA), the identity area (the Participants data’s arrival), no upstream', () => {
    expect([...machine.inputs.signals].sort()).toEqual(['events', 'numActiveCars', 'resultStatus']);
    expect([machine.inputs.values, machine.inputs.upstream]).toEqual([['identity'], []]);
  });
});

describe('car-status: a car’s first span opens with its Participants data (C3)', () => {
  it('opens no span, absent included, before the Participants data is in the live state, whatever the signals say', () => {
    const r = run(
      inputs().frames(3, (i) => {
        i.signals.session.numActiveCars = 2;
      }),
    );
    expect(r.all.map((spans) => spans.length)).toEqual([0, 0, 0]);
    expect(r.closed.flat()).toEqual([]);
  });
  it('opens a span for every slot on the frame the data arrives, joined, on that frame number, id 0: the cars of the session competing, the other slots absent', () => {
    const r = run(inputs().frames(3).frame(field));
    const spans = r.all[3]!;
    expect(spans.map((s) => s.carId)).toEqual(Array.from({ length: spans.length }, (_, i) => i));
    for (const s of spans) expect([s.machine, s.id, s.start, s.startFrame, s.joinedAt]).toEqual(['car-status', 0, 3 * FRAME_MS, 4, true]);
    expect(slots(r, 3)).toEqual(['competing', 'competing', ...Array(spans.length - 2).fill('absent')]);
    expect(r.closed.flat()).toEqual([]);
  });
  it('holds the span while the status holds, without closing anything', () => {
    const r = run(inputs().frames(6, field));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill(['competing', 0]));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('car-status decides which cars are in the session (C43): absent is the status of a slot no car of the session holds', () => {
  it('a slot out of the race keeps its place: numActiveCars 19 with car 2 retired (race-zandvoort-retire) puts 20 slots in the session', () => {
    const r = run(inputs().frame(all(inSession(19), result(2, 'retired'))));
    expect(slots(r, 0)).toEqual([...Array(2).fill('competing'), 'retired', ...Array(17).fill('competing'), ...Array(r.all[0]!.length - 20).fill('absent')]);
  });
  it('numActiveCars falling after a retirement (1.2 s after the RTMT, MxR) turns no other car absent', () => {
    const r = run(inputs().frames(3, inSession(20)).frame(retires(19)).frame(result(19, 'retired')).frames(SECOND).frames(3, inSession(19)), 19);
    expect(kinds(r).slice(3)).toEqual(Array(r.open.length - 3).fill('retired'));
    expect(new Set(r.all.at(-1)!.slice(0, 19).map((s) => s.kind))).toEqual(new Set(['competing']));
  });
  it.each(['invalid', 'inactive'] as const)('a slot below numActiveCars whose result status is %s is absent', (status) => {
    const r = run(inputs().frame(all(field, result(1, status))), 1);
    expect(kinds(r)).toEqual(['absent']);
  });
  it('a car that finishes stays competing (the finish is car activity’s, not a status): no span closes', () => {
    const r = run(inputs().frames(3, field).frames(3, result(0, 'finished')));
    expect(kinds(r)).toEqual(Array(6).fill('competing'));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('car-status: a retirement opens on its earliest signal, with the cause known then (C18, Review Focus 5)', () => {
  it('the RTMT opens retired on its frame (C26), a frame before the result status follows; rs 7 then changes nothing', () => {
    const r = run(inputs().frames(3, field).frame(retires(0)).frames(3, result(0, 'retired')));
    expect(kinds(r)).toEqual([...Array(3).fill('competing'), ...Array(4).fill('retired')]);
    expect(r.open[3]).toMatchObject({ machine: 'car-status', carId: 0, kind: 'retired', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true });
    expect(r.open[3]!.joinedAt).toBeUndefined();
    expect(causeOf(r.open[3])).toEqual(unknown('notReceived'));
    expect(r.closed[3]).toMatchObject([{ kind: 'competing', id: 0, start: 0, end: 3 * FRAME_MS, startFrame: 1 }]);
    for (const s of r.open.slice(4)) expect(s).toEqual(r.open[3]);
    expect(r.closed.slice(4).flat()).toEqual([]);
  });
  it('AI mechanical failure (RTMT, rs 7 a frame later, PENA 16/41 about 1 s later; MxR, SgW, MiR): retired from the RTMT, its cause as known then; the PENA rewrites nothing', () => {
    const r = run(inputs().frames(3, field).frame(retires(0)).frame(result(0, 'retired')).frames(SECOND - 1).frame(events(pena(0, 16, 41))).frames(3));
    expect(r.open[3]).toMatchObject({ kind: 'retired', id: 1, start: 3 * FRAME_MS, startFrame: 4 });
    expect(causeOf(r.open[3])).toEqual(unknown('notReceived'));
    for (const s of r.open.slice(4)) expect(s).toEqual(r.open[3]);
    expect(r.closed.flat().map((s) => s.kind)).toEqual(['competing']);
  });
  it('terminal damage, PENA 16/42 4 s before the RTMT (ZvR2 car 2, 912.011 / 916.028): retired from the PENA’s frame, cause terminal damage; the RTMT and rs 7 open nothing', () => {
    const r = run(inputs().frames(3, field).frame(events(pena(0, 16, 42))).frames(4 * SECOND - 1).frame(retires(0)).frame(result(0, 'retired')).frames(2));
    expect(kinds(r)).toEqual([...Array(3).fill('competing'), ...Array(r.open.length - 3).fill('retired')]);
    expect(r.open[3]).toMatchObject({ kind: 'retired', id: 1, start: 3 * FRAME_MS, startFrame: 4 });
    expect(causeOf(r.open[3])).toEqual(known('terminalDamage', 3 * FRAME_MS));
    for (const s of r.open.slice(4)) expect(s).toEqual(r.open[3]);
    expect(r.closed.flat().map((s) => s.kind)).toEqual(['competing']);
  });
  it('the player’s terminal damage, PENA 16/42 and the RTMT on one frame (SgW, ZvP, ZvP2, ZvR, ZvR2): retired with the cause from that frame', () => {
    const r = run(inputs().frames(3, field).frame(events(pena(0, 16, 42), rtmt(0))).frames(2));
    expect(r.open[3]).toMatchObject({ kind: 'retired', id: 1, startFrame: 4 });
    expect(causeOf(r.open[3])).toEqual(known('terminalDamage', 3 * FRAME_MS));
  });
  it.each([
    [41, 'mechanical'],
    [42, 'terminalDamage'],
    [7, 'other'],
  ] as const)('the cause from a PENA 16 with infringement %i: %s', (infringement, cause) => {
    const r = run(inputs().frames(3, field).frame(events(pena(0, 16, infringement))));
    expect(causeOf(r.open[3])).toEqual(known(cause, 3 * FRAME_MS));
  });
  // The RTMT reason, per the spec's list (supervisor ruling, Task 10 round 3); every recording sends invalid (0), every
  // other reason is not yet seen (C19).
  it.each<[RetirementReason, Known<'mechanical' | 'terminalDamage' | 'other'>]>([
    ['mechanicalFailure', known('mechanical', 3 * FRAME_MS)],
    ['terminalDamage', known('terminalDamage', 3 * FRAME_MS)],
    ['retired', known('other', 3 * FRAME_MS)],
    ['notEnoughLapsCompleted', known('other', 3 * FRAME_MS)],
    ['redFlagged', known('other', 3 * FRAME_MS)],
    ['inactive', known('other', 3 * FRAME_MS)],
    ['invalid', unknown('notReceived')],
  ])('an RTMT with reason %s and no PENA 16 opens retired with its cause', (reason, cause) => {
    const r = run(inputs().frames(3, field).frame(retires(0, reason)));
    expect(r.open[3]).toMatchObject({ kind: 'retired', id: 1, startFrame: 4 });
    expect(causeOf(r.open[3])).toEqual(cause);
  });
  it('an RTMT with reason black flagged opens disqualified on its frame (not yet seen, C19)', () => {
    const r = run(inputs().frames(3, field).frame(retires(0, 'blackFlagged')));
    expect(r.open[3]).toMatchObject({ kind: 'disqualified', id: 1, startFrame: 4 });
    expect(r.closed[3]).toMatchObject([{ kind: 'competing', id: 0 }]);
  });
  it.each(['finished', 'sessionSkipped', 'sessionSimulated'] as const)(
    'an RTMT with reason %s changes no status: the car stays competing, nothing closes (not yet seen, C19)',
    (reason) => {
      const r = run(inputs().frames(3, field).frame(retires(0, reason)).frames(2));
      expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill(['competing', 0]));
      expect(r.closed.flat()).toEqual([]);
    },
  );
  it('an RTMT with reason invalid after a PENA 16 gave the cause (ZvR2 car 2) keeps the cause the PENA gave', () => {
    const r = run(inputs().frames(3, field).frame(events(pena(0, 16, 42))).frames(3).frame(retires(0)).frames(2));
    expect(r.open.at(-1)).toMatchObject({ kind: 'retired', id: 1, startFrame: 4 });
    expect(causeOf(r.open.at(-1))).toEqual(known('terminalDamage', 3 * FRAME_MS));
  });
  it('a PENA 16 on the RTMT’s frame gives the cause before the RTMT reason: PENA 16/41 with reason terminal damage is mechanical', () => {
    const r = run(inputs().frames(3, field).frame(events(rtmt(0, 'terminalDamage'), pena(0, 16, 41))));
    expect(causeOf(r.open[3])).toEqual(known('mechanical', 3 * FRAME_MS));
  });
  it('the result status retired with no RTMT or PENA opens retired on its frame, cause unknown(notReceived)', () => {
    const r = run(inputs().frames(3, field).frame(result(0, 'retired')));
    expect(r.open[3]).toMatchObject({ kind: 'retired', id: 1, startFrame: 4 });
    expect(causeOf(r.open[3])).toEqual(unknown('notReceived'));
  });
  // Not yet seen (C19): no recording shows result status 6; mapped from the spec's "not classified".
  it('the result status not classified opens retired, cause unknown(notReceived) (not yet seen, C19)', () => {
    const r = run(inputs().frames(3, field).frame(result(0, 'notClassified')).frames(2));
    expect(r.open[3]).toMatchObject({ kind: 'retired', id: 1, startFrame: 4 });
    expect(causeOf(r.open[3])).toEqual(unknown('notReceived'));
  });
  it('the player retiring from the menu (MiP: RTMT reason 0, rs 7 in the last frame, no PENA): the cause stays unknown(notReceived)', () => {
    const r = run(inputs().frames(3, field).frame(retires(0)).frame(result(0, 'retired')).frames(2 * SECOND));
    expect(causeOf(r.open.at(-1))).toEqual(unknown('notReceived'));
  });
  it('a PENA 16 of car 1 retires car 1, not car 0, and gives car 0’s RTMT no cause', () => {
    const builder = inputs().frames(3, field).frame(all(events(pena(1, 16, 42)), retires(0))).frames(2);
    expect(causeOf(run(builder, 0).open.at(-1))).toEqual(unknown('notReceived'));
    expect(run(builder, 1).open.at(-1)).toMatchObject({ kind: 'retired', id: 1, startFrame: 4, detail: { cause: known('terminalDamage', 3 * FRAME_MS) } });
  });
  it('an RTMT or a PENA 16 for a car already retired (the game resends RTMT after a flashback, SgW 4581.839) opens nothing', () => {
    const r = run(inputs().frames(3, field).frame(retires(0)).frame(result(0, 'retired')).frames(3).frame(retires(0)).frame(events(pena(0, 16, 41))).frames(2));
    for (const s of r.open.slice(4)) expect(s).toEqual(r.open[3]);
    expect(r.closed.flat().map((s) => s.kind)).toEqual(['competing']);
  });
  it('the result status retired -> did not finish in the last frame before SEND (MxR, MiR) keeps the retired span', () => {
    const r = run(inputs().frames(3, field).frame(retires(0)).frames(3, result(0, 'retired')).frames(2, result(0, 'didNotFinish')));
    expect(new Set(r.open.slice(3).map((s) => `${s?.kind} ${s?.id}`))).toEqual(new Set(['retired 1']));
  });
  it('an RTMT naming no car (255) retires nobody', () => {
    const r = run(inputs().frames(3, field).frame(events({ code: 'RTMT', carId: undefined, reason: 'invalid' })).frames(2));
    for (const spans of r.all) expect(new Set(spans.slice(0, 2).map((s) => s.kind))).toEqual(new Set(['competing']));
  });
  it('a car joined retired: retired, joined, its cause unknown(notReceived)', () => {
    const r = run(inputs().frames(3, all(inSession(1), result(0, 'retired'))));
    expect(r.open[0]).toMatchObject({ kind: 'retired', id: 0, startFrame: 1, joinedAt: true });
    expect(causeOf(r.open[0])).toEqual(unknown('notReceived'));
    for (const s of r.open) expect(s).toEqual(r.open[0]);
  });
});

describe('car-status: a disqualification opens unconfirmed and is confirmed by a PENA of type 6 or 2 s unchanged (C18)', () => {
  it('the result status disqualified opens disqualified on its frame, confirmed: false while it waits', () => {
    const r = run(inputs().frames(3, field).frames(SECOND, result(0, 'disqualified')));
    expect(r.open[3]).toMatchObject({ kind: 'disqualified', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: false });
    expect(r.open.at(-1)).toMatchObject({ kind: 'disqualified', id: 1, confirmed: false });
    expect(r.closed[3]).toMatchObject([{ kind: 'competing', id: 0 }]);
  });
  it('2 s of the result status unchanged confirm it: the same span turns confirmed', () => {
    const r = run(inputs().frames(3, field).frames(3 * SECOND, result(0, 'disqualified')));
    expect(r.open[3 + Math.floor(1.5 * SECOND)]).toMatchObject({ kind: 'disqualified', id: 1, confirmed: false });
    expect(r.open[3 + Math.ceil(2.5 * SECOND)]).toMatchObject({ kind: 'disqualified', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true });
    expect(r.closed.slice(4).flat()).toEqual([]);
  });
  it('a PENA of type 6 confirms it on the PENA’s frame', () => {
    const r = run(inputs().frames(3, field).frames(10, result(0, 'disqualified')).frame(events(pena(0, 6, 0))).frames(2));
    expect(r.open[12]).toMatchObject({ kind: 'disqualified', confirmed: false });
    expect(r.open[13]).toMatchObject({ kind: 'disqualified', id: 1, startFrame: 4, confirmed: true });
  });
  it('a PENA of type 6 on the frame the result status turns disqualified confirms it from its opening', () => {
    const r = run(inputs().frames(3, field).frame(all(result(0, 'disqualified'), events(pena(0, 6, 0)))));
    expect(r.open[3]).toMatchObject({ kind: 'disqualified', id: 1, startFrame: 4, confirmed: true });
  });
  it('a PENA of type 6 of another car confirms nothing', () => {
    const r = run(inputs().frames(3, field).frames(10, result(0, 'disqualified')).frame(events(pena(1, 6, 0))));
    expect(r.open.at(-1)).toMatchObject({ kind: 'disqualified', confirmed: false });
  });
  it('the result status active again within 2 s, no PENA 6: the span closes confirmed: false and competing opens, nothing withdrawn', () => {
    const back = 3 + SECOND;
    const r = run(inputs().frames(3, field).frames(SECOND, result(0, 'disqualified')).frames(2, result(0, 'active')));
    expect(r.closed[back]).toMatchObject([{ kind: 'disqualified', id: 1, start: 3 * FRAME_MS, end: back * FRAME_MS, startFrame: 4, confirmed: false }]);
    expect(r.open[back]).toMatchObject({ kind: 'competing', id: 2, startFrame: back + 1, confirmed: true });
  });
  it('the ZvR formation lap: an RTMT, the result status disqualified a frame later, held 6 s, then active again at the reset', () => {
    const dsq = 4;
    const reset = dsq + 6 * SECOND;
    const r = run(inputs().frames(3, field).frame(retires(0)).frames(6 * SECOND, result(0, 'disqualified')).frame(result(0, 'active')));
    expect(kinds(r)).toEqual([...Array(3).fill('competing'), 'retired', ...Array(6 * SECOND).fill('disqualified'), 'competing']);
    expect(r.closed[dsq]).toMatchObject([{ kind: 'retired', id: 1, startFrame: 4 }]);
    expect(r.open[dsq]).toMatchObject({ kind: 'disqualified', id: 2, startFrame: dsq + 1, confirmed: false });
    expect(r.closed[reset]).toMatchObject([{ kind: 'disqualified', id: 2, startFrame: dsq + 1, confirmed: true }]);
    expect(r.open[reset]).toMatchObject({ kind: 'competing', id: 3, startFrame: reset + 1 });
  });
});

/** The car-status spans of car `index` in a segment: kind, detail, joined, the frames each covers. */
const spansOf = (seg: SegmentRun<Signals['events']>, index: number) =>
  seg.spans('car-status').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, detail: s.detail, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }));
const afterLast = (seg: SegmentRun<unknown>) => seg.frames.at(-1)!.frameNumber + 1;
const frameEvents = (state: StepResult['state']): Signals['events'] => structuredClone(state.signals.events) as Signals['events'];
/** Every car of the session one competing span and every other slot one absent span, for the whole segment. */
const expectFullField = (seg: SegmentRun<Signals['events']>, cars: readonly number[], slotCount = 22) => {
  for (let index = 0; index < slotCount; index++) {
    expect(spansOf(seg, index).map(({ kind, joinedAt, startFrame, endFrame }) => ({ kind, joinedAt, startFrame, endFrame })), `car ${index}`).toEqual([
      { kind: cars.includes(index) ? 'competing' : 'absent', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) },
    ]);
  }
};
const TWENTY = Array.from({ length: 20 }, (_, i) => i);

describe('car-status: race-zandvoort-retire (ZvR2 1205 s to the end: car 2 retired on lap 12, the player’s terminal damage at 1207.667)', () => {
  let seg: SegmentRun<Signals['events']>;
  beforeAll(async () => {
    seg = await replaySegment('race-zandvoort-retire.pwrec.gz', frameEvents);
  });
  it('car 1 (the player) is competing, then retired from the frame of its PENA 16/42 and RTMT, its cause terminal damage, to the end', () => {
    const retirement = seg.frames.find((f) => f.value.some((e) => e.code === 'PENA' && e.carId === 1 && e.penaltyType === 16))!.frameNumber;
    expect(retirement).toBeGreaterThan(1);
    expect(spansOf(seg, 1)).toMatchObject([
      { kind: 'competing', joinedAt: true, startFrame: 1, endFrame: retirement },
      { kind: 'retired', detail: { cause: { known: true, value: 'terminalDamage' } }, startFrame: retirement, endFrame: afterLast(seg) },
    ]);
    expect(spansOf(seg, 1)[1]!.joinedAt).toBeUndefined();
  });
  it('car 2, retired before the segment (numActiveCars 19, rs 7), is one retired span, joined, its cause unknown(notReceived)', () => {
    expect(spansOf(seg, 2)).toEqual([{ kind: 'retired', detail: { cause: unknown('notReceived') }, joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
  it('the other 18 cars are one competing span each, and slots 20 and 21 one absent span each', () => {
    for (const index of [0, ...TWENTY.slice(3)]) expect(spansOf(seg, index).map((s) => [s.kind, s.startFrame, s.endFrame]), `car ${index}`).toEqual([['competing', 1, afterLast(seg)]]);
    for (const index of [20, 21]) expect(spansOf(seg, index).map((s) => [s.kind, s.startFrame, s.endFrame]), `slot ${index}`).toEqual([['absent', 1, afterLast(seg)]]);
  });
});

describe('car-status: a full field competing for the whole segment (each segment’s first frame carries Participants)', () => {
  it.each(['race-zandvoort-pit-stop.pwrec.gz', 'practice-wing-change.pwrec.gz', 'practice-garage-exit.pwrec.gz'])('%s: cars 0-19 competing, slots 20 and 21 absent', async (file) => {
    expectFullField(await replaySegment(file, frameEvents), TWENTY);
  });
});
