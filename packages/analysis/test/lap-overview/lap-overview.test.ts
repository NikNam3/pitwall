// `lap-overview` (spec 3.2): `lapOverview.car`, every lap of every car with its stint, compound, kind, best, heat within
// its stint and track status. Builder data, every run through the guarded view (C41). The status is the lap record's
// neutralised time (`lap-classes`' `maxNeutralisedMs`) and the lap's membership (C26): the session-phase spans covering
// the frame the lap describes, closed (the projection) or open (the situation), looked up in the unit's behaviour table
// (C44). Stints by `stintLaps` (closed stints from `history.stints`, the current one after the last record). Each lap
// read in its current version (C25).
import { carId, SPAN_DECLARATIONS, type Known, type LapOverview, type LapOverviewLap, type LapRecord, type OpenSpan, type Span, type StintRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { lapOverviewCalculator } from '../../src/lap-overview/calculator.ts';
import * as lapOverviewIndex from '../../src/lap-overview/index.ts';
import type { LapOverviewOutput } from '../../src/lap-overview/index.ts';
import { lap, neutralisation, RACE_PHASES } from '../../../../test-support/builders/index.ts';
import { guardedQuick, PRACTICE, situatedView, type Situated } from '../situated.ts';

const calc = guardedQuick(lapOverviewCalculator);

/** A lap of car `car` (default 0): `lap()` with these fields. */
const lapOf = (car: number, lapNumber: number, lapTimeMs: number, over: Partial<LapRecord> = {}): LapRecord =>
  lap({ carId: carId(car), lapNumber, lapTimeMs, ...over });

/** An invalid lap's validity. */
const INVALID: LapRecord['valid'] = { lap: false, sectors: [true, false, true] };

/** A closed stint record of car `car`. */
const stint = (car: number, firstLap: number, lastLap: number, over: Partial<StintRecord> = {}): StintRecord => ({
  carId: carId(car),
  firstLap,
  lastLap,
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
  frame: 0,
  ...over,
});

/** A closed session-phase span of `kind` covering frames `[startFrame, endFrame)` (its times the same numbers). */
const closedSpan = (machine: string, kind: string, id: number, startFrame: number, endFrame: number): Span => ({
  machine,
  id,
  kind,
  start: startFrame,
  end: endFrame,
  confirmed: true,
  detail: undefined,
  startFrame,
  endFrame,
});

/** An open session-phase span of `kind` since frame `startFrame` (its time the same number). */
const openSpanFrom = (machine: string, kind: string, id: number, startFrame: number): OpenSpan => ({
  machine,
  id,
  kind,
  start: startFrame,
  confirmed: true,
  detail: undefined,
  startFrame,
});

type ViewSpec = Pick<Situated, 'phase'> & { laps: LapRecord[]; stints?: StintRecord[]; closed?: Span[]; open?: OpenSpan[] };

/**
 * A view (a race unless `phase` says otherwise) whose projection holds `laps`, `stints` and the `closed` spans, and whose
 * situation holds the `open` spans besides the weekend phase's.
 */
function view({ laps, stints = [], closed = [], open = [], phase }: ViewSpec): EngineView {
  const byMachine: Record<string, Span[]> = {};
  for (const span of closed) (byMachine[span.machine] ??= []).push(span);
  return situatedView({ ...(phase !== undefined && { phase }), spans: open, history: { laps, stints, spans: byMachine } });
}

/** Car `car`'s laps in the output. */
const lapsOf = (out: LapOverviewOutput, car: number): LapOverviewLap[] => {
  const v: LapOverview | undefined = out[carId(car)];
  if (v === undefined) throw new Error(`no value for car ${car}`);
  return v.laps;
};

/** Car `car`'s lap `n` in the output. */
const lapIn = (out: LapOverviewOutput, car: number, n: number): LapOverviewLap => {
  const found = lapsOf(out, car).find((l) => l.lapNumber === n);
  if (found === undefined) throw new Error(`car ${car} has no lap ${n}`);
  return found;
};

/** A heat as its value, or its reason when unknown. */
const heat = (k: Known<number>): number | string => (k.known ? k.value : k.reason);

/**
 * The long-run view: car 0's first stint (laps 1 to 5, soft, closed record): lap 1 of the race (no pace lap), three pace
 * laps 90 000, 90 500, 91 000, an in lap; its current stint (no record yet): an out lap and one pace lap, medium. Car 1
 * (a rival, no stint record): laps 1 to 3, 91 000, 91 500, 92 000.
 */
const longRun = (): EngineView =>
  view({
    laps: [
      lapOf(0, 1, 92_000),
      lapOf(0, 2, 90_000),
      lapOf(0, 3, 90_500),
      lapOf(0, 4, 91_000),
      lapOf(0, 5, 95_000, { inLap: true }),
      lapOf(0, 6, 100_000, { outLap: true, visualCompound: 'medium', actualCompound: 'C2' }),
      lapOf(0, 7, 89_500, { visualCompound: 'medium', actualCompound: 'C2' }),
      lapOf(1, 1, 91_000),
      lapOf(1, 2, 91_500),
      lapOf(1, 3, 92_000),
    ],
    stints: [stint(0, 1, 5)],
  });

describe('lap-overview: heat, kind and stints', () => {
  it('1. a stint with forPace laps 90 000, 90 500, 91 000 has heat 0, 0.5, 1; lap 1 of the race has none', () => {
    const out = calc.compute(longRun());
    expect([2, 3, 4].map((n) => heat(lapIn(out, 0, n).heat))).toEqual([0, 0.5, 1]);
    expect(heat(lapIn(out, 0, 1).heat)).toBe('notApplicable');
    expect([1, 2, 3, 4].map((n) => lapIn(out, 0, n).kind)).toEqual(['normal', 'normal', 'normal', 'normal']);
  });

  it('2. its in lap and the next stint\'s out lap: kind in / out, heat notApplicable', () => {
    const out = calc.compute(longRun());
    expect(lapIn(out, 0, 5).kind).toBe('in');
    expect(heat(lapIn(out, 0, 5).heat)).toBe('notApplicable');
    expect(lapIn(out, 0, 6).kind).toBe('out');
    expect(heat(lapIn(out, 0, 6).heat)).toBe('notApplicable');
  });

  it('4. a stint with one forPace lap: its heat is notApplicable', () => {
    const out = calc.compute(longRun());
    expect(lapIn(out, 0, 7).kind).toBe('normal');
    expect(heat(lapIn(out, 0, 7).heat)).toBe('notApplicable');
  });

  it('6. stint index (from 1) and visual compound from the stints and the lap record; the current stint after a closed one gets the next index', () => {
    const out = calc.compute(longRun());
    expect(lapsOf(out, 0).map((l) => [l.lapNumber, l.stint, l.compound])).toEqual([
      [1, 1, 'soft'],
      [2, 1, 'soft'],
      [3, 1, 'soft'],
      [4, 1, 'soft'],
      [5, 1, 'soft'],
      [6, 2, 'medium'],
      [7, 2, 'medium'],
    ]);
    // a car without a stint record has one stint
    expect(lapsOf(out, 1).map((l) => l.stint)).toEqual([1, 1, 1]);
  });

  it('8. a rival car has its laps too, with its own heat; every lap carries its time, in lap order', () => {
    const out = calc.compute(longRun());
    expect(lapsOf(out, 1).map((l) => [l.lapNumber, l.lapTimeMs, heat(l.heat)])).toEqual([
      [1, 91_000, 'notApplicable'],
      [2, 91_500, 0],
      [3, 92_000, 1],
    ]);
    expect(lapsOf(out, 0).map((l) => l.lapNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('lap-overview: bests', () => {
  /** Car 0: 90 000, an invalid 89 000, 89 500; car 1: 89 800, 90 200; car 2: 91 000. */
  const BEST_LAPS: LapRecord[] = [
    lapOf(0, 1, 90_000),
    lapOf(0, 2, 89_000, { valid: INVALID }),
    lapOf(0, 3, 89_500),
    lapOf(1, 1, 89_800),
    lapOf(1, 2, 90_200),
    lapOf(2, 1, 91_000),
  ];
  const bests = (out: LapOverviewOutput, car: number): string[] => lapsOf(out, car).map((l) => l.best);

  it('3. the session\'s fastest forBest lap is session (once), each other car\'s fastest personal, others none; a later faster lap moves the mark', () => {
    const out = calc.compute(view({ laps: BEST_LAPS }));
    // the invalid 89 000 is no best
    expect(bests(out, 0)).toEqual(['none', 'none', 'session']);
    expect(bests(out, 1)).toEqual(['personal', 'none']);
    expect(bests(out, 2)).toEqual(['personal']);
    const all = [0, 1, 2].flatMap((car) => bests(out, car));
    expect(all.filter((b) => b === 'session')).toHaveLength(1);

    const later = calc.compute(view({ laps: [...BEST_LAPS, lapOf(1, 3, 89_000)] }));
    expect(bests(later, 0)).toEqual(['none', 'none', 'personal']);
    expect(bests(later, 1)).toEqual(['none', 'none', 'session']);
    expect(bests(later, 2)).toEqual(['personal']);
  });
});

describe('lap-overview: status', () => {
  /**
   * Race: racing in frames [0, 600), suspended in [600, 700) (closed), racing again from 700 (open). Car 0: SC, VSC and
   * both on laps 2 to 4; a restart lap with 900 ms of SC; a lap whose crossing is in the suspension (with SC share);
   * a plain lap. Car 1: a lap before the red flag, and one during which it came out but completed after the restart.
   */
  const statusView = (): EngineView =>
    view({
      laps: [
        lapOf(0, 2, 90_000, { scShare: 0.3, frame: 200 }),
        lapOf(0, 3, 90_000, { vscShare: 0.2, frame: 300 }),
        lapOf(0, 4, 90_000, { scShare: 0.1, vscShare: 0.1, frame: 400 }),
        lapOf(0, 5, 90_000, { scShare: 0.01, frame: 500 }),
        lapOf(0, 6, 90_000, { scShare: 0.3, frame: 650 }),
        lapOf(0, 7, 90_000, { frame: 800 }),
        lapOf(1, 1, 90_000, { frame: 550 }),
        lapOf(1, 2, 90_000, { frame: 720 }),
      ],
      closed: [closedSpan(RACE_PHASES, 'racing', 0, 0, 600), neutralisation({ kind: 'red', id: 1, start: 600, end: 700 })],
      open: [openSpanFrom(RACE_PHASES, 'racing', 2, 700)],
    });

  it('5. sc / vsc by neutralised time at or above maxNeutralisedMs, red from a suspended span in the lap\'s membership, else green', () => {
    const out = calc.compute(statusView());
    expect(lapsOf(out, 0).map((l) => [l.lapNumber, l.status])).toEqual([
      [2, 'sc'],
      [3, 'vsc'],
      [4, 'sc'],
      // the restart lap: 900 ms of SC, below 2 000
      [5, 'green'],
      // its crossing is in the suspension: red wins over its SC share
      [6, 'red'],
      [7, 'green'],
    ]);
    // the red flag came out during the lap, but the lap completed after the restart: not red
    expect(lapsOf(out, 1).map((l) => [l.lapNumber, l.status])).toEqual([
      [1, 'green'],
      [2, 'green'],
    ]);

    // a lap completed while the suspension is still open (the situation's span)
    const open = calc.compute(
      view({
        laps: [lapOf(0, 1, 90_000, { frame: 50 }), lapOf(0, 2, 90_000, { frame: 950 })],
        closed: [closedSpan(RACE_PHASES, 'racing', 0, 0, 900)],
        open: [openSpanFrom(RACE_PHASES, 'suspended', 1, 900)],
      }),
    );
    expect(lapsOf(open, 0).map((l) => l.status)).toEqual(['green', 'red']);

    // a practice session's suspension (session-phase-practice)
    const practice = calc.compute(
      view({
        phase: PRACTICE,
        laps: [lapOf(0, 1, 90_000, { frame: 50 }), lapOf(0, 2, 90_000, { frame: 150 }), lapOf(0, 3, 90_000, { frame: 250 })],
        closed: [
          closedSpan('session-phase-practice', 'running', 0, 0, 100),
          closedSpan('session-phase-practice', 'suspended', 1, 100, 200),
        ],
        open: [openSpanFrom('session-phase-practice', 'running', 2, 200)],
      }),
    );
    expect(lapsOf(practice, 0).map((l) => l.status)).toEqual(['green', 'red', 'green']);
  });
});

describe('lap-overview: current versions', () => {
  it('7. a provisional lap superseded by its confirmed record is one block with the confirmed time', () => {
    const provisional = lapOf(0, 1, 90_100, { status: 'provisional', frame: 10 });
    const next = lapOf(0, 2, 91_000, { status: 'provisional', frame: 20 });
    const confirmed = lapOf(0, 1, 90_000, { status: 'confirmed', frame: 10, supersedes: { list: 'laps', index: 0 } });
    const out = calc.compute(view({ laps: [provisional, next, confirmed] }));
    expect(lapsOf(out, 0).map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([
      [1, 90_000],
      [2, 91_000],
    ]);
  });
});

describe('lap-overview: behaviour table (C44)', () => {
  it('8. suspended → red, every other session-phase kind {}, the weekend phase as degradation\'s; complete over what the unit reads', () => {
    const table = (lapOverviewIndex as Record<string, unknown>)['LAP_OVERVIEW_BEHAVIOUR'];
    const sessionPhase = (machine: string): Record<string, object> => {
      const kinds = SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];
      return Object.fromEntries(kinds.map((k) => [k, k === 'suspended' ? { red: true } : {}]));
    };
    expect(table).toEqual({
      'weekend-phase': { practice: { isRace: false }, qualifying: { isRace: false }, race: { isRace: true }, none: { isRace: false } },
      'session-phase-race': sessionPhase('session-phase-race'),
      'session-phase-qualifying': sessionPhase('session-phase-qualifying'),
      'session-phase-practice': sessionPhase('session-phase-practice'),
    });
    expect(Object.keys(sessionPhase('session-phase-race'))).toContain('suspended');
  });
});
