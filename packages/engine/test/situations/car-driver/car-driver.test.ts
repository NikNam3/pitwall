// The car-driver sub-machine (contract C3, C9, C12, C13, C15, C16, C17, C18, C19, C26, C85): per car, who drives it, the
// AI (`ai`) or a human (`human`), from the `aiControlled` signal alone; shared by every weekend phase; its spans declared
// in domain (`carDriverSpans`), with no detail; a new span on every flip, none withdrawn (C18). The signal defaults to
// `true` before any Participants packet, so a car's first span opens, with `joinedAt`, on the first frame its
// Participants data is in the live state (`updatedAt.participants`, the identity area), as car-location's does. No
// upstream sub-machine. A takeover is known only from the game's spec (C19): synthetic rows. Transition rows:
// car-driver.transitions.ts. Segment: race-zandvoort-lap10 (Participants first; 2 humans, 1 the player and 0).
import { beforeAll, describe, expect, it } from 'vitest';
import { carDriverSpans, type OpenSpan, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/car-driver/machine.ts';
import { car, participants } from '../../support/car-edits.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { byAi, byHuman, drivenBy } from './car-driver.transitions.ts';

type Run = { open: Array<OpenSpan | undefined>; closed: Array<Array<Omit<Span, 'endFrame'>>>; all: OpenSpan[][] };

/** Steps the machine through the frames: car `index`'s open span after each, the spans of the car each frame closed, and every open span after each. */
const run = (builder: ReturnType<typeof inputs>, index = 0): Run => {
  let open = machine.init();
  const result: Run = { open: [], closed: [], all: [] };
  for (const input of builder.build()) {
    const step = machine.step(open, input);
    open = step.open;
    const spans: OpenSpan[] = machine.openSpans(open);
    result.all.push(spans);
    result.open.push(spans.find((s) => s.carId === index));
    result.closed.push(step.closed.filter((s: Omit<Span, 'endFrame'>) => s.carId === index));
  }
  return result;
};
const kinds = (r: Run) => r.open.map((s) => s?.kind);

describe('car-driver: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine car-driver, its spans the car-scoped declaration in domain, shared by every weekend phase (C16, C17)', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['car-driver', carDriverSpans, 'all']);
    expect(machine.spans.scope).toBe('car');
    expect([...carDriverSpans.kinds].sort()).toEqual(['ai', 'human']);
  });
  it('reads the signal aiControlled and the identity area (the Participants data’s arrival), no upstream sub-machine', () => {
    expect(machine.inputs).toEqual({ signals: ['aiControlled'], values: ['identity'], upstream: [] });
  });
  it('declares none -> ai, none -> human, ai -> human and human -> ai, nothing else', () => {
    expect([...machine.transitions].map(([from, to]) => `${from}->${to}`).sort()).toEqual(['ai->human', 'human->ai', 'none->ai', 'none->human']);
  });
});

describe('car-driver: a car’s first span opens with its Participants data (C3)', () => {
  it('opens no span before the Participants data is in the live state: the default aiControlled true opens nothing', () => {
    const r = run(inputs().frames(4));
    expect(r.all.map((spans) => spans.length)).toEqual([0, 0, 0, 0]);
    expect(r.closed.flat()).toEqual([]);
  });
  it('a human flag before the Participants data opens nothing either', () => {
    const r = run(inputs().frames(3, car(0, { aiControlled: false })));
    expect(r.all.map((spans) => spans.length)).toEqual([0, 0, 0]);
  });
  it('opens a span for every slot on the frame the Participants data arrives, joined, on that frame number, id 0, confirmed, no detail', () => {
    const r = run(inputs().frames(3).frame(participants));
    const spans = r.all[3]!;
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.map((s) => s.carId)).toEqual(Array.from({ length: spans.length }, (_, i) => i));
    for (const s of spans) expect([s.machine, s.kind, s.id, s.start, s.startFrame, s.joinedAt, s.confirmed, s.detail]).toEqual(['car-driver', 'ai', 0, 3 * FRAME_MS, 4, true, true, undefined]);
  });
  it('a slot a human drives on that frame opens human; the others ai', () => {
    const r = run(inputs().frames(2).frame(drivenBy(1, false)));
    expect(r.all[2]!.find((s) => s.carId === 1)).toMatchObject({ kind: 'human', joinedAt: true, startFrame: 3 });
    expect(r.all[2]!.filter((s) => s.carId !== 1).every((s) => s.kind === 'ai')).toBe(true);
  });
  it('holds the span while the driver holds, the same object every frame, closing nothing', () => {
    const r = run(inputs().frames(6, byHuman));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill(['human', 0]));
    for (const s of r.open) expect(s).toBe(r.open[0]);
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('car-driver: a takeover is a new span (synthetic, not yet seen, C19)', () => {
  it('the AI takes over from a human: the human span closes on the flip frame and ai opens on it (C26)', () => {
    const r = run(inputs().frames(3, byHuman).frames(2, byAi));
    expect(kinds(r)).toEqual(['human', 'human', 'human', 'ai', 'ai']);
    expect(r.open[3]).toMatchObject({ machine: 'car-driver', carId: 0, kind: 'ai', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true, detail: undefined });
    expect(r.open[3]!.joinedAt).toBeUndefined();
    expect(r.closed[3]).toMatchObject([{ kind: 'human', id: 0, start: 0, end: 3 * FRAME_MS, startFrame: 1, joinedAt: true }]);
    expect(r.closed[3]![0]!.startFrame).toBeLessThan(r.open[3]!.startFrame);
  });
  it('a human takes over from the AI, then the AI again: ids 0, 1, 2, each span closed on the frame the next opens', () => {
    const r = run(inputs().frames(2, byAi).frames(3, byHuman).frames(2, byAi));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual([...Array(2).fill(['ai', 0]), ...Array(3).fill(['human', 1]), ...Array(2).fill(['ai', 2])]);
    expect(r.closed[2]).toMatchObject([{ kind: 'ai', id: 0, end: 2 * FRAME_MS }]);
    expect(r.closed[5]).toMatchObject([{ kind: 'human', id: 1, start: 2 * FRAME_MS, end: 5 * FRAME_MS, startFrame: 3 }]);
  });
  it('a car’s takeover does not touch another car’s spans', () => {
    const r = run(inputs().frames(3, byAi).frame(byHuman).frames(2), 1);
    expect(kinds(r)).toEqual(Array(6).fill('ai'));
    expect(new Set(r.open.map((s) => s?.id))).toEqual(new Set([0]));
    expect(r.closed.flat()).toEqual([]);
  });
});

/** The car-driver spans of car `index` in a segment: kind, joined, the frames each covers. */
const spansOf = (seg: SegmentRun<null>, index: number) =>
  seg.spans('car-driver').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }));
const afterLast = (seg: SegmentRun<unknown>) => seg.frames.at(-1)!.frameNumber + 1;

describe('car-driver: race-zandvoort-lap10 (ZvR 721-726 s, Participants first; 2 humans: 1 the player, 0)', () => {
  let seg: SegmentRun<null>;
  beforeAll(async () => {
    seg = await replaySegment('race-zandvoort-lap10.pwrec.gz', () => null);
  });
  it('the player (car 1) is one human span, joined on the first frame, to the end', () => {
    expect(spansOf(seg, 1)).toEqual([{ kind: 'human', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
  it('the other human (car 0) is one human span; an AI car (car 4, the player’s teammate) one ai span', () => {
    expect(spansOf(seg, 0)).toEqual([{ kind: 'human', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
    expect(spansOf(seg, 4)).toEqual([{ kind: 'ai', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
});
