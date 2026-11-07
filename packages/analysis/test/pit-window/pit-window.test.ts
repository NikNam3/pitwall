// `pit-window` (SP4.2 spec 3.4, 6.1): per our car the fitted set's latest stop lap and, per compound we still have a new
// set of, the window from which it reaches the flag; the car's `window` state. Builder data; `tyre-life`'s output is
// passed explicitly; every case runs through the guarded view (C41); race only, a pending phase reads as the race (C14).
import {
  carId,
  known,
  SPAN_DECLARATIONS,
  unknown,
  type ActualCompound,
  type Known,
  type LapRecord,
  type OpenSpan,
  type PitStopRecord,
  type PitWindow,
  type PitWindowSet,
  type Span,
  type StintRecord,
  type TyreSet,
  type VisualCompound,
  type WeekendPhase,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PIT_WINDOW_BEHAVIOUR } from '../../src/pit-window/behaviour.ts';
import { pitWindowCalculator } from '../../src/pit-window/calculator.ts';
import { PIT_WINDOW, PIT_WINDOW_CONFIG, type PitWindowOutput } from '../../src/pit-window/index.ts';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../../src/tyre-life/index.ts';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import { guardedQuick, NONE, openSpan, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';

const calc = guardedQuick(pitWindowCalculator);

/** Our car (the player's, `playerCar` 0) and a rival. */
const US = 0;
const RIVAL = 1;
/** The race's lap count (`session.totalLaps`). */
const FLAG = 52;
/** Every lap takes 90 s: lap `n` is completed at `n · LAP_MS`, describing the frame of that number (C26). */
const LAP_MS = 90_000;

const ACTUAL: Record<VisualCompound, ActualCompound> = {
  soft: 'C3',
  medium: 'C2',
  hard: 'C1',
  superSoft: 'f2SuperSoft',
  inter: 'inter',
  wet: 'wet',
  unknown: 'unknown',
};
const VISUALS = Object.keys(ACTUAL) as VisualCompound[];

/** The fresh-set life per compound (`tyre-life`'s `freshLifeLaps`) unless a case says otherwise. */
const LIVES: Partial<Record<VisualCompound, number>> = { soft: 9, medium: 20, hard: 30, inter: 25, wet: 25 };

/** One tyre set of the car's allocation: new (wear 0) and available unless said otherwise. */
type SetSpec = { compound: VisualCompound; wearPct?: number; available?: boolean; fitted?: boolean };

const tyreSet = (s: SetSpec): TyreSet => ({
  actualCompound: ACTUAL[s.compound],
  visualCompound: s.compound,
  wearPct: s.wearPct ?? 0,
  available: s.available ?? true,
  fitted: s.fitted ?? false,
  recommendedSession: 0,
  lifeSpanLaps: 20,
  usableLifeLaps: 20,
  lapDeltaMs: 0,
});

/** `tyre-life`'s set of one car: its laps to the limit and the fresh-set life per compound (a compound not given: insufficientData). */
const tyreLife = (lapsToLimit: Known<number>, lives: Partial<Record<VisualCompound, number>>): TyreLife => {
  const corner = () => ({ wearPct: known(20, 0), ratePctPerLap: known(2, 0), lapsToLimit });
  return {
    corners: { fl: corner(), fr: corner(), rl: corner(), rr: corner() },
    lapsToLimit,
    basis: 'wear',
    limitPct: 70,
    ageLossLimitMs: 2_000,
    freshLifeLaps: Object.fromEntries(VISUALS.map((c) => [c, lives[c] === undefined ? unknown('insufficientData') : known(lives[c], 0)])) as TyreLife['freshLifeLaps'],
    gameLifeSpanLaps: unknown('notReceived'),
  };
};

/** One case: our car on lap `lap` of the race on the `fitted` compound since `fromLap`, with its allocation and its rule. */
type Case = {
  /** The lap the car is on (`timing.lap`). */
  lap: number;
  /** `tyre-life`'s `lapsToLimit` of the fitted set (default 8.6). */
  lapsToLimit?: Known<number> | number;
  /** The fitted compound (default medium). */
  fitted?: VisualCompound;
  /** The stint's first lap (default 1, a set fitted for the start); a later one follows a stop at the end of the lap before. */
  fromLap?: number;
  /** The sets besides the fitted one (default: a new medium, a new hard and a new soft). */
  sets?: SetSpec[];
  /** The `compound-rule` span of our car (default `required`). */
  rule?: 'required' | 'waived';
  /** The fresh-set life per compound (default `LIVES`). */
  lives?: Partial<Record<VisualCompound, number>>;
  phase?: WeekendPhase;
  /** Our car's open `car-activity-race` span kind (default `racingLap`), its start in race-clock ms (default: in the current lap). */
  activity?: { kind: string; start?: number };
  /** Closed spans in the projection. */
  closed?: Span[];
  /** Our tyre sets as the live state holds them, replacing the built ones (a `notReceived`). */
  tyreSets?: CarTyreSets;
  flag?: number;
};
type CarTyreSets = ReturnType<typeof carState>['tyres']['sets'];

const DEFAULT_SETS: SetSpec[] = [{ compound: 'medium' }, { compound: 'hard' }, { compound: 'soft' }];

/** Our laps 1 … `c.lap − 1`: on the old set (soft) before `fromLap`, the in lap the one before it, then the fitted set from its out lap. */
function ourLaps(c: Required<Pick<Case, 'lap' | 'fromLap' | 'fitted'>>): LapRecord[] {
  return Array.from({ length: c.lap - 1 }, (_, i) => {
    const n = i + 1;
    const compound: VisualCompound = n < c.fromLap ? 'soft' : c.fitted;
    return lap({
      carId: carId(US),
      lapNumber: n,
      lapTimeMs: LAP_MS,
      completedAt: n * LAP_MS,
      frame: n * LAP_MS,
      actualCompound: ACTUAL[compound],
      visualCompound: compound,
      tyreAgeAtStart: n < c.fromLap ? n - 1 : n - c.fromLap,
      inLap: n === c.fromLap - 1,
      outLap: c.fromLap > 1 && n === c.fromLap,
    });
  });
}

/** The view of `c`: our car and a rival, `tyre-life`'s output for both, the compound rule and our car's activity. */
function view(c: Case): EngineView {
  const fitted = c.fitted ?? 'medium';
  const fromLap = c.fromLap ?? 1;
  const ltl = c.lapsToLimit ?? 8.6;
  const lapsToLimit = typeof ltl === 'number' ? known(ltl, (c.lap - 1) * LAP_MS) : ltl;
  const sets = [tyreSet({ compound: fitted, fitted: true, wearPct: 25 }), ...(c.sets ?? DEFAULT_SETS).map(tyreSet)];
  const tyres = {
    actualCompound: ACTUAL[fitted],
    visualCompound: fitted,
    age: c.lap - fromLap,
    sets: c.tyreSets ?? known({ sets, fittedIdx: 0 }, 0),
  };
  const us = carState({ id: carId(US), timing: { lap: c.lap }, tyres });
  const rival = carState({ id: carId(RIVAL), timing: { lap: c.lap }, tyres: { ...tyres, sets: known({ sets, fittedIdx: 0 }, 0) } });
  const stopLap = fromLap - 1;
  const stints: StintRecord[] =
    stopLap < 1 ? [] : [{ carId: carId(US), firstLap: 1, lastLap: stopLap, actualCompound: 'C3', visualCompound: 'soft', tyreAgeAtFitting: 0, frame: stopLap * LAP_MS }];
  const pitStops: PitStopRecord[] =
    stopLap < 1
      ? []
      : [
          {
            carId: carId(US),
            lap: stopLap,
            pitLaneEntry: stopLap * LAP_MS - 25_000,
            pitLaneExit: stopLap * LAP_MS + 5_000,
            pitLaneTimeMs: 30_000,
            stationaryTimeMs: 2_500,
            flag: 'green',
            penaltyServed: false,
            frame: stopLap * LAP_MS + 5_000,
          },
        ];
  const closed: Record<string, Span[]> = {};
  for (const span of c.closed ?? []) (closed[span.machine] ??= []).push(span);
  const activity = c.activity ?? { kind: 'racingLap' };
  const activityStart = activity.start ?? (c.lap - 1) * LAP_MS;
  const spans: OpenSpan[] = [
    { ...openSpan('compound-rule', c.rule ?? 'required', { car: US }) },
    { ...openSpan('car-activity-race', activity.kind, { car: US, start: activityStart }), startFrame: activityStart },
    openSpan('compound-rule', 'required', { car: RIVAL }),
    openSpan('car-activity-race', 'racingLap', { car: RIVAL }),
  ];
  const lives = c.lives ?? LIVES;
  const tyreLifeOut: TyreLifeOutput = { [carId(US)]: tyreLife(lapsToLimit, lives), [carId(RIVAL)]: tyreLife(lapsToLimit, lives) };
  return situatedView({
    phase: c.phase ?? RACE,
    cars: [us, rival],
    session: { totalLaps: c.flag ?? FLAG },
    history: { laps: ourLaps({ lap: c.lap, fromLap, fitted }), stints, pitStops, spans: closed },
    spans,
    outputs: new Map<string, unknown>([[TYRE_LIFE, tyreLifeOut]]),
    sessionTime: (c.lap - 1) * LAP_MS + 30_000,
  });
}

const outOf = (c: Case): PitWindowOutput => calc.compute(view(c));

/** Our car's `pitWindow.car` value; throws when it is unknown. */
function ours(c: Case): PitWindow {
  const out = outOf(c)[carId(US)];
  if (out === undefined) throw new Error('no pit window for our car');
  if (!out.known) throw new Error(`our pit window is unknown: ${out.reason}`);
  return out.value;
}

/** The row of `compound`; throws when there is none. */
function row(w: PitWindow, compound: VisualCompound): PitWindowSet {
  const r = w.sets.find((s) => s.compound === compound);
  if (r === undefined) throw new Error(`no ${compound} row`);
  return r;
}

const compounds = (w: PitWindow): VisualCompound[] => w.sets.map((s) => s.compound);
const v = <T>(value: T) => ({ known: true, value });
const INSUFFICIENT = unknown('insufficientData');
const NOT_APPLICABLE = unknown('notApplicable');

describe('pit-window calculator', () => {
  it('is the quick calculator `pit-window` at 4 Hz over tyre-life, tyres, the session, timing and the three sub-machines', () => {
    expect(pitWindowCalculator.id).toBe(PIT_WINDOW);
    expect(pitWindowCalculator.kind).toBe('quick');
    expect(pitWindowCalculator.cadence).toEqual({ hz: 4 });
    expect(pitWindowCalculator.reads).toEqual(
      expect.arrayContaining([{ calculator: TYRE_LIFE }, 'tyres', 'session', 'timing', 'spans:weekend-phase', 'spans:compound-rule', 'spans:car-activity-race']),
    );
    expect(PIT_WINDOW_CONFIG.defaults).toEqual({ windowLeadLaps: 2 });
  });

  // 1
  it('flag 52, M fitted since L1, lapsToLimit 8.6 at L23: latest 31; new H (life 30) earliest 22, lifeEnd 61, reaches; new S (life 9) lifeEnd 40, not reaches; window open on hard', () => {
    const w = ours({ lap: 23 });
    expect(w.carId).toBe(carId(US));
    expect(w.flag).toBe(52);
    expect(w.currentLap).toBe(23);
    expect(w.stint.compound).toBe('medium');
    expect(w.stint.fromLap).toBe(1);
    expect(w.stint.latest).toMatchObject(v(31));
    const hard = row(w, 'hard');
    expect(hard.sameType).toBe(true);
    expect(hard.lifeLaps).toMatchObject(v(30));
    expect(hard.earliest).toMatchObject(v(22));
    expect(hard.lifeEnd).toMatchObject(v(61));
    expect(hard.reaches).toMatchObject(v(true));
    const soft = row(w, 'soft');
    expect(soft.lifeLaps).toMatchObject(v(9));
    expect(soft.lifeEnd).toMatchObject(v(40));
    expect(soft.reaches).toMatchObject(v(false));
    expect(w.window).toMatchObject(v('open'));
    expect(w.windowCompound).toMatchObject(v('hard'));
  });

  // 2
  it('the same at L19: before; at L20 (= 22 − windowLeadLaps): lead; at L22: open', () => {
    expect(ours({ lap: 19 }).window).toMatchObject(v('before'));
    expect(ours({ lap: 20 }).window).toMatchObject(v('lead'));
    expect(ours({ lap: 22 }).window).toMatchObject(v('open'));
    expect(ours({ lap: 20 }).windowCompound).toMatchObject(v('hard'));
  });

  // 3
  it('lapsToLimit 40 at L23: latest 51 (flag − 1); waived: no sets, window none; lapsToLimit 28.6 (last lap 51) waived: latest 51, sets not empty', () => {
    expect(ours({ lap: 23, lapsToLimit: 40 }).stint.latest).toMatchObject(v(51));
    const runsToFlag = ours({ lap: 23, lapsToLimit: 40, rule: 'waived' });
    expect(runsToFlag.sets).toEqual([]);
    expect(runsToFlag.window).toMatchObject(v('none'));
    expect(runsToFlag.windowCompound).toEqual(NOT_APPLICABLE);
    // the set's last lap is 51: it does not run lap 52, so a stop is needed although latest is capped at 51 as well
    const shortOfFlag = ours({ lap: 23, lapsToLimit: 28.6, rule: 'waived' });
    expect(shortOfFlag.stint.latest).toMatchObject(v(51));
    expect(shortOfFlag.sets).not.toEqual([]);
    expect(compounds(shortOfFlag)).toContain('hard');
  });

  // 4
  it('rule required: an unused M set gives no M row; a used H set (wear 12 %) and no new H give no H row', () => {
    const w = ours({ lap: 23, sets: [{ compound: 'medium' }, { compound: 'hard', wearPct: 12 }, { compound: 'soft' }] });
    expect(compounds(w)).not.toContain('medium');
    expect(compounds(w)).not.toContain('hard');
    expect(compounds(w)).toContain('soft');
    // an unavailable new set does not count either
    expect(compounds(ours({ lap: 23, sets: [{ compound: 'hard', available: false }] }))).toEqual([]);
  });

  // 5
  it('inter fitted: an unused wet set is sameType, the dry sets are not; window follows only the wet row', () => {
    const c: Case = { lap: 23, fitted: 'inter', rule: 'waived', sets: [{ compound: 'wet' }, { compound: 'hard' }, { compound: 'medium' }, { compound: 'soft' }] };
    const w = ours(c);
    expect(row(w, 'wet').sameType).toBe(true);
    for (const dry of ['hard', 'medium', 'soft'] as const) expect(row(w, dry).sameType).toBe(false);
    // the hard (earliest 22) would be open at L23; the wet (life 25: earliest 27) leads from L25
    expect(row(w, 'hard').reaches).toMatchObject(v(true));
    expect(row(w, 'wet').earliest).toMatchObject(v(27));
    expect(w.window).toMatchObject(v('before'));
    expect(w.windowCompound).toMatchObject(v('wet'));
    expect(ours({ ...c, lap: 25 }).window).toMatchObject(v('lead'));
    // without a reaching wet set there is no window, whatever the dry sets do
    expect(ours({ ...c, lives: { ...LIVES, wet: 10 } }).window).toMatchObject(v('none'));
  });

  // 6
  it('a boxStop span opened at L25 after the stint start: closed; one before the stint start does not close; L32 with lapsToLimit 0: latest 32, closed', () => {
    expect(ours({ lap: 25, activity: { kind: 'boxStop', start: 24 * LAP_MS + 60_000 } }).window).toMatchObject(v('closed'));
    // the stop that began this stint (box stop on lap 9, stint from lap 10) is no stop since the stint start
    const before: Span = {
      ...openSpan('car-activity-race', 'boxStop', { car: US, start: 9 * LAP_MS - 20_000 }),
      startFrame: 9 * LAP_MS - 20_000,
      end: 9 * LAP_MS - 17_000,
      endFrame: 9 * LAP_MS - 17_000,
    };
    expect(ours({ lap: 23, fromLap: 10, closed: [before] }).window).toMatchObject(v('open'));
    // tyre-life never goes below 0: lapsToLimit 0 means the fitted set is at its limit, so this lap is its last
    const atLimit = ours({ lap: 32, lapsToLimit: 0 });
    expect(atLimit.stint.latest).toMatchObject(v(32));
    expect(atLimit.window).toMatchObject(v('closed'));
    expect(atLimit.windowCompound).toMatchObject(v('hard'));
  });

  // 6b
  it('lapsToLimit 0.4 at L31 (floor 0): latest 31, closed; windowCompound still hard', () => {
    const w = ours({ lap: 31, lapsToLimit: 0.4 });
    expect(w.stint.latest).toMatchObject(v(31));
    expect(w.window).toMatchObject(v('closed'));
    expect(w.windowCompound).toMatchObject(v('hard'));
  });

  // 7
  it('lapsToLimit insufficientData: latest, lifeEnd, reaches, window and windowCompound insufficientData, earliest known; tyre sets notReceived: notReceived', () => {
    const w = ours({ lap: 23, lapsToLimit: INSUFFICIENT });
    expect(w.stint.latest).toEqual(INSUFFICIENT);
    expect(w.sets).not.toEqual([]);
    const hard = row(w, 'hard');
    expect(hard.earliest).toMatchObject(v(22));
    expect(hard.lifeEnd).toEqual(INSUFFICIENT);
    expect(hard.reaches).toEqual(INSUFFICIENT);
    expect(w.window).toEqual(INSUFFICIENT);
    expect(w.windowCompound).toEqual(INSUFFICIENT);
    expect(outOf({ lap: 23, tyreSets: unknown('notReceived') })[carId(US)]).toEqual(unknown('notReceived'));
  });

  // 8
  it('on the last lap (L52, latest 51): closed', () => {
    const w = ours({ lap: 52, lapsToLimit: 5 });
    expect(w.stint.latest).toMatchObject(v(51));
    expect(w.window).toMatchObject(v('closed'));
  });

  // 10: each set's window and state, stopNeeded and pastLimit (the final review, findings 1, 2, 5)
  describe("10: each set's windowLaps and state, the stint's stopNeeded and pastLimit", () => {
    it('row 1 at L23: H windowLaps { from: 22, to: 31 }, state open; S (does not reach) windowLaps notApplicable, state none', () => {
      const w = ours({ lap: 23 });
      expect(row(w, 'hard').windowLaps).toMatchObject(v({ from: 22, to: 31 }));
      expect(row(w, 'hard').state).toMatchObject(v('open'));
      expect(row(w, 'soft').windowLaps).toEqual(NOT_APPLICABLE);
      expect(row(w, 'soft').state).toMatchObject(v('none'));
      expect(w.stint.stopNeeded).toMatchObject(v(true));
      expect(w.stint.pastLimit).toBe(false);
    });

    it('a second same-type compound with earliest 26 (S life 26): before at L23, lead at L24, open at L26; H open meanwhile', () => {
      const c: Case = { lap: 23, lives: { ...LIVES, soft: 26 } };
      expect(row(ours(c), 'soft').earliest).toMatchObject(v(26));
      expect(row(ours(c), 'soft').state).toMatchObject(v('before'));
      expect(row(ours(c), 'hard').state).toMatchObject(v('open'));
      expect(row(ours({ ...c, lap: 24 }), 'soft').state).toMatchObject(v('lead'));
      expect(row(ours({ ...c, lap: 26 }), 'soft').state).toMatchObject(v('open'));
      expect(row(ours({ ...c, lap: 26 }), 'soft').windowLaps).toMatchObject(v({ from: 26, to: 34 }));
    });

    it('at the limit (L32 lapsToLimit 0, L31 lapsToLimit 0.4): every set with a window closed, pastLimit true', () => {
      for (const c of [{ lap: 32, lapsToLimit: 0 }, { lap: 31, lapsToLimit: 0.4 }]) {
        const w = ours(c);
        const withWindow = w.sets.filter((s) => s.windowLaps.known);
        expect(withWindow.map((s) => s.compound)).toContain('hard');
        for (const s of withWindow) expect(s.state).toMatchObject(v('closed'));
        expect(row(w, 'soft').state).toMatchObject(v('none'));
        expect(w.stint.pastLimit).toBe(true);
      }
    });

    it('on the last lap (L52, latest 51): pastLimit true (the current lap beyond latest)', () => {
      expect(ours({ lap: 52, lapsToLimit: 5 }).stint.pastLimit).toBe(true);
    });

    it('a boxStop span opened since the stint start (L25): every set with a window closed, pastLimit false', () => {
      const w = ours({ lap: 25, lives: { ...LIVES, soft: 26 }, activity: { kind: 'boxStop', start: 24 * LAP_MS + 60_000 } });
      const withWindow = w.sets.filter((s) => s.windowLaps.known);
      expect(withWindow.map((s) => s.compound).sort()).toEqual(['hard', 'soft']);
      for (const s of withWindow) expect(s.state).toMatchObject(v('closed'));
      expect(w.stint.pastLimit).toBe(false);
    });

    it('no stop needed (rule waived, the last lap at or past the flag): stopNeeded false; waived with last lap 51: stopNeeded true', () => {
      expect(ours({ lap: 23, lapsToLimit: 40, rule: 'waived' }).stint.stopNeeded).toMatchObject(v(false));
      expect(ours({ lap: 23, lapsToLimit: 28.6, rule: 'waived' }).stint.stopNeeded).toMatchObject(v(true));
      // the rule still to meet: a stop is needed although the set runs to the flag
      expect(ours({ lap: 23, lapsToLimit: 40 }).stint.stopNeeded).toMatchObject(v(true));
    });

    it('lapsToLimit insufficientData: every windowLaps, state and stopNeeded insufficientData', () => {
      const w = ours({ lap: 23, lapsToLimit: INSUFFICIENT });
      expect(w.sets).not.toEqual([]);
      for (const s of w.sets) {
        expect(s.windowLaps).toEqual(INSUFFICIENT);
        expect(s.state).toEqual(INSUFFICIENT);
      }
      expect(w.stint.stopNeeded).toEqual(INSUFFICIENT);
      expect(w.stint.pastLimit).toBe(false);
    });
  });

  // 9
  describe('9: our cars, the race only, the behaviour table, the property', () => {
    it('a rival is absent from the output', () => {
      const out = outOf({ lap: 23 });
      expect(Object.hasOwn(out, carId(RIVAL))).toBe(false);
      expect(Object.keys(out)).toEqual([String(US)]);
    });

    it('a qualifying session gives notApplicable for our car (practice and no phase too); a pending phase reads as the race', () => {
      for (const phase of [QUALIFYING, PRACTICE, NONE]) expect(outOf({ lap: 3, phase })[carId(US)]).toEqual(NOT_APPLICABLE);
      expect(ours({ lap: 23, phase: { kind: 'pending' } }).window).toMatchObject(v('open'));
    });

    it('runs through the guarded view: every case above reads only what it declares', () => {
      // `calc` is the guarded calculator; one more run with every input present must not throw
      expect(() => calc.compute(view({ lap: 23, fromLap: 10 }))).not.toThrow();
    });

    it('the behaviour table: weekend-phase race → race, others notApplicable; compound-rule required → ruleRequired; boxStop → stopped', () => {
      expect(PIT_WINDOW_BEHAVIOUR['weekend-phase']).toEqual({
        race: { race: true },
        practice: { notApplicable: true },
        qualifying: { notApplicable: true },
        none: { notApplicable: true },
      });
      expect(PIT_WINDOW_BEHAVIOUR['compound-rule']).toEqual({ required: { ruleRequired: true }, waived: {} });
      const activity = PIT_WINDOW_BEHAVIOUR['car-activity-race']!;
      for (const [kind, effect] of Object.entries(activity)) expect(effect).toEqual(kind === 'boxStop' ? { stopped: true } : {});
    });

    it('the behaviour table is complete over the machines it reads', () => {
      const read = pitWindowCalculator.reads.flatMap((r) => (typeof r === 'string' && r.startsWith('spans:') ? [r.slice('spans:'.length)] : []));
      expect(Object.keys(PIT_WINDOW_BEHAVIOUR).sort()).toEqual([...read].sort());
      for (const machine of read) {
        const kinds = SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];
        expect(Object.keys(PIT_WINDOW_BEHAVIOUR[machine] ?? {}).sort()).toEqual([...kinds].sort());
      }
    });

    it('property: every reaching set with a window has fromLap ≤ earliest ≤ latest ≤ flag − 1; no window without reaching; lapsToLimit < 1 ⇒ closed; the rule and used sets hold', () => {
      const DRY = ['soft', 'medium', 'hard'] as const;
      const arb = fc
        .record({
          flag: fc.integer({ min: 5, max: 78 }),
          fromFrac: fc.double({ min: 0, max: 1, noNaN: true }),
          nowFrac: fc.double({ min: 0, max: 1, noNaN: true }),
          lapsToLimit: fc.double({ min: 0, max: 80, noNaN: true }),
          fitted: fc.constantFrom(...DRY),
          rule: fc.constantFrom('required' as const, 'waived' as const),
          lives: fc.record({ soft: fc.integer({ min: 1, max: 80 }), medium: fc.integer({ min: 1, max: 80 }), hard: fc.integer({ min: 1, max: 80 }) }),
          sets: fc.array(fc.record({ compound: fc.constantFrom(...DRY), wearPct: fc.constantFrom(0, 0, 12), available: fc.boolean() }), { maxLength: 6 }),
        })
        .map((r) => {
          // fromLap ≤ lap ≤ flag − 1
          const lap = 1 + Math.floor(r.nowFrac * (r.flag - 2));
          const fromLap = 1 + Math.floor(r.fromFrac * (lap - 1));
          return { ...r, lap, fromLap };
        });
      fc.assert(
        fc.property(arb, (r) => {
          const w = ours({ lap: r.lap, fromLap: r.fromLap, flag: r.flag, lapsToLimit: r.lapsToLimit, fitted: r.fitted, rule: r.rule, lives: r.lives, sets: r.sets });
          const newSets = new Set<VisualCompound>(r.sets.filter((s) => s.available && s.wearPct === 0).map((s) => s.compound));
          for (const s of w.sets) {
            expect(newSets.has(s.compound)).toBe(true);
            if (r.rule === 'required') expect(s.compound).not.toBe(r.fitted);
            if (s.lifeEnd.known) expect(s.reaches).toMatchObject(v(s.lifeEnd.value >= r.flag));
            if (!(s.reaches.known && s.reaches.value)) continue;
            if (!(s.earliest.known && w.stint.latest.known)) throw new Error('a reaching set with an unknown lap');
            expect(r.fromLap).toBeLessThanOrEqual(s.earliest.value);
            expect(s.earliest.value).toBeLessThanOrEqual(w.stint.latest.value);
            expect(w.stint.latest.value).toBeLessThanOrEqual(r.flag - 1);
          }
          const reaching = w.sets.filter((s) => s.sameType && s.reaches.known && s.reaches.value);
          if (reaching.length === 0) expect(w.window).toMatchObject(v('none'));
          else expect(w.windowCompound).toMatchObject(v(reaching[0]!.compound));
          // no box stop here and lap ≤ flag − 1: the window is closed exactly when the fitted set is at its limit
          if (reaching.length > 0) expect(w.window.known && w.window.value === 'closed').toBe(r.lapsToLimit < 1);
          // each set: state none exactly when it has no window; the car's window is its window compound's set's state
          for (const s of w.sets) {
            if (!s.state.known) throw new Error('a set state unknown with a known lapsToLimit');
            expect(s.state.value === 'none').toBe(!s.windowLaps.known && s.windowLaps.reason === 'notApplicable');
            if (s.windowLaps.known) {
              expect(s.earliest).toMatchObject(v(s.windowLaps.value.from));
              expect(w.stint.latest).toMatchObject(v(s.windowLaps.value.to));
            }
          }
          if (w.windowCompound.known) {
            const compound = w.windowCompound.value;
            expect(w.window).toEqual(w.sets.find((s) => s.compound === compound)?.state);
          }
          expect(w.stint.pastLimit).toBe(r.lapsToLimit < 1);
        }),
        { numRuns: 200 },
      );
    });
  });
});
