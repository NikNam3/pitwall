// `battle` (spec 6.3): our cars against the car ahead and behind, from `gaps` and `pace` outputs.
import { carId, known, unknown, type CarId, type CarState, type Interval, type Known, type Ms } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { BATTLE, BATTLE_CONFIG } from '../../src/battle/index.ts';
import { battleCalculator } from '../../src/battle/calculator.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';
import type { Pace } from '../../src/pace/index.ts';
import { carState, engineView, realismHidden } from '../../../../test-support/builders/index.ts';

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
  /** The latest crossings; the gap now does not depend on them. */
  latest?: Record<number, { lap: number; segment: number; at: number }>;
  pace?: Record<number, Known<Ms>>;
  kind?: 'race' | 'practice';
  teammate?: number;
  hidden?: number[];
  config?: EngineView['config'];
};

const build = (s: Scene): EngineView => {
  const cars = s.cars.map(([n, position, timing]) => {
    const car = carState({ id: id(n), timing: { position } });
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
  });
  const gaps: GapsOutput = {
    intervals: (s.order ?? [1, 0, 3]).map(interval),
    lineTimes: Object.fromEntries(Object.entries(s.lineTimes).map(([k, v]) => [k, v])) as GapsOutput['lineTimes'],
    latest: (s.latest ?? {}) as GapsOutput['latest'],
    neighbourhood: [],
  };
  const pace: Pace = {
    byCar: Object.fromEntries(Object.entries(s.pace ?? {}).map(([k, v]) => [k, paceOf(v)])) as Pace['byCar'],
  };
  const view = engineView({
    cars,
    session: { kind: s.kind ?? 'race' },
    outputs: new Map<string, unknown>([['gaps', gaps], ['pace', pace]]),
    ...(s.config && { config: s.config }),
  });
  return s.teammate === undefined ? view : { ...view, state: { ...view.state, teammateCar: id(s.teammate) } };
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

  it('the gap now comes from intervals even when the latest crossings are at different segments', () => {
    const view = build(
      base({
        latest: {
          1: { lap: 4, segment: 7, at: 309_000 },
          0: { lap: 4, segment: 10, at: 311_600 },
          3: { lap: 4, segment: 2, at: 305_000 },
        },
      }),
    );
    const c = card(view);
    if (!c.ahead.known || !c.behind.known) throw new Error('ahead or behind unknown');
    expect(c.ahead.value.gapMs).toEqual({ known: true, value: 1600, at: 311_600 });
    expect(c.behind.value.gapMs).toEqual({ known: true, value: 2200, at: 313_800 });
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
    const view = build(base());
    view.state.cars[0]!.tyres.visualCompound = 'medium';
    view.state.cars[0]!.tyres.age = 7;
    view.state.cars[1]!.tyres.visualCompound = 'hard';
    view.state.cars[1]!.tyres.age = 12;
    const ahead = card(view).ahead;
    if (!ahead.known) throw new Error('ahead unknown');
    expect(ahead.value.ours).toEqual({ compound: 'medium', age: 7 });
    expect(ahead.value.theirs).toEqual({ compound: 'hard', age: 12 });
  });

  it('their ERS store is the car state value with its time', () => {
    const view = build(base());
    view.state.cars[1]!.energy.ers = known(
      { storeJ: 2_500_000, mode: 'medium', harvestedMgukJ: 0, harvestedMguhJ: 0, deployedJ: 0 },
      42_000,
    );
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
        cars: [[2, 1], [1, 2, { resultStatus: 'retired' }], [0, 3], [3, 4, { resultStatus: 'disqualified' }], [4, 5]],
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
    const view = build(base({ cars: [[0, 2], [1, 1, { resultStatus: 'retired' }], [3, 3]], order: [0, 3] }));
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
    const out = battleCalculator.compute(build(base({ kind: 'practice', teammate: 1 })));
    expect(Object.keys(out).sort()).toEqual(['0', '1']);
    for (const c of Object.values(out)) {
      expect(c.ahead).toMatchObject({ known: false, reason: 'notApplicable' });
      expect(c.behind).toMatchObject({ known: false, reason: 'notApplicable' });
    }
  });
});
