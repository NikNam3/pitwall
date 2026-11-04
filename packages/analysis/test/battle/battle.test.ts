// `battle` (spec 6.3): our cars against the car ahead and behind, from `gaps` and `pace` outputs.
import { carId, known, unknown, type BattleCard, type CarId, type CarState, type DrsOffReason, type DrsStatus, type Interval, type Known, type MachineId, type Ms, type OpenSpan, type Span } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BATTLE, BATTLE_BEHAVIOUR, BATTLE_CONFIG } from '../../src/battle/index.ts';
import { battleCalculator } from '../../src/battle/calculator.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';
import type { Pace } from '../../src/pace/index.ts';
import { carState, engineView, realismHidden, type DeepPartial } from '../../../../test-support/builders/index.ts';

type Line = { lap: number; at: number }[];
const id = (n: number): CarId => carId(n);
type PaceEntry = Pace['byCar'][CarId];
const paceOf = (recent: Known<Ms>): PaceEntry => ({ recentMs: recent, stintMs: recent, samples: 3 });

/** Line times at laps 1..n from a start offset and per-lap gaps to a reference that crosses at lap * 100 s. */
const lines = (reference: number[]): Line => reference.map((at, i) => ({ lap: i + 1, at }));
const AHEAD_LINES = lines([100_000, 200_000, 300_000]);
const plus = (base: Line, gaps: number[]): Line => base.map((l, i) => ({ lap: l.lap, at: l.at + gaps[i]! }));

type Scene = {
  /** Cars as `[id, position, over]`. */
  cars: [number, number, Partial<CarState['timing']>?][];
  lineTimes: Record<number, Line>;
  /** The cars in the order of `gaps.intervals` (retired and disqualified cars are already left out there). */
  order?: number[];
  pace?: Record<number, Known<Ms>>;
  /** The weekend phase (`weekend-phase`'s open span); a race by default. */
  phase?: 'race' | 'practice' | 'qualifying' | 'none';
  teammate?: number;
  hidden?: number[];
  /** Overrides of a car's state, by id. */
  carOver?: Record<number, DeepPartial<CarState>>;
  config?: EngineView['config'];
  /** Race control's DRS (`race-control-race`'s open span, C20); by default `drsOn`. `none`: no span open (outside a race). */
  drs?: Drs | 'none';
  /** The `race-control-race` spans closed before the open one. */
  closedDrs?: Span[];
};

type Drs = 'drsOn' | { off: DrsOffReason };
const RC: MachineId = 'race-control-race';
const WP: MachineId = 'weekend-phase';

/** An open span as `view.situation` holds it (C20). */
const open = (machine: MachineId, id: number, kind: string, detail?: unknown): OpenSpan => ({ machine, id, kind, start: 0, startFrame: 1, confirmed: true, detail });
/** A closed `race-control-race` span of the history. */
const closedDrs = (id: number, drs: Drs, start: number, end: number): Span => ({
  ...open(RC, id, drs === 'drsOn' ? 'drsOn' : 'drsOff', drs === 'drsOn' ? undefined : { reason: drs.off }),
  start,
  startFrame: start,
  end,
  endFrame: end,
});
/** The view's situation: the weekend phase and race control's DRS as open spans, the weekend phase also as `weekendPhase`. */
const situationOf = (phase: NonNullable<Scene['phase']>, drs: Drs | 'none'): EngineView['situation'] => ({
  weekendPhase:
    phase === 'none'
      ? { kind: 'none' }
      : phase === 'race'
        ? { kind: 'race', format: 'grandPrix' }
        : phase === 'practice'
          ? { kind: 'practice', format: 'practice', segment: undefined }
          : { kind: 'qualifying', format: 'grandPrix', segment: undefined },
  byMachine: {
    [WP]: [open(WP, 0, phase, phase === 'none' ? undefined : { format: phase === 'practice' ? 'practice' : 'grandPrix' })],
    ...(drs === 'none' ? {} : { [RC]: [drs === 'drsOn' ? open(RC, 1, 'drsOn') : open(RC, 1, 'drsOff', { reason: drs.off })] }),
  },
});

const build = (s: Scene): EngineView => {
  const cars = s.cars.map(([n, position, timing]) => {
    const car = carState({ id: id(n), timing: { position }, ...s.carOver?.[n] });
    Object.assign(car.timing, timing);
    return s.hidden?.includes(n) ? realismHidden(car) : car;
  });
  const interval = (n: number): Interval => ({
    carId: id(n),
    toLeaderMs: known(0, 311_600),
    // what `gaps` computed at the latest common segment: ahead 1.6 s at 311.6 s, behind 2.2 s at 313.8 s
    toAheadMs: known(n === 0 ? 1600 : 3000, 311_600),
    toBehindMs: known(n === 0 ? 2200 : 1600, 313_800),
    lapsDown: 0,
    positionsGained: known(0, 311_600),
  });
  // the fields battle may read; the rest of the output is not battle's business
  const gaps: Pick<GapsOutput, 'phases' | 'intervals' | 'lineTimes' | 'recent' | 'neighbourhood' | 'raceStartAt'> = {
    phases: [],
    intervals: (s.order ?? [1, 0, 3]).map(interval),
    lineTimes: Object.fromEntries(Object.entries(s.lineTimes).map(([k, v]) => [k, v])) as GapsOutput['lineTimes'],
    recent: {},
    neighbourhood: [],
    raceStartAt: known(0, 0),
  };
  const pace: Pace = {
    byCar: Object.fromEntries(Object.entries(s.pace ?? {}).map(([k, v]) => [k, paceOf(v)])) as Pace['byCar'],
  };
  const view = engineView({
    cars,
    outputs: new Map<string, unknown>([['gaps', gaps], ['pace', pace]]),
    history: { spans: s.closedDrs === undefined ? {} : { [RC]: s.closedDrs } },
    situation: situationOf(s.phase ?? 'race', s.drs ?? 'drsOn'),
    ...(s.config && { config: s.config }),
  });
  return s.teammate === undefined ? view : { ...view, live: { ...view.live, teammateCar: id(s.teammate) } };
};

/** Car 0 (ours, P3) between car 1 (P2, ahead) and car 3 (P4, behind); gaps 2.4, 2.0, 1.6 s ahead and 3.0, 2.6, 2.2 s behind. */
const base = (over: Partial<Scene> = {}): Scene => {
  const ours = plus(AHEAD_LINES, [2400, 2000, 1600]);
  return {
    cars: [[0, 3], [1, 2], [3, 4]],
    lineTimes: { 1: AHEAD_LINES, 0: ours, 3: plus(ours, [3000, 2600, 2200]) },
    pace: {
      0: known(90_000, 50_000),
      1: known(92_500, 60_000),
      3: known(89_500, 55_000),
    },
    ...over,
  };
};

const card = (view: EngineView, n = 0) => battleCalculator.compute(view)[id(n)]!;

describe('battle', () => {
  it('is the quick calculator battle at 2 Hz reading gaps, pace, tyres and energy', () => {
    expect(battleCalculator.id).toBe(BATTLE);
    expect(battleCalculator.kind).toBe('quick');
    expect(battleCalculator.cadence).toEqual({ hz: 2 });
    expect(battleCalculator.reads).toEqual(
      expect.arrayContaining([{ calculator: 'gaps' }, { calculator: 'pace' }, 'tyres', 'energy']),
    );
  });

  it('declares what it reads: race control\'s and the weekend phase\'s spans (C41), the identity of our cars, no events', () => {
    expect(battleCalculator.reads).toEqual(expect.arrayContaining(['spans:race-control-race', 'spans:weekend-phase', 'identity']));
    expect(battleCalculator.reads).not.toContain('events');
  });

  it('exports a behaviour table covering race control\'s and the weekend phase\'s kinds (C44)', () => {
    expect(Object.keys(BATTLE_BEHAVIOUR).sort()).toEqual(['race-control-race', 'weekend-phase']);
  });

  it('gap behind 2.4, 2.0, 1.6 s at the last three line crossings: closing 400 ms/lap, lapsToDrs 1.5', () => {
    const ahead = card(build(base())).ahead;
    expect(ahead).toMatchObject({ known: true });
    if (!ahead.known) return;
    expect(ahead.value.carId).toBe(id(1));
    // the gap now is our `toAheadMs` of gaps.intervals, passed through with its `at`
    expect(ahead.value.gapMs).toEqual({ known: true, value: 1600, at: 311_600 });
    // the rate rests on the line times; its `at` is the later car's line time of the newest lap
    expect(ahead.value.closingMsPerLap).toEqual({ known: true, value: 400, at: 301_600 });
    expect(ahead.value.lapsToDrs).toEqual({ known: true, value: 1.5, at: 301_600 });
  });

  it('an unknown interval gap stays unknown with its reason', () => {
    const view = build(base());
    const gaps = view.outputs.get('gaps') as GapsOutput;
    gaps.intervals.find((i) => i.carId === id(0))!.toAheadMs = unknown('notReceived');
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.gapMs).toMatchObject({ known: false, reason: 'notReceived' });
  });

  it('the car behind: its gap is its line time minus ours; closing positive when it catches up', () => {
    const behind = card(build(base())).behind;
    expect(behind).toMatchObject({ known: true });
    if (!behind.known) return;
    expect(behind.value.carId).toBe(id(3));
    expect(behind.value.gapMs).toEqual({ known: true, value: 2200, at: 313_800 });
    expect(behind.value.closingMsPerLap).toEqual({ known: true, value: 400, at: 303_800 });
    expect(behind.value.lapsToDrs).toEqual({ known: true, value: 3, at: 303_800 });
    // we are slower than the car behind: negative paceDelta
    expect(behind.value.paceDeltaMs).toEqual({ known: true, value: -500, at: 55_000 });
  });

  it('the gap growing: closing negative, lapsToDrs notApplicable', () => {
    const ours = plus(AHEAD_LINES, [1600, 2000, 2400]);
    const view = build(base({ lineTimes: { ...base().lineTimes, 0: ours } }));
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.closingMsPerLap).toMatchObject({ known: true, value: -400 });
    expect(ahead.value.lapsToDrs).toMatchObject({ known: false, reason: 'notApplicable' });
  });

  it('a gap inside DRS range is 0 laps to DRS as of the gap, even without a closing rate', () => {
    const view = build(base({ config: { [BATTLE_CONFIG.key]: { drsRangeMs: 1600 } } }));
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.lapsToDrs).toEqual({ known: true, value: 0, at: 311_600 });
    const two = (l: Line): Line => l.slice(0, 2);
    const t = base().lineTimes;
    const few = card(build(base({ lineTimes: { 0: two(t[0]!), 1: two(t[1]!), 3: two(t[3]!) }, config: { [BATTLE_CONFIG.key]: { drsRangeMs: 1600 } } }))).ahead;
    if (!few.known) throw new Error('ahead unknown');
    expect(few.value.closingMsPerLap).toMatchObject({ known: false, reason: 'insufficientData' });
    expect(few.value.lapsToDrs).toEqual({ known: true, value: 0, at: 311_600 });
  });

  it('fewer than the rate window needs: closing and lapsToDrs insufficientData', () => {
    const two = (l: Line): Line => l.slice(0, 2);
    const t = base().lineTimes;
    const view = build(base({ lineTimes: { 0: two(t[0]!), 1: two(t[1]!), 3: two(t[3]!) } }));
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.closingMsPerLap).toMatchObject({ known: false, reason: 'insufficientData' });
    expect(ahead.value.lapsToDrs).toMatchObject({ known: false, reason: 'insufficientData' });
    expect(ahead.value.gapMs).toMatchObject({ known: true, value: 1600 });
  });

  it('paceDeltaMs positive when we are faster; overtakeMarginMs = paceDelta − 1000', () => {
    const ahead = card(build(base())).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    // their recent mean 92.5 s minus ours 90 s; `at` is the later of the two paces' times
    expect(ahead.value.paceDeltaMs).toEqual({ known: true, value: 2500, at: 60_000 });
    expect(ahead.value.overtakeMarginMs).toEqual({ known: true, value: 1500, at: 60_000 });
  });

  it('the overtaking threshold comes from the config', () => {
    const view = build(base({ config: { [BATTLE_CONFIG.key]: { overtakeThresholdMs: 2000 } } }));
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.overtakeMarginMs).toMatchObject({ known: true, value: 500 });
  });

  it('the DRS range comes from the config', () => {
    const view = build(base({ config: { [BATTLE_CONFIG.key]: { drsRangeMs: 800 } } }));
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.lapsToDrs).toMatchObject({ known: true, value: 2 });
  });

  it('a missing pace of either car: paceDelta and margin are unknown with the reason', () => {
    const view = build(base({ pace: { 0: unknown('insufficientData'), 1: known(92_500, 60_000), 3: known(89_500, 55_000) } }));
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.paceDeltaMs).toMatchObject({ known: false, reason: 'insufficientData' });
    expect(ahead.value.overtakeMarginMs).toMatchObject({ known: false, reason: 'insufficientData' });
  });

  it('compound and tyre age of both cars come from the car states', () => {
    const view = build(
      base({ carOver: { 0: { tyres: { visualCompound: 'medium', age: 7 } }, 1: { tyres: { visualCompound: 'hard', age: 12 } } } }),
    );
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.ours).toEqual({ compound: 'medium', age: 7 });
    expect(ahead.value.theirs).toEqual({ compound: 'hard', age: 12 });
  });

  it('their ERS store is the car state value with its time', () => {
    const ers = known({ storeJ: 2_500_000, mode: 'medium' as const, harvestedMgukJ: 0, harvestedMguhJ: 0, deployedJ: 0 }, 42_000);
    const view = build(base({ carOver: { 1: { energy: { ers } } } }));
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.theirErsStoreJ).toEqual({ known: true, value: 2_500_000, at: 42_000 });
  });

  it('no car ahead (we lead): ahead is notApplicable', () => {
    const view = build(base({ cars: [[0, 1], [1, 2], [3, 3]], order: [0, 1, 3] }));
    const c = card(view);
    expect(c.carId).toBe(id(0));
    expect(c.ahead).toMatchObject({ known: false, reason: 'notApplicable' });
    expect(c.behind).toMatchObject({ known: true });
  });

  it('no car behind (we are last): behind is notApplicable', () => {
    const view = build(base({ cars: [[0, 4], [1, 3], [3, 2]], order: [3, 1, 0] }));
    expect(card(view).behind).toMatchObject({ known: false, reason: 'notApplicable' });
  });

  it('a retired car is never ahead or behind: the neighbours are those of gaps.intervals', () => {
    const ours = plus(AHEAD_LINES, [2400, 2000, 1600]);
    const view = build(
      base({
        // positions: car 2 P1, car 1 P2 (retired), car 0 P3 (ours), car 3 P4 (disqualified), car 4 P5
        // (Task 24: the result status left the live state; gaps.intervals' order alone leaves cars 1 and 3 out)
        cars: [[2, 1], [1, 2], [0, 3], [3, 4], [4, 5]],
        lineTimes: { 2: AHEAD_LINES, 1: AHEAD_LINES, 0: ours, 3: plus(ours, [500, 500, 500]), 4: plus(ours, [3000, 2600, 2200]) },
        order: [2, 0, 4],
        pace: { 0: known(90_000, 1), 1: known(90_000, 1), 2: known(92_500, 1), 3: known(90_000, 1), 4: known(90_000, 1) },
      }),
    );
    const c = card(view);
    if (!c.ahead.known || !c.behind.known) throw new Error('ahead or behind unknown');
    expect(c.ahead.value.carId).toBe(id(2));
    expect(c.behind.value.carId).toBe(id(4));
    expect(c.ahead.value.gapMs).toMatchObject({ known: true, value: 1600 });
  });

  it('when every car ahead is retired there is no car ahead', () => {
    const view = build(base({ cars: [[0, 2], [1, 1], [3, 3]], order: [0, 3] }));
    expect(card(view).ahead).toMatchObject({ known: false, reason: 'notApplicable' });
  });

  it('realism: theirErsStoreJ unknown(realism), the rest still known', () => {
    const view = build(base({ hidden: [1, 3] }));
    const c = card(view);
    for (const side of [c.ahead, c.behind]) {
      if (!side.known) throw new Error('side unknown');
      expect(side.value.theirErsStoreJ).toMatchObject({ known: false, reason: 'realism' });
      expect(side.value.gapMs).toMatchObject({ known: true });
      expect(side.value.closingMsPerLap).toMatchObject({ known: true });
      expect(side.value.lapsToDrs).toMatchObject({ known: true });
      expect(side.value.paceDeltaMs).toMatchObject({ known: true });
      expect(side.value.overtakeMarginMs).toMatchObject({ known: true });
      expect(side.value.theirs).toEqual({ compound: 'soft', age: 0 });
    }
  });

  it('one card per car of ours: the player and the teammate', () => {
    expect(Object.keys(battleCalculator.compute(build(base()))).sort()).toEqual(['0']);
    const view = build(base({ teammate: 1 }));
    const out = battleCalculator.compute(view);
    expect(Object.keys(out).sort()).toEqual(['0', '1']);
    expect(out[id(1)]!.carId).toBe(id(1));
    // the teammate (P2) has our car behind it
    const behind = out[id(1)]!.behind;
    if (!behind.known) throw new Error('behind unknown');
    expect(behind.value.carId).toBe(id(0));
  });

  it('outside the race: every card notApplicable', () => {
    const out = battleCalculator.compute(build(base({ phase: 'practice', drs: 'none', teammate: 1 })));
    expect(Object.keys(out).sort()).toEqual(['0', '1']);
    for (const c of Object.values(out)) {
      expect(c.ahead).toMatchObject({ known: false, reason: 'notApplicable' });
      expect(c.behind).toMatchObject({ known: false, reason: 'notApplicable' });
    }
  });
});

describe('battle: the closing rate has the sign of the gap change', () => {
  /** A gap at each of `laps` line crossings that moves the same way every lap: from `start`, by one of `steps` per lap. */
  const series = fc.record({
    start: fc.integer({ min: 12_000, max: 20_000 }),
    steps: fc.array(fc.integer({ min: 1, max: 2_000 }), { minLength: 2, maxLength: 6 }),
    falling: fc.boolean(),
  });
  const gapsOf = ({ start, steps, falling }: { start: number; steps: number[]; falling: boolean }): number[] =>
    [0, ...steps].map((_, i) => start + (falling ? -1 : 1) * steps.slice(0, i).reduce((a, b) => a + b, 0));
  const closing = (side: ReturnType<typeof card>['ahead']): number => {
    if (!side.known || !side.value.closingMsPerLap.known) throw new Error('no closing rate');
    return side.value.closingMsPerLap.value;
  };

  it('property: a gap to the car ahead that falls every lap closes (positive), one that grows every lap opens (negative)', () => {
    fc.assert(
      fc.property(series, (s) => {
        const gaps = gapsOf(s);
        const ahead = lines(gaps.map((_, i) => (i + 1) * 100_000));
        const view = build(base({ lineTimes: { 1: ahead, 0: plus(ahead, gaps), 3: plus(plus(ahead, gaps), gaps.map(() => 3_000)) } }));
        expect(Math.sign(closing(card(view).ahead))).toBe(s.falling ? 1 : -1);
      }),
    );
  });

  it('property: a car behind whose gap falls every lap closes on us (positive), one that drops back opens (negative)', () => {
    fc.assert(
      fc.property(series, (s) => {
        const gaps = gapsOf(s);
        const ahead = lines(gaps.map((_, i) => (i + 1) * 100_000));
        const ours = plus(ahead, gaps.map(() => 3_000));
        const view = build(base({ lineTimes: { 1: ahead, 0: ours, 3: plus(ours, gaps) } }));
        expect(Math.sign(closing(card(view).behind))).toBe(s.falling ? 1 : -1);
      }),
    );
  });
});

describe('battle: the behaviour table (C44), one test per row', () => {
  const ENABLED: DrsStatus = { enabled: true };
  const lapsToDrsOf = (c: BattleCard) => [c.ahead, c.behind].map((s) => (s.known ? s.value.lapsToDrs : s));
  const wholeCard = card(build(base()));
  if (!wholeCard.ahead.known || !wholeCard.behind.known) throw new Error('a side unknown');
  const sidesOff = (c: BattleCard) => {
    if (!c.ahead.known || !c.behind.known) throw new Error('a side unknown');
    return c;
  };

  describe('weekend-phase', () => {
    it('race: the cards are computed (both sides known, lapsToDrs known while DRS is on)', () => {
      const c = sidesOff(card(build(base({ phase: 'race' }))));
      expect(c.ahead.known && c.ahead.value.carId).toBe(id(1));
      expect(c.behind.known && c.behind.value.carId).toBe(id(3));
      expect(lapsToDrsOf(c)).toEqual([{ known: true, value: 1.5, at: 301_600 }, { known: true, value: 3, at: 303_800 }]);
    });

    for (const phase of ['practice', 'qualifying', 'none'] as const) {
      it(`${phase}: both sides notApplicable (C14); the card still carries the DRS status, enabled (no race control)`, () => {
        expect(card(build(base({ phase, drs: 'none' })))).toEqual({
          carId: id(0),
          ahead: unknown('notApplicable'),
          behind: unknown('notApplicable'),
          drs: ENABLED,
        });
      });
    }

    // Task 24 (C13): the live state has no session kind; the weekend phase is the one source
    it('a phase decides alone: the table makes a practice not applicable', () => {
      const view = build(base({ phase: 'practice', drs: 'none' }));
      expect(card(view).ahead).toEqual(unknown('notApplicable'));
    });
  });

  describe('race-control-race', () => {
    it('drsOn: every card has DRS enabled and lapsToDrs known', () => {
      const out = battleCalculator.compute(build(base({ teammate: 1, drs: 'drsOn' })));
      expect(Object.values(out).map((c) => [c.carId, c.drs])).toEqual([[id(0), ENABLED], [id(1), ENABLED]]);
      expect(lapsToDrsOf(out[id(0)]!)).toEqual([{ known: true, value: 1.5, at: 301_600 }, { known: true, value: 3, at: 303_800 }]);
    });

    for (const reason of ['notEnabledYet', 'wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached', 'unknown'] as const) {
      it(`drsOff (${reason}): every card has DRS off with the span's reason; lapsToDrs notApplicable, the other fields those of drsOn`, () => {
        const out = battleCalculator.compute(build(base({ teammate: 1, drs: { off: reason } })));
        for (const c of Object.values(out)) expect(c.drs).toEqual({ enabled: false, reason });
        const on = sidesOff(card(build(base())));
        const off = sidesOff(card(build(base({ drs: { off: reason } }))));
        if (!on.ahead.known || !on.behind.known || !off.ahead.known || !off.behind.known) throw new Error('a side unknown');
        expect(off.ahead.value).toEqual({ ...on.ahead.value, lapsToDrs: unknown('notApplicable') });
        expect(off.behind.value).toEqual({ ...on.behind.value, lapsToDrs: unknown('notApplicable') });
      });
    }

    it('drsOff: a side already inside DRS range has lapsToDrs notApplicable, not 0', () => {
      const view = build(base({ drs: { off: 'notEnabledYet' }, config: { [BATTLE_CONFIG.key]: { drsRangeMs: 1600 } } }));
      expect(lapsToDrsOf(card(view))).toEqual([unknown('notApplicable'), unknown('notApplicable')]);
    });

    it('drsOn after a closed drsOff of the history: lapsToDrs is known again; only the open span counts', () => {
      const c = card(build(base({ drs: 'drsOn', closedDrs: [closedDrs(0, { off: 'wetTrack' }, 0, 200_000)] })));
      expect(c.drs).toEqual(ENABLED);
      expect(lapsToDrsOf(c)).toEqual([{ known: true, value: 1.5, at: 301_600 }, { known: true, value: 3, at: 303_800 }]);
    });

    it('a race joined late (a drsOn span from the join, no DRS event in the history): the same card as with a full history', () => {
      const late = card(build(base({ drs: 'drsOn' })));
      expect(late).toEqual(wholeCard);
      expect(late.drs).toEqual(ENABLED);
    });


    it('a race without the gaps and pace outputs: the card still carries the DRS status', () => {
      const view = engineView({ cars: [carState({ id: id(0) })], situation: situationOf('race', { off: 'redFlag' }) });
      expect(card(view)).toEqual({
        carId: id(0),
        ahead: unknown('notReceived'),
        behind: unknown('notReceived'),
        drs: { enabled: false, reason: 'redFlag' },
      });
    });
  });
});
