// The car-location sub-machine (contract C9, C12, C15, C16, C17, C19, C26, C85): per car, where it physically is
// (garage, pit lane, track), from the signals `driverStatus` and `pitStatus` alone; shared by every weekend phase; its
// spans declared in domain (`carLocationSpans`); one span per car slot from the session's first frame on, a new span on
// every change of the location, none withdrawn (C18). The facts behind each rule: docs/research/09-situations-inventory.md
// §2.1-2.5. Transition rows: car-location.transitions.ts. Segments: the player leaving the garage through the pit lane
// onto the track (practice-garage-exit, new), a race pit entry (race-zandvoort-pit-stop), a car in its garage for the
// whole segment (practice-wing-change), a retired car already in its garage (race-zandvoort-retire).
import { beforeAll, describe, expect, it } from 'vitest';
import { carLocationSpans, type OpenSpan, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/car-location/machine.ts';
import type { CarSignals } from '../../../src/signals/types.ts';
import { replaySegment, type SegmentRun } from '../../support/segment-run.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { at, inGarage, onTrack, outOfGarage } from './car-location.transitions.ts';

type Run = { open: Array<OpenSpan | undefined>; closed: Array<Array<Omit<Span, 'endFrame'>>> };

/** Steps the machine through the frames: car `index`'s open span after each, and the spans of the car each frame closed. */
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

describe('car-location: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine car-location, its spans the car-scoped declaration in domain, shared by every weekend phase (C16, C17)', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['car-location', carLocationSpans, 'all']);
    expect(machine.spans.scope).toBe('car');
    expect([...carLocationSpans.kinds].sort()).toEqual(['garage', 'pitLane', 'track']);
  });
  it('reads the signals driverStatus and pitStatus, no value and no upstream sub-machine', () => {
    expect([...machine.inputs.signals].sort()).toEqual(['driverStatus', 'pitStatus']);
    expect([machine.inputs.values, machine.inputs.upstream]).toEqual([[], []]);
  });
});

describe('car-location: every car slot has a span from the first frame on', () => {
  it('opens a span for every car slot the signals hold on the first frame, joined, on frame number 1, id 0, confirmed', () => {
    const [first] = inputs().frame().build();
    const spans = machine.openSpans(machine.step(machine.init(), first!).open);
    expect(spans.map((s) => s.carId)).toEqual(first!.signals.cars.map((_, i) => i));
    for (const s of spans) expect([s.machine, s.id, s.start, s.startFrame, s.joinedAt, s.confirmed]).toEqual(['car-location', 0, 0, 1, true, true]);
  });
  it('a slot before its first LapData (driver status in the garage, pit status none) is in the garage', () => {
    const [first] = inputs().frame().build();
    expect(new Set(machine.openSpans(machine.step(machine.init(), first!).open).map((s) => s.kind))).toEqual(new Set(['garage']));
  });
  it('holds the span while the location holds, without closing anything', () => {
    const r = run(inputs().frames(6, onTrack));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(6).fill(['track', 0]));
    expect(r.closed.flat()).toEqual([]);
  });
});

describe('car-location: the driver status decides the garage, the pit status the pit lane', () => {
  it('in the garage with ps 0 (ZvP car 1) is garage, and ps 0 -> 1 seconds before leaving changes nothing', () => {
    const r = run(inputs().frames(3, at(0, 'inGarage', 'none')).frames(3, inGarage));
    expect(kinds(r)).toEqual(Array(6).fill('garage'));
    expect(r.closed.flat()).toEqual([]);
  });
  it('leaving the garage: pitLane from the frame ds 0 -> 3, track from the frame ps 1 -> 0, each closing the one before (C26)', () => {
    const r = run(inputs().frames(3, inGarage).frames(4, outOfGarage).frames(2, at(0, 'outLap', 'none')));
    expect(kinds(r)).toEqual([...Array(3).fill('garage'), ...Array(4).fill('pitLane'), ...Array(2).fill('track')]);
    expect(r.open[3]).toMatchObject({ machine: 'car-location', carId: 0, kind: 'pitLane', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true });
    expect(r.open[3]!.joinedAt).toBeUndefined();
    expect(r.closed[3]).toMatchObject([{ kind: 'garage', id: 0, start: 0, end: 3 * FRAME_MS, startFrame: 1, joinedAt: true }]);
    expect(r.open[7]).toMatchObject({ kind: 'track', id: 2, start: 7 * FRAME_MS, startFrame: 8 });
    expect(r.closed[7]).toMatchObject([{ kind: 'pitLane', id: 1, start: 3 * FRAME_MS, end: 7 * FRAME_MS, startFrame: 4 }]);
  });
  it('the in-lap driver status ahead of the pit entry (ds 2 with ps 0, up to 6 s, §2.5) is still track', () => {
    const r = run(inputs().frames(3, onTrack).frames(5, at(0, 'inLap', 'none')).frame(at(0, 'inLap', 'pitting')));
    expect(kinds(r)).toEqual([...Array(8).fill('track'), 'pitLane']);
  });
  it('the Miami out-lap flicker on track (ds 3 -> 2 -> 3 with ps 0, §2.5) changes nothing', () => {
    const r = run(inputs().frames(3, at(0, 'outLap', 'none')).frames(3, at(0, 'inLap', 'none')).frames(3, at(0, 'outLap', 'none')));
    expect(kinds(r)).toEqual(Array(9).fill('track'));
    expect(r.closed.flat()).toEqual([]);
  });
  it('the box (ps 1 -> 2 -> 1) is still the pit lane: one pitLane span from the entry to the exit', () => {
    const r = run(
      inputs()
        .frames(2, at(0, 'inLap', 'none'))
        .frames(2, at(0, 'inLap', 'pitting'))
        .frames(2, at(0, 'inLap', 'inPitArea'))
        .frames(2, at(0, 'outLap', 'pitting'))
        .frame(at(0, 'outLap', 'none')),
    );
    expect(kinds(r)).toEqual([...Array(2).fill('track'), ...Array(6).fill('pitLane'), 'track']);
    expect(new Set(r.open.slice(2, 8).map((s) => s?.id))).toEqual(new Set([1]));
  });
  it('a car’s location does not touch another car’s spans', () => {
    const r = run(inputs().frames(2).frame(onTrack).frames(2), 1);
    expect(kinds(r)).toEqual(Array(5).fill('garage'));
    expect(r.closed.flat()).toEqual([]);
  });
});

/** The car-location spans of car `index` in a segment: kind, joined, the frames each covers. */
const spansOf = (seg: SegmentRun<readonly CarSignals[]>, index: number) =>
  seg.spans('car-location').filter((s) => s.carId === index).map((s) => ({ kind: s.kind, joinedAt: s.joinedAt, startFrame: s.startFrame, endFrame: s.endFrame }));
/** The frame number of the first frame whose signals of car `index` satisfy `test`. */
const firstFrame = (seg: SegmentRun<readonly CarSignals[]>, index: number, test: (c: CarSignals) => boolean): number =>
  seg.frames.find((f) => test(f.value[index]!))!.frameNumber;
const afterLast = (seg: SegmentRun<unknown>) => seg.frames.at(-1)!.frameNumber + 1;
const carSignals = (state: { signals: { cars: readonly CarSignals[] } }): readonly CarSignals[] => state.signals.cars.map((c) => ({ ...c }));

describe('car-location: practice-garage-exit (MiP 640.5-651 s: the player leaves the garage at 641.422, exits the pit lane at 649.872)', () => {
  let seg: SegmentRun<readonly CarSignals[]>;
  beforeAll(async () => {
    seg = await replaySegment('practice-garage-exit.pwrec.gz', carSignals);
  });
  it('car 19 is garage (joined), then pitLane from the frame ds turned outLap, then track from the frame ps turned none, to the end', () => {
    const leaves = firstFrame(seg, 19, (c) => c.driverStatus === 'outLap');
    const exits = firstFrame(seg, 19, (c) => c.pitStatus === 'none');
    expect(1 < leaves && leaves < exits).toBe(true);
    expect(spansOf(seg, 19)).toEqual([
      { kind: 'garage', joinedAt: true, startFrame: 1, endFrame: leaves },
      { kind: 'pitLane', joinedAt: undefined, startFrame: leaves, endFrame: exits },
      { kind: 'track', joinedAt: undefined, startFrame: exits, endFrame: afterLast(seg) },
    ]);
  });
  it('cars 6 and 7, in their garage boxes for the whole segment, are one garage span each', () => {
    for (const index of [6, 7]) expect(spansOf(seg, index)).toEqual([{ kind: 'garage', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
  it('car 2, ending its out lap at the line (ds 3 -> 1 at 645.636), is one track span', () => {
    expect(spansOf(seg, 2)).toEqual([{ kind: 'track', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
});

describe('car-location: race-zandvoort-pit-stop (ZvR2 548.2-555 s: the player enters the pit lane at 548.387 and stops in the box at 553.276)', () => {
  it('car 1 is track (joined), then pitLane from the frame ps turned pitting, through the box, to the end', async () => {
    const seg = await replaySegment('race-zandvoort-pit-stop.pwrec.gz', carSignals);
    const entry = firstFrame(seg, 1, (c) => c.pitStatus === 'pitting');
    expect(entry).toBeGreaterThan(1);
    expect(spansOf(seg, 1)).toEqual([
      { kind: 'track', joinedAt: true, startFrame: 1, endFrame: entry },
      { kind: 'pitLane', joinedAt: undefined, startFrame: entry, endFrame: afterLast(seg) },
    ]);
  });
});

describe('car-location: practice-wing-change (MiP 615-619 s: the player in the garage)', () => {
  it('car 19 is one garage span, joined, for the whole segment; car 4 on a flying lap one track span', async () => {
    const seg = await replaySegment('practice-wing-change.pwrec.gz', carSignals);
    expect(spansOf(seg, 19)).toEqual([{ kind: 'garage', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
    expect(spansOf(seg, 4)).toEqual([{ kind: 'track', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
});

describe('car-location: race-zandvoort-retire (ZvR2 1205 s to the end: car 2 retired on lap 12, the player retires at 1207.667)', () => {
  it('car 2, in its garage since its retirement, is one garage span; the player, retiring on track, one track span', async () => {
    const seg = await replaySegment('race-zandvoort-retire.pwrec.gz', carSignals);
    expect(spansOf(seg, 2)).toEqual([{ kind: 'garage', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
    expect(spansOf(seg, 1)).toEqual([{ kind: 'track', joinedAt: true, startFrame: 1, endFrame: afterLast(seg) }]);
  });
});
