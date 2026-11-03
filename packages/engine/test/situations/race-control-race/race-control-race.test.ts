// The race's race-control sub-machine (contract C9, C12, C14, C15, C17, C18, C26): DRS in a race, one span at a time for
// the session. Transition rows: race-control-race.transitions.ts. Segment: race-control-race.segments.test.ts.
import { describe, expect, it } from 'vitest';
import { raceControlRaceSpans, type DrsOffDetail, type OpenSpan, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/race-control-race/machine.ts';
import { all, events } from '../session-phase/inputs.ts';
import { FRAME_MS, inputs, type MachineInputBuilder } from '../../support/transition-table.ts';
import { DRSD, DRSE, inRace, LGOT, phase } from './race-control-race.transitions.ts';

type Run = { open: Array<OpenSpan | undefined>; closed: Array<Array<Omit<Span, 'endFrame'>>> };

/** Steps the machine through the frames: the open span after each, and the spans each frame closed. */
const run = (builder: MachineInputBuilder): Run => {
  let open = machine.init();
  const result: Run = { open: [], closed: [] };
  for (const input of builder.build()) {
    const step = machine.step(open, input);
    open = step.open;
    result.open.push(machine.openSpans(open)[0]);
    result.closed.push(step.closed);
  }
  return result;
};
const reasonOf = (span: { detail?: unknown } | undefined): string | undefined => (span?.detail as DrsOffDetail | undefined)?.reason;

describe('race-control-race: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine race-control-race, its spans the session-scoped declaration in domain, applies to the race phase only', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['race-control-race', raceControlRaceSpans, ['race']]);
    expect(machine.spans.scope).toBe('session');
  });
  it('reads the DRSE and DRSD events and the upstream session-phase-race', () => {
    expect(machine.inputs.signals).toEqual(expect.arrayContaining(['events']));
    expect(machine.inputs.upstream).toEqual(['session-phase-race']);
  });
});

describe('race-control-race: before the lights out DRS is not enabled yet', () => {
  it('opens drsOff with reason notEnabledYet on the first frame on the grid, not joined, on frame number 1', () => {
    const r = run(inputs().frame(phase('grid')));
    expect(r.open[0]).toMatchObject({ machine: 'race-control-race', id: 0, kind: 'drsOff', start: 0, startFrame: 1, confirmed: true, detail: { reason: 'notEnabledYet' } });
    expect(r.open[0]!.joinedAt).toBeUndefined();
  });
  it('a race joined in the formation lap opens drsOff, joined', () => {
    expect(run(inputs().frame(phase('formation'))).open[0]).toMatchObject({ kind: 'drsOff', joinedAt: true, detail: { reason: 'notEnabledYet' } });
  });
  it('a DRSE and a DRSD before the lights out do not count (formation lap, start lights): one drsOff span, nothing closed', () => {
    const r = run(inputs().frames(2, phase('grid')).frame(all(phase('formation'), events(DRSE))).frame(events(DRSD('wetTrack'))).frame(phase('startLights')).frame(events(DRSE)));
    expect(r.open.map((s) => [s?.id, s?.kind, reasonOf(s)])).toEqual(Array(6).fill([0, 'drsOff', 'notEnabledYet']));
    expect(r.closed.flat()).toEqual([]);
  });
  it('the lights out alone changes nothing: DRS stays not enabled yet until DRSE', () => {
    const r = run(inputs().frames(2, phase('startLights')).frame(inRace('racing', events(LGOT))).frames(3));
    expect(r.open.map((s) => [s?.kind, reasonOf(s)])).toEqual(Array(6).fill(['drsOff', 'notEnabledYet']));
  });
});

describe('race-control-race: DRSE and DRSD after the lights out', () => {
  it('DRSE closes the drsOff span and opens drsOn on its frame, from the span’s first frame up to that frame (C26)', () => {
    const r = run(inputs().frames(2, phase('startLights')).frame(phase('racing')).frames(2).frame(events(DRSE)).frames(2));
    expect(r.open[5]).toMatchObject({ kind: 'drsOn', id: 1, start: 5 * FRAME_MS, startFrame: 6, confirmed: true });
    expect(r.open[5]!.joinedAt).toBeUndefined();
    expect(r.closed[5]).toMatchObject([{ kind: 'drsOff', id: 0, start: 0, end: 5 * FRAME_MS, startFrame: 1, detail: { reason: 'notEnabledYet' } }]);
    expect(r.open[7]).toEqual(r.open[5]);
  });
  it('a DRSD closes drsOn and opens drsOff with the reason of the event', () => {
    const r = run(inputs().frames(3, phase('racing')).frame(events(DRSD('safetyCar'))).frames(2));
    expect(r.open[3]).toMatchObject({ kind: 'drsOff', id: 1, startFrame: 4, detail: { reason: 'safetyCar' } });
    expect(r.closed[3]).toMatchObject([{ kind: 'drsOn', id: 0, joinedAt: true, startFrame: 1 }]);
  });
  it.each(['wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached'] as const)('the reason %s is the span’s reason', (reason) => {
    expect(reasonOf(run(inputs().frames(2, phase('racing')).frame(events(DRSD(reason)))).open[2])).toBe(reason);
  });
  it('a DRSD with a code the spec does not list opens drsOff with reason unknown, never one of the listed reasons (w2/drs f9a9c07)', () => {
    expect(reasonOf(run(inputs().frames(2, phase('racing')).frame(events(DRSD('unknown')))).open[2])).toBe('unknown');
  });
  it('a DRSD with another reason while DRS is off replaces the span; the same reason again changes nothing', () => {
    const r = run(inputs().frames(2, phase('racing')).frame(events(DRSD('wetTrack'))).frame(events(DRSD('wetTrack'))).frame(events(DRSD('redFlag'))));
    expect(r.open.map((s) => [s?.id, reasonOf(s)])).toEqual([[0, undefined], [0, undefined], [1, 'wetTrack'], [1, 'wetTrack'], [2, 'redFlag']]);
    expect(r.closed[4]).toMatchObject([{ kind: 'drsOff', id: 1, detail: { reason: 'wetTrack' } }]);
  });
  it('a DRSE while DRS is already on changes nothing', () => {
    const r = run(inputs().frames(2, phase('racing')).frame(events(DRSE)).frames(2));
    expect(r.open.map((s) => [s?.id, s?.kind])).toEqual(Array(5).fill([0, 'drsOn']));
    expect(r.closed.flat()).toEqual([]);
  });
  it('DRS goes on and off again: wet track, then DRSE, then a safety car (a full cycle)', () => {
    const r = run(inputs().frames(2, phase('racing')).frame(events(DRSD('wetTrack'))).frame(events(DRSE)).frame(events(DRSD('safetyCar'))).frame(events(DRSE)));
    expect(r.open.slice(2).map((s) => [s?.id, s?.kind, reasonOf(s)])).toEqual([[1, 'drsOff', 'wetTrack'], [2, 'drsOn', undefined], [3, 'drsOff', 'safetyCar'], [4, 'drsOn', undefined]]);
  });
});

describe('race-control-race: joining a race in progress (C26: the first frame, joinedAt; Review Focus 2)', () => {
  it('a race joined after the lights out opens drsOn, joined, and keeps it until a DRSD (the zandvoort-vsc segment shows DRS before its DRSD)', () => {
    const r = run(inputs().frames(5, phase('racing')));
    expect(r.open[0]).toMatchObject({ kind: 'drsOn', id: 0, startFrame: 1, joinedAt: true });
    for (const s of r.open) expect(s).toEqual(r.open[0]);
    expect(r.closed.flat()).toEqual([]);
  });
  it.each([['neutralised', 'safetyCar'], ['suspended', 'redFlag']] as const)('a race joined while the session phase is %s opens drsOff with reason %s, joined', (kind, reason) => {
    const r = run(inputs().frames(3, phase(kind)));
    expect(r.open[0]).toMatchObject({ kind: 'drsOff', id: 0, startFrame: 1, joinedAt: true, detail: { reason } });
    expect(r.open[2]).toEqual(r.open[0]);
  });
  it('a race joined under a safety car turns drsOn at the DRSE that ends it', () => {
    const r = run(inputs().frames(2, phase('neutralised')).frame(inRace('racing', events(DRSE))));
    expect(r.open.map((s) => [s?.kind, reasonOf(s)])).toEqual([['drsOff', 'safetyCar'], ['drsOff', 'safetyCar'], ['drsOn', undefined]]);
  });
  it('a race that goes on under a safety car after the join: the DRSD turns it off, the DRSE back on', () => {
    const r = run(inputs().frames(2, phase('racing')).frame(inRace('neutralised', events(DRSD('safetyCar')))).frames(2).frame(inRace('racing', events(DRSE))));
    expect(r.open.map((s) => s?.kind)).toEqual(['drsOn', 'drsOn', 'drsOff', 'drsOff', 'drsOff', 'drsOn']);
  });
});
