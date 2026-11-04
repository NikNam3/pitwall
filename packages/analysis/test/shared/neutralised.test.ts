// The shared neutralisations (`shared/neutralised.ts`, Task 19): the readers of the old flag phases (`gaps`, `incidents`,
// `race-moment`) take the session-phase spans instead (C20, C43). `neutralisedSpans` gives the closed `neutralised`
// and `suspended` spans of the session-phase sub-machines from the projection plus the open one from the situation; a
// `neutralised` span closed with `confirmed: false` is no neutralisation (C18), an open one still waiting for its
// confirmation is one (ruling 2). `leaderLapAt` gives the leader's lap at a frame from the projection's laps (ruling 3,
// C26, C45).
import { carId, type LapRecord, type OpenSpan, type Span } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { engineView, lap, neutralisation, openNeutralisation, phaseSpans } from '../../../../test-support/builders/index.ts';
import { raceMomentCalculator } from '../../src/race-moment/calculator.ts';
import { leaderLapAt, neutralisedSpans } from '../../src/shared/neutralised.ts';
import { gaps } from '../gaps/race.ts';
import { incidents, LAPS, leaderLaps, race, viewOf } from '../incidents/race.ts';

/** A closed span of `session-phase-race` of another kind (`racing`, `grid`, ...), from `start` to `end`. */
const phase = (kind: string, start: number, end: number, id: number): Span => ({
  ...neutralisation({ start, end, id }),
  kind,
  detail: undefined,
});

/** The neutralisations of a view over these closed spans and this open one. */
const of = (closed: Span[], open?: OpenSpan, weekendPhase = engineView().situation.weekendPhase) => {
  const { spans, situation } = phaseSpans(closed, open, { weekendPhase, byMachine: {} });
  const view = engineView({ history: { spans }, situation });
  return neutralisedSpans(view.history, view.situation);
};

describe('neutralisedSpans', () => {
  it('is empty without a neutralised or suspended span', () => {
    expect(of([])).toEqual([]);
    expect(of([phase('grid', 0, 10, 0), phase('racing', 10, 500_000, 1)], { ...openNeutralisation({ start: 500_000, id: 2 }), kind: 'racing', detail: undefined })).toEqual([]);
  });

  it('gives the closed neutralised and suspended spans of the race in their order, no other kind', () => {
    const sc = neutralisation({ kind: 'SC', start: 100_000, end: 200_000, id: 2 });
    const red = neutralisation({ kind: 'red', start: 300_000, end: 400_000, id: 4 });
    const vsc = neutralisation({ kind: 'VSC', start: 500_000, end: 560_000, id: 6 });
    const closed = [phase('racing', 0, 100_000, 1), sc, phase('racing', 200_000, 300_000, 3), red, phase('startLights', 400_000, 450_000, 5), vsc];
    expect(of(closed)).toEqual([sc, red, vsc]);
  });

  it('a `neutralised` span closed with `confirmed: false` is no neutralisation (C18, C43)', () => {
    const never = neutralisation({ kind: 'SC', start: 100_000, end: 103_000, confirmed: false, id: 2 });
    const vsc = neutralisation({ kind: 'VSC', start: 200_000, end: 260_000, id: 4 });
    expect(of([never])).toEqual([]);
    expect(of([never, vsc])).toEqual([vsc]);
  });

  it('adds the open neutralisation or suspension of the situation after the closed ones', () => {
    const sc = neutralisation({ kind: 'SC', start: 100_000, end: 200_000, id: 2 });
    const vsc = openNeutralisation({ kind: 'VSC', start: 300_000, id: 4 });
    const red = openNeutralisation({ kind: 'red', start: 300_000, id: 4 });
    expect(of([sc], vsc)).toEqual([sc, vsc]);
    expect(of([sc], red)).toEqual([sc, red]);
    expect(of([], vsc)).toEqual([vsc]);
  });

  it('an open neutralisation still waiting for its confirmation counts (ruling 2: the earliest reliable signal, C18)', () => {
    const pending = openNeutralisation({ kind: 'SC', start: 300_000, confirmed: false, id: 4 });
    expect(of([], pending)).toEqual([pending]);
  });

  it("covers every session-phase sub-machine: a qualifying's suspensions, closed and open", () => {
    const qualifying = { kind: 'qualifying', format: 'grandPrix', segment: 1 } as const;
    const red = neutralisation({ kind: 'red', start: 100_000, end: 400_000, id: 1, machine: 'session-phase-qualifying' });
    const again = openNeutralisation({ kind: 'red', start: 500_000, id: 3, machine: 'session-phase-qualifying' });
    expect(of([red], again, qualifying)).toEqual([red, again]);
  });

  it("and a practice's suspensions, closed and open; the other kinds of either are none", () => {
    const practice = { kind: 'practice', format: 'practice', segment: 1 } as const;
    const machine = 'session-phase-practice';
    const running = { ...neutralisation({ start: 0, end: 100_000, id: 0, machine }), kind: 'running', detail: undefined };
    const red = neutralisation({ kind: 'red', start: 100_000, end: 400_000, id: 1, machine });
    const again = openNeutralisation({ kind: 'red', start: 500_000, id: 3, machine });
    expect(of([running, red], again, practice)).toEqual([red, again]);
  });
});

describe('leaderLapAt', () => {
  /** Car `id`'s lap `n`, completed on frame `frame`. */
  const done = (id: number, n: number, frame: number): LapRecord => lap({ carId: carId(id), lapNumber: n, completedAt: frame, frame });

  it('is lap 1 before any lap is completed', () => {
    expect(leaderLapAt([], 500)).toBe(1);
    expect(leaderLapAt([done(0, 1, 600)], 500)).toBe(1);
  });

  it('is one more than the most laps any car completed by the frame, that frame included', () => {
    const laps = [done(0, 1, 100), done(1, 1, 110), done(0, 2, 200), done(1, 2, 220), done(0, 3, 300)];
    expect(leaderLapAt(laps, 199)).toBe(2);
    expect(leaderLapAt(laps, 200)).toBe(3);
    expect(leaderLapAt(laps, 299)).toBe(3);
    expect(leaderLapAt(laps, 300)).toBe(4);
  });

  it('is the leader whichever car it is: the most laps by then, a lapped car does not lower it', () => {
    const laps = [done(3, 1, 100), done(0, 1, 120), done(3, 2, 200), done(3, 3, 300), done(0, 2, 310)];
    expect(leaderLapAt(laps, 305)).toBe(4);
  });

  it('a provisional lap and the confirmed lap that supersedes it count as one lap (C25)', () => {
    const provisional = { ...done(0, 1, 100), status: 'provisional' as const };
    const confirmed = { ...done(0, 1, 100), supersedes: { list: 'laps' as const, index: 0 } };
    expect(leaderLapAt([provisional], 100)).toBe(2);
    expect(leaderLapAt([provisional, confirmed], 100)).toBe(2);
  });
});

// Ruling 4 (Task 19): the three readers name one source, `neutralisedSpans`, so they agree on what was neutralised (C43).
describe('gaps, incidents and race-moment read the same neutralisations', () => {
  const sc = neutralisation({ kind: 'SC', start: 100_000, end: 160_000, id: 2 });
  const never = neutralisation({ kind: 'SC', start: 300_000, end: 303_000, confirmed: false, id: 4 });
  const pending = openNeutralisation({ kind: 'VSC', start: 600_000, confirmed: false, id: 6 });
  const view = viewOf({ miniSectors: race(), phases: [sc, never], open: pending, laps: leaderLaps(LAPS) });

  // Restated in Task 22 round 2 (C31.2): what each unit and its fold (`<unit>-history`) read together.
  it('each declares the spans of the three session-phase sub-machines that neutralisedSpans reads (C41)', () => {
    for (const unit of [gaps, incidents]) {
      expect(unit.reads(), unit.id).toEqual(expect.arrayContaining(['spans:session-phase-race', 'spans:session-phase-qualifying', 'spans:session-phase-practice']));
    }
    // race-moment is race only (C14, C46): it reads the weekend phase and the race's session phase
    expect(raceMomentCalculator.reads).toEqual(expect.arrayContaining(['spans:weekend-phase', 'spans:session-phase-race']));
  });

  it('the confirmed SC and the pending VSC; the SC never confirmed in none of them', () => {
    expect(gaps.output(gaps.init(view)).phases.map((p) => p.kind)).toEqual(['SC', 'VSC']);
    const feed = incidents.output(incidents.init(view));
    expect(feed.filter((e) => e.kind === 'neutralised').map((e) => e.at)).toEqual([600_000, 100_000]);
    const racing: OpenSpan = { machine: 'weekend-phase', id: 0, kind: 'race', start: 0, confirmed: true, detail: { format: 'grandPrix' }, startFrame: 1 };
    const raceView = { ...view, situation: { ...view.situation, byMachine: { ...view.situation.byMachine, 'weekend-phase': [racing] } } };
    expect(raceMomentCalculator.compute(raceView)).toMatchObject({ known: true, value: { moment: 'neutralised', cause: { params: { kind: 'VSC' } }, since: { value: 600_000 } } });
  });
});
