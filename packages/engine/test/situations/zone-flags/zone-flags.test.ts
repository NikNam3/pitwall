// The zone-flags sub-machine (contract C9, C12, C15, C17, C18, C26, C85): per marshal zone the Session packet lists, one
// span per flag the zone shows (signal `marshalZones`), a new span on every change; a zone is a scope from the first
// frame that lists it; shared by every weekend phase; its spans declared in domain (`zoneFlagsSpans`), each with
// `ZoneFlagDetail { zone, startFraction }`; and the committed segments practice-miami-yellow (zone 10 yellow, then
// green, then none; zone 11 green, then none) and race-mexico-blue (blue zones 8 and 9). The transition rows are in
// zone-flags.transitions.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { zoneFlagsSpans, type Span, type ZoneFlagDetail } from '@pitwall/domain';
import machine from '../../../src/situations/zone-flags/machine.ts';
import { FRAME_MS, inputs } from '../../support/transition-table.ts';
import { expectSequence, ofZone, replaySpans, sequenceOf } from '../../support/segment-spans.ts';
import { KINDS } from '../car-flags/car-flags.transitions.ts';
import { lists, startOf } from './zone-flags.transitions.ts';

/** Steps the machine through the frames: the open spans after each, and every span closed on the way. */
const run = (builder: ReturnType<typeof inputs>) => {
  let open = machine.init();
  const closed: Array<Omit<Span, 'endFrame'>> = [];
  const after = builder.build().map((input) => {
    const step = machine.step(open, input);
    open = step.open;
    closed.push(...step.closed);
    return machine.openSpans(open);
  });
  return { after, closed };
};
const detailOf = (s: { detail: unknown }): ZoneFlagDetail => s.detail as ZoneFlagDetail;
const byZone = <T extends { zone?: number | undefined }>(spans: readonly T[]): T[] => [...spans].sort((a, b) => a.zone! - b.zone!);

describe('zone-flags: id, span declaration, inputs, applies to', () => {
  it('is the sub-machine zone-flags, its spans the zone-scoped declaration in domain, shared by every phase, reading the marshalZones signal', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['zone-flags', zoneFlagsSpans, 'all']);
    expect(machine.spans.scope).toBe('zone');
    expect(machine.inputs).toEqual({ signals: ['marshalZones'], values: [], upstream: [] });
  });
  it('declares every kind of its spans', () => {
    expect([...zoneFlagsSpans.kinds].sort()).toEqual([...KINDS].sort());
  });
});

describe('zone-flags: one span per listed zone, from the first frame that lists it', () => {
  it('opens a span per listed zone with its zone (`Span.zone`) and its start on the lap as detail, the frame and the zone’s flag', () => {
    const { after } = run(inputs().frame(lists('noFlag', 'yellow', 'green')));
    const opened = byZone(after[0]!);
    expect(opened.map((s) => [s.kind, s.zone, s.detail, s.id, s.start, s.startFrame, s.confirmed, s.joinedAt])).toEqual([
      ['noFlag', 0, { startFraction: startOf(0, 3) }, 0, 0, 1, true, true],
      ['yellow', 1, { startFraction: startOf(1, 3) }, 1, 0, 1, true, true],
      ['green', 2, { startFraction: startOf(2, 3) }, 2, 0, 1, true, true],
    ]);
  });
  it('opens no span while no zone is listed; a zone listed later opens on that frame, without joinedAt', () => {
    const { after } = run(inputs().frames(2, lists()).frame(lists('green', 'noFlag')));
    expect(after.slice(0, 2)).toEqual([[], []]);
    expect(byZone(after[2]!).map((s) => [s.kind, s.startFrame, s.start, s.joinedAt])).toEqual([
      ['green', 3, 2 * FRAME_MS, undefined],
      ['noFlag', 3, 2 * FRAME_MS, undefined],
    ]);
  });
  it('a zone that appears while others are open opens with the next id of the machine; the open ones are untouched', () => {
    const { after, closed } = run(inputs().frame(lists('noFlag', 'noFlag')).frame(lists('noFlag', 'noFlag', 'blue')));
    expect(closed).toEqual([]);
    expect(byZone(after[1]!).map((s) => [s.zone, s.id, s.kind, s.startFrame])).toEqual([[0, 0, 'noFlag', 1], [1, 1, 'noFlag', 1], [2, 2, 'blue', 2]]);
  });
});

describe('zone-flags: a new span on every change of the zone’s flag', () => {
  it('a change closes the zone’s span on that frame, opens the next with its zone and start, and leaves the other zones alone', () => {
    const { after, closed } = run(inputs().frames(2, lists('noFlag', 'noFlag')).frame(lists('noFlag', 'yellow')).frame(lists('noFlag', 'yellow')).frame(lists('noFlag', 'green')));
    expect(closed).toEqual([
      { machine: 'zone-flags', id: 1, kind: 'noFlag', start: 0, end: 2 * FRAME_MS, confirmed: true, zone: 1, detail: { startFraction: startOf(1, 2) }, startFrame: 1, joinedAt: true },
      { machine: 'zone-flags', id: 2, kind: 'yellow', start: 2 * FRAME_MS, end: 4 * FRAME_MS, confirmed: true, zone: 1, detail: { startFraction: startOf(1, 2) }, startFrame: 3 },
    ]);
    expect(byZone(after.at(-1)!).map((s) => [s.zone, s.id, s.kind, s.startFrame])).toEqual([[0, 0, 'noFlag', 1], [1, 3, 'green', 5]]);
  });
  // Not yet seen (C19): synthetic, no recording lists fewer zones later in a session.
  it('not yet seen: a zone a later packet no longer lists turns unknown with its detail unchanged; listed again, its flag opens the next span', () => {
    const { after, closed } = run(inputs().frames(2, lists('green', 'yellow')).frame(lists('green')).frame(lists('green')).frame(lists('green', 'blue')));
    const detail = { startFraction: startOf(1, 2) };
    expect(closed.map((s) => [s.zone, s.kind, s.start, s.end])).toEqual([[1, 'yellow', 0, 2 * FRAME_MS], [1, 'unknown', 2 * FRAME_MS, 4 * FRAME_MS]]);
    expect(after.map((open) => byZone(open).map((s) => s.kind))).toEqual([['green', 'yellow'], ['green', 'yellow'], ['green', 'unknown'], ['green', 'unknown'], ['green', 'blue']]);
    expect(byZone(after[2]!)[1]).toMatchObject({ zone: 1, detail, startFrame: 3, id: 2 });
    // the zone stays covered: still listed zones are untouched
    expect(byZone(after[4]!)[0]).toMatchObject({ id: 0, startFrame: 1 });
  });
  it('not yet seen: a zone that is unknown already and is no longer listed keeps its span', () => {
    const { closed } = run(inputs().frame(lists('unknown')).frame(lists()));
    expect(closed).toEqual([]);
  });
  it('withdraws nothing: every span it closes or holds is confirmed (C18)', () => {
    const { after, closed } = run(inputs().frames(2, lists('blue')).frame(lists('unknown')).frame(lists('green')));
    expect([...closed, ...after.flat()].every((s) => s.confirmed)).toBe(true);
  });
});

describe('zone-flags: practice-miami-yellow (MiP: zone 10 yellow 135.5, green 144.7, none 149.7 s; zone 11 green 135.5, none 144.7 s)', () => {
  let spans: readonly Span[];
  beforeAll(async () => {
    spans = await replaySpans('practice-miami-yellow.pwrec.gz', 'zone-flags');
  });
  it('zone 10 is noFlag, yellow, green, noFlag; zone 11 noFlag, green, noFlag', () => {
    expectSequence(sequenceOf(spans, ofZone(10)), [['noFlag', 130], ['yellow', 135.5], ['green', 144.7], ['noFlag', 149.7]]);
    expectSequence(sequenceOf(spans, ofZone(11)), [['noFlag', 130], ['green', 135.5], ['noFlag', 144.7]]);
  });
  it('the 12 listed zones are each a scope; each span carries its zone and start on the lap', () => {
    const zones = [...new Set(spans.map((s) => s.zone!))].sort((a, b) => a - b);
    expect(zones).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const zone of zones) {
      const fractions = new Set(spans.filter(ofZone(zone)).map((s) => detailOf(s).startFraction));
      expect(fractions.size, `zone ${zone}`).toBe(1);
    }
  });
});

describe('zone-flags: race-mexico-blue (MxR: zone 8 blue 6764.7 to 6773.2 s, zone 9 blue from 6770.7 s)', () => {
  let spans: readonly Span[];
  beforeAll(async () => {
    spans = await replaySpans('race-mexico-blue.pwrec.gz', 'zone-flags');
  });
  it('zone 8 is noFlag, blue, noFlag; zone 9 is noFlag, then blue to the segment’s end', () => {
    expectSequence(sequenceOf(spans, ofZone(8)), [['noFlag', 6763.7], ['blue', 6764.7], ['noFlag', 6773.2]]);
    expectSequence(sequenceOf(spans, ofZone(9)), [['noFlag', 6763.7], ['blue', 6770.7]]);
  });
  it('the 13 listed zones are each a scope', () => {
    const zones = [...new Set(spans.map((s) => s.zone!))].sort((a, b) => a - b);
    expect(zones).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });
});
