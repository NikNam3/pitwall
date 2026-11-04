// `gaps` behaves per situation (contract C14, C17, C20, C26, C43, C44): one test per row of its behaviour table, on a
// view whose spans are the only thing that differs. The table (`GAPS_BEHAVIOUR`) is the unit's one lookup of what a
// situation means for it; no game signal and no `car.active` is read. Every view goes through the guarded view (C41).
import { carId, unknown, type OpenSpan, type Span } from '@pitwall/domain';
import { SPAN_DECLARATIONS } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { field, neutralisation, openNeutralisation } from '../../../../test-support/builders/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { GAPS_BEHAVIOUR } from '../../src/gaps/index.ts';
import { carsFor, deltaOf, guarded, offsetRace, run, viewOf, type Phase, type StatusKind } from './race.ts';

const kindsOf = (machine: string): readonly string[] => SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];

/** 3 cars one second apart; everyone's latest crossing is the line at the end of lap 2. */
const ms = () => offsetRace([0, 1_000, 2_000], 2);
const NOT_APPLICABLE = unknown('notApplicable');

/** The view with `kind` open in `machine` instead of what `viewOf` opened there. */
const withOpen = (view: EngineView, machine: string, kind: string): EngineView => {
  const span: OpenSpan = { machine, id: 9, kind, start: 0, confirmed: true, detail: kind === 'suspended' ? { restart: unknown('notReceived') } : undefined, startFrame: 0 };
  return { ...view, situation: { ...view.situation, byMachine: { ...view.situation.byMachine, [machine]: [span] } } };
};

describe('gaps behaviour table (C44)', () => {
  it('is exported with a row for every kind of the sub-machines gaps reads: the weekend phase, the three session phases, car status', () => {
    expect(Object.keys(GAPS_BEHAVIOUR).sort()).toEqual(['car-status', 'session-phase-practice', 'session-phase-qualifying', 'session-phase-race', 'weekend-phase']);
    for (const [machine, rows] of Object.entries(GAPS_BEHAVIOUR)) expect(Object.keys(rows).sort(), machine).toEqual([...kindsOf(machine)].sort());
  });

  it('declares what it reads: the spans of those sub-machines, and no game event any more (the race start is a span)', () => {
    expect(gapsCalculator.reads).toEqual(
      expect.arrayContaining(['spans:weekend-phase', 'spans:car-status', 'spans:session-phase-race', 'spans:session-phase-qualifying', 'spans:session-phase-practice']),
    );
    expect(gapsCalculator.reads).not.toContain('events');
  });
});

describe('weekend-phase rows (C14)', () => {
  const gridded = (kind: Phase) => {
    const cars = carsFor(ms()).map((c) => (c.id === 2 ? { ...c, timing: { ...c.timing, gridPosition: 5 } } : c));
    return run(viewOf(ms(), { cars, kind, phases: kind === 'race' ? [] : [neutralisation({ kind: 'red', machine: `session-phase-${kind === 'none' ? 'practice' : kind}` })] }));
  };

  it('race: the race start, positions gained and the gapper phases apply', () => {
    const out = run(viewOf(ms(), { lightsOutAt: 4_200, phases: [neutralisation({ kind: 'SC', start: 20_000, end: 40_000 })] }));
    expect(out.raceStartAt).toMatchObject({ known: true, value: 4_200 });
    expect(out.phases.map((p) => p.kind)).toEqual(['SC']);
    expect(gridded('race').intervals.find((i) => i.carId === 2)?.positionsGained).toMatchObject({ known: true, value: 2 });
  });

  it.each(['practice', 'qualifying', 'none'] as const)('%s: no race start, no positions gained, no phases; the gaps are still computed', (kind) => {
    const out = gridded(kind);
    expect(out.raceStartAt).toEqual(NOT_APPLICABLE);
    expect(out.intervals.find((i) => i.carId === 2)?.positionsGained).toEqual(NOT_APPLICABLE);
    expect(out.phases).toEqual([]);
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 2]);
    expect(out.intervals[2]?.toLeaderMs).toMatchObject({ known: true, value: 2_000 });
  });
});

describe('session-phase-race rows (C17, C20)', () => {
  const base = () => ({ cars: carsFor(ms()) });

  it.each(['grid', 'formation', 'startLights'] as const)('%s: the race has not started, so the race start is notReceived and no phase is on the chart', (now) => {
    const out = run(viewOf(ms(), { ...base(), lightsOutAt: null, now }));
    expect(out.raceStartAt).toEqual(unknown('notReceived'));
    expect(out.phases).toEqual([]);
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 2]);
  });

  it('racing: the race start is the start of the racing span', () => {
    expect(run(viewOf(ms(), { ...base(), lightsOutAt: 4_200 })).raceStartAt).toMatchObject({ known: true, value: 4_200 });
  });

  it.each([
    ['SC', openNeutralisation({ kind: 'SC', start: 20_000 })],
    ['VSC', openNeutralisation({ kind: 'VSC', start: 20_000 })],
  ] as const)('neutralised (%s): the race start stays that of the first racing span; the open phase is on the chart', (kind, open) => {
    const out = run(viewOf(ms(), { ...base(), lightsOutAt: 4_200, open }));
    expect(out.raceStartAt).toMatchObject({ known: true, value: 4_200 });
    expect(out.phases.map((p) => [p.kind, p.toLap])).toEqual([[kind, NOT_APPLICABLE]]);
  });

  it('neutralised: after the safety car the race start is still that of the first racing span, not the later one (C26)', () => {
    const out = run(viewOf(ms(), { ...base(), lightsOutAt: 4_200, phases: [neutralisation({ kind: 'SC', start: 20_000, end: 40_000 })] }));
    expect(out.raceStartAt).toMatchObject({ known: true, value: 4_200 });
  });

  it('suspended: the red flag is on the chart as a phase', () => {
    const out = run(viewOf(ms(), { ...base(), open: openNeutralisation({ kind: 'red', start: 20_000 }) }));
    expect(out.phases.map((p) => [p.kind, p.toLap])).toEqual([['red', NOT_APPLICABLE]]);
    expect(out.raceStartAt).toMatchObject({ known: true, value: 0 });
  });

  it.each(['finished', 'postSession'] as const)('%s: the race start and the phases of the race stay', (now) => {
    const out = run(viewOf(ms(), { ...base(), lightsOutAt: 4_200, now, phases: [neutralisation({ kind: 'VSC', start: 20_000, end: 40_000 })] }));
    expect(out.raceStartAt).toMatchObject({ known: true, value: 4_200 });
    expect(out.phases.map((p) => p.kind)).toEqual(['VSC']);
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 2]);
  });

  it('a race phase the table has no row for is a bug, not a silent default (C3)', () => {
    const view = withOpen(viewOf(ms()), 'session-phase-race', 'noSuchKind');
    expect(() => run(view)).toThrow(/no row for session-phase-race noSuchKind/);
  });
});

// The race start is known only when the engine saw the lights go out: the first `racing` span follows a `startLights` span
// directly. A span the engine joined in the middle (`joinedAt`) never tells it (C3).
describe('the race start is known only when lights out was seen (C3)', () => {
  type Step = { kind: string; start: number; end?: number; joinedAt?: true };
  /** The race view whose session-phase-race spans are these steps in order; the last without `end` is open. */
  const raceWith = (steps: Step[]): EngineView => {
    const base = viewOf(ms());
    const spans = steps.map((st, id): Span | OpenSpan => ({
      machine: 'session-phase-race',
      id,
      kind: st.kind,
      start: st.start,
      confirmed: true,
      detail: st.kind === 'neutralised' ? { car: 'SC', stages: [] } : undefined,
      startFrame: st.start,
      ...(st.end === undefined ? {} : { end: st.end, endFrame: st.end }),
      ...(st.joinedAt === undefined ? {} : { joinedAt: true as const }),
    }));
    const closed = spans.filter((sp): sp is Span => 'endFrame' in sp);
    const open = spans.filter((sp) => !('endFrame' in sp)) as OpenSpan[];
    return {
      ...base,
      history: { ...base.history, spans: { ...base.history.spans, 'session-phase-race': closed } },
      situation: { ...base.situation, byMachine: { ...base.situation.byMachine, 'session-phase-race': open } },
    };
  };
  const startOf = (steps: Step[]) => run(raceWith(steps)).raceStartAt;

  it('(a) joined under a safety car, then racing: not received, the restart is no race start', () => {
    expect(startOf([{ kind: 'neutralised', start: 5_000, end: 20_000, joinedAt: true }, { kind: 'racing', start: 20_000 }])).toEqual(unknown('notReceived'));
  });

  it('(b) joined in racing: not received', () => {
    expect(startOf([{ kind: 'racing', start: 5_000, joinedAt: true }])).toEqual(unknown('notReceived'));
  });

  it('(c) joined in the formation, then start lights, then racing: the start of the racing span', () => {
    expect(
      startOf([{ kind: 'formation', start: 0, end: 3_000, joinedAt: true }, { kind: 'startLights', start: 3_000, end: 8_000 }, { kind: 'racing', start: 8_000 }]),
    ).toMatchObject({ known: true, value: 8_000 });
  });

  it('(d) seen from the grid: the start of the racing span', () => {
    expect(
      startOf([
        { kind: 'grid', start: 0, end: 1_000 },
        { kind: 'formation', start: 1_000, end: 3_000 },
        { kind: 'startLights', start: 3_000, end: 8_000 },
        { kind: 'racing', start: 8_000, end: 30_000 },
        { kind: 'neutralised', start: 30_000 },
      ]),
    ).toMatchObject({ known: true, value: 8_000 });
  });
});

describe.each(['qualifying', 'practice'] as const)('session-phase-%s rows (C17)', (phase) => {
  const machine = `session-phase-${phase}`;
  it.each(kindsOf(machine))('%s: gaps are computed; there is no race start and no phase band', (kind) => {
    const out = run(withOpen(viewOf(ms(), { kind: phase }), machine, kind));
    expect(out.raceStartAt).toEqual(NOT_APPLICABLE);
    expect(out.phases).toEqual([]);
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 2]);
    expect(out.intervals[1]?.toLeaderMs).toMatchObject({ known: true, value: 1_000 });
  });
});

describe('car-status rows (C17, C43)', () => {
  const race = field({ cars: 4, laps: 2, paceMs: [90_000, 91_000, 92_000, 93_000] }).crossings;
  const outWith = (status: Record<number, StatusKind | 'none'>) => run(viewOf(race, { status }));

  it('competing: in the intervals, not out of the race', () => {
    const out = outWith({});
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 2, 3]);
    expect(out.outOfRace).toEqual([]);
  });

  it.each(['retired', 'disqualified'] as const)('%s: out of the race, listed, with no interval and no neighbour', (status) => {
    const out = outWith({ 1: status, 3: status });
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 2]);
    expect(out.outOfRace).toEqual([1, 3]);
    expect(out.neighbourhood.find((n) => n.ourCarId === carId(0))?.carIds).not.toContain(1);
  });

  it('absent: not in the session, so neither in the intervals nor out of the race', () => {
    const out = outWith({ 2: 'absent' });
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 3]);
    expect(out.outOfRace).toEqual([]);
  });

  it('no car-status span open yet: the car is not in the session', () => {
    const out = outWith({ 2: 'none' });
    expect(out.intervals.map((i) => i.carId)).toEqual([0, 1, 3]);
    expect(out.outOfRace).toEqual([]);
  });

  it('a car that retires between two frames leaves the intervals: update equals init (C31)', () => {
    const before = viewOf(race);
    const after = viewOf(race, { status: { 3: 'retired' } });
    const acc = gapsCalculator.init(guarded(before));
    const updated = gapsCalculator.output(gapsCalculator.update(acc, deltaOf(before, after), guarded(after)));
    expect(updated.outOfRace).toEqual([3]);
    expect(updated).toEqual(run(after));
  });
});
