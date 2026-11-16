// `weekend-pace` (SP4.3d2 Task 6b, plan call 9; contract C3, C25, C41, C43, C44, C47, C62, C62a): each car's race pace
// before its first race lap, from the weekend's earlier sessions (`view.weekend`, the car matched by team and race
// number, C62). A car's practice long run (a stint of at least `minLongRunLaps` green `forPace` laps) gives its median
// pace, fuel-corrected by `lapModelParams`' `fuelMsPerKg` and tyre-age-corrected to age 0 by the priors' degradation
// slope (`view.priors`, C62a), else the stint's own fitted slope; else its best valid qualifying lap plus
// `raceTrimOffsetMs` with `qualifyingPaceSdMs`; else `unknown('insufficientData')` (C3).
//
// Rows (plan Task 6b Step 1): 1 long run, 2 short run, 3 no practice, 4 same car, 5 planning view, 5b priors, 6 contract.
//
// The fuel basis is degradation's (`lapTimeMs − γ · fuelKg`, its `basePaceMs`): the grid start (Task 7) puts its own
// race-start fuel on top through the lap model (`fuelKg × fuelMsPerKg`), so the pace here holds no fuel. Every stint runs
// on mediums, the lap model's reference compound (offset 0), so no compound offset enters the expected values. Config
// values are read from the config declaration, never as literals.
import { carId, SPAN_DECLARATIONS, unknown, type CarId, type CarKey, type FrameNumber, type Known, type LapRecord, type Span, type WeekendPace, type WeekendPhase } from '@pitwall/domain';
import { asOfNow, type AsOfView, type EngineView, type Projection, type QuickCalculator, type StoredSession, type WeekendContext } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { carState, history, lap } from '../../../../test-support/builders/index.ts';
import { degradationCalculator, DEGRADATION, WEEKEND_PACE, WEEKEND_PACE_BEHAVIOUR, WEEKEND_PACE_CONFIG, weekendPaceAsOf, weekendPaceCalculator } from '../../src/index.ts';
import { GAMMA,priorsSnapshot, stintLaps, stintRecord, viewPriors } from '../degradation/support.ts';
import { guardedQuick, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';
import { CALCULATORS } from '../units.ts';

/** The calculator through its guarded view (C41): a read it does not declare throws. Built per call, so each row fails on its own until it exists. */
const calc = { compute: (view: EngineView): WeekendPace => guardedQuick(weekendPaceCalculator as QuickCalculator<WeekendPace>).compute(view) };
const asOf = weekendPaceAsOf as (view: AsOfView) => WeekendPace;
const { minLongRunLaps, raceTrimOffsetMs, qualifyingPaceSdMs } = WEEKEND_PACE_CONFIG.defaults;

/** The degradation slope of every long run here (ms per lap of tyre age): also the degradation config's default ν, so any fit of it finds it. */
const NU = 150;
/** The flying laps of a long run: at least 9 (the row's 10-lap stint: an out lap and 9 flying laps), odd so its median is one lap's, never fewer than `minLongRunLaps`. */
const FLYING = Math.max(9, minLongRunLaps | 1);
/** The laps of a short run: one fewer than a long run needs. */
const SHORT = Math.max(1, minLongRunLaps - 1);

/** A noise symmetric about the stint's middle lap (+100, −100, +100 … from each end): uncorrelated with the tyre age, so a fitted slope is the true one. */
const symmetric = (n: number) => (j: number): number => (Math.min(j, n - 1 - j) % 2 === 0 ? 100 : -100);

/** The median of `xs` (odd lengths here: one value). */
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The team and race number of a seat (C62). */
const key = (teamId: number, raceNumber: number): CarKey => ({ teamId, raceNumber });
/** The default seat of slot `i`. */
const KEY = (i: number): CarKey => key(i, 10 + i);

/**
 * A practice long run of car `car` on mediums: an out lap (lap `from`, 20 s slow, no `forPace` lap) then `FLYING` laps
 * whose time is `BASE_MS + NU · age + γ · fuel + noise` (`stintLaps`), tyre age 0 at the out lap; and its stint record.
 */
function longRun(car: number, from = 1): { laps: LapRecord[]; stint: ReturnType<typeof stintRecord> } {
  const to = from + FLYING;
  const noise = symmetric(FLYING);
  const laps = stintLaps({ car, from, to, nu: NU, visual: 'medium', actual: 'C2', noise: (i) => (i === 0 ? 0 : noise(i - 1)), over: { [from]: { outLap: true, lapTimeMs: 110_000 } } });
  return { laps, stint: stintRecord({ carId: carId(car), firstLap: from, lastLap: to, actualCompound: 'C2', visualCompound: 'medium' }) };
}

/** A practice short run of car `car` on mediums: `SHORT` flying laps, too few for a long run; and its stint record. */
function shortRun(car: number, from = 1): { laps: LapRecord[]; stint: ReturnType<typeof stintRecord> } {
  const to = from + SHORT - 1;
  const laps = stintLaps({ car, from, to, nu: NU, visual: 'medium', actual: 'C2' });
  return { laps, stint: stintRecord({ carId: carId(car), firstLap: from, lastLap: to, actualCompound: 'C2', visualCompound: 'medium' }) };
}

/** The flying laps of a long run corrected by `slope` to tyre age 0 and by γ to no fuel: the values its median is taken over. */
const corrected = (laps: readonly LapRecord[], slope: number): number[] =>
  laps.filter((l) => !l.outLap && !l.inLap).map((l) => {
    if (!l.fuelAtStartKg.known) throw new Error('a long-run lap without fuel');
    return l.lapTimeMs - GAMMA * l.fuelAtStartKg.value - slope * l.tyreAgeAtStart;
  });

/** A qualifying lap of car `car`: `lapTimeMs`, valid unless said otherwise, with a qualifying fuel load. */
const qualiLap = (car: number, lapNumber: number, lapTimeMs: number, valid = true): LapRecord =>
  lap({ carId: carId(car), lapNumber, lapTimeMs, completedAt: lapNumber * 100_000, actualCompound: 'C4', visualCompound: 'soft', fuelAtStartKg: { known: true, value: 10, at: lapNumber * 100_000 }, valid: { lap: valid, sectors: [valid, valid, valid] } });

/**
 * A stored earlier session of the weekend (C62): `phase` as its closed `weekend-phase` span, a closed `competing`
 * car-status span per seat, `seats` (slot → team and race number) and its laps and stints.
 */
function stored(uid: string, phase: WeekendPhase, seats: Record<number, CarKey>, lists: Partial<Projection> = {}): StoredSession {
  // a stored session's phase is decided (its span), never pending
  if (phase.kind === 'pending') throw new Error('a stored session is never pending');
  const { kind, ...detail } = phase;
  const closed = (machine: string, k: string, d: unknown, car?: number): Span => ({
    machine,
    id: 0 as Span['id'],
    kind: k,
    start: 0,
    end: 3_600_000,
    confirmed: true,
    detail: d,
    startFrame: 1 as FrameNumber,
    endFrame: 50_000 as FrameNumber,
    ...(car !== undefined && { carId: carId(car) }),
  });
  const slots = Object.keys(seats).map(Number);
  const spans = { 'weekend-phase': [closed('weekend-phase', kind, detail)], 'car-status': slots.map((s) => closed('car-status', 'competing', undefined, s)) };
  return {
    sessionUid: uid,
    playerCar: carId(0),
    cars: slots.map((s) => ({ carId: carId(s), carKey: seats[s]! })),
    projection: history({ ...lists, spans: { ...lists.spans, ...spans } }),
  };
}

/** The weekend context of a session whose player car has seat `KEY(0)`, with `sessions` before it. */
const weekendOf = (sessions: StoredSession[]): WeekendContext => ({ weekendId: 'w1', player: KEY(0), sessions });

/**
 * The view of the current session (default: the race before its first lap): `seats` as the live state's identities
 * (Participants received), its own `lists`, the weekend context, the priors, `degradation`'s output on it (the
 * calculator reads it for `lapModelParams`).
 */
function viewOf(o: { seats: Record<number, CarKey>; weekend?: WeekendContext; phase?: WeekendPhase; lists?: Partial<Projection>; priors?: EngineView['priors']; status?: Record<number, string> }): EngineView {
  const cars = Object.entries(o.seats).map(([slot, k]) => carState({ id: carId(Number(slot)), identity: { teamId: k.teamId, raceNumber: k.raceNumber }, updatedAt: { participants: 0 } }));
  const base = situatedView({ cars, phase: o.phase ?? RACE, history: o.lists ?? {}, ...(o.priors !== undefined && { priors: o.priors }), ...(o.status !== undefined && { status: o.status }) });
  const view: EngineView = { ...base, weekend: o.weekend };
  return { ...view, outputs: new Map([[DEGRADATION, degradationCalculator.compute(view)]]) };
}

/** The seats `0..n-1`, each its default key. */
const seats = (n: number): Record<number, CarKey> => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, KEY(i)]));

type Pace = WeekendPace[CarId] extends Known<infer T> ? T : never;
const valueOf = (out: WeekendPace, car: number): Pace => {
  const k = out[carId(car)];
  if (k === undefined) throw new Error(`car ${car}: no entry`);
  if (!k.known) throw new Error(`car ${car}: unknown(${k.reason})`);
  return k.value;
};

/** A practice session of the default seats `0..5` with `runs` (laps and stints). */
const practice = (uid: string, runs: { laps: LapRecord[]; stint: ReturnType<typeof stintRecord> }[], seatsOf = seats(6)): StoredSession =>
  stored(uid, PRACTICE, seatsOf, { laps: runs.flatMap((r) => r.laps), stints: runs.map((r) => r.stint) });

/** A qualifying session of `seatsOf` with `laps`. */
const qualifying = (uid: string, laps: LapRecord[], seatsOf = seats(6), phase: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 3 }): StoredSession =>
  stored(uid, phase, seatsOf, { laps });

describe('weekend-pace: each car`s race pace from the weekend (Task 6b)', () => {
  it('1. long run: a 10-lap practice stint gives source longRun, its pace the corrected median within 50 ms', () => {
    const run = longRun(3);
    const out = calc.compute(viewOf({ seats: seats(6), weekend: weekendOf([practice('fp2', [run])]) }));
    const pace = valueOf(out, 3);
    expect(pace.source).toBe('longRun');
    // without priors the stint's own slope (NU, the true one) corrects the tyre age
    const expected = median(corrected(run.laps, NU));
    expect(Math.abs(pace.paceMs - expected), `pace ${pace.paceMs} against ${expected}`).toBeLessThanOrEqual(50);
    // the out lap is no forPace lap: the pace rests on the flying laps only
    expect(pace.laps).toBe(FLYING);
    expect(pace.sdMs).toBeGreaterThan(0);
    // a car without any lap of the weekend has no pace (C3: never 0)
    expect(out[carId(4)]).toEqual(unknown('insufficientData'));
  });

  it('2. short run: a practice stint below minLongRunLaps and a qualifying best give source qualifying, best + raceTrimOffsetMs', () => {
    const best = 88_123;
    const quali = qualifying('q3', [qualiLap(3, 1, 89_000), qualiLap(3, 2, best), qualiLap(3, 3, 87_000, false), qualiLap(3, 4, 88_900)]);
    const out = calc.compute(viewOf({ seats: seats(6), weekend: weekendOf([practice('fp3', [shortRun(3)]), quali]) }));
    const pace = valueOf(out, 3);
    expect(pace.source).toBe('qualifying');
    // the invalid 87.000 is no best (C25: the valid lap record's time)
    expect(pace.paceMs).toBe(best + raceTrimOffsetMs);
    expect(pace.sdMs).toBe(qualifyingPaceSdMs);
  });

  it('3. no practice: a one-shot-qualifying weekend gives every car with a valid lap qualifying, a car without one insufficientData', () => {
    const oneShot: WeekendPhase = { kind: 'qualifying', format: 'oneShot', segment: undefined };
    const laps = [qualiLap(0, 1, 88_000), qualiLap(1, 1, 88_400), qualiLap(2, 1, 88_800), qualiLap(3, 1, 87_500, false)];
    const out = calc.compute(viewOf({ seats: seats(5), weekend: weekendOf([qualifying('q', laps, seats(5), oneShot)]) }));
    for (const [car, ms] of [[0, 88_000], [1, 88_400], [2, 88_800]] as const) {
      const pace = valueOf(out, car);
      expect(pace.source, `car ${car}`).toBe('qualifying');
      expect(pace.paceMs, `car ${car}`).toBe(ms + raceTrimOffsetMs);
      expect(pace.sdMs, `car ${car}`).toBe(qualifyingPaceSdMs);
    }
    // car 3's only lap is invalid, car 4 has none
    expect(out[carId(3)]).toEqual(unknown('insufficientData'));
    expect(out[carId(4)]).toEqual(unknown('insufficientData'));
  });

  it('4. same car: a car whose slot moved between practice and qualifying keeps its long run (team and race number, C62)', () => {
    const moved = key(7, 44);
    const other = key(9, 99);
    // practice: the moved car in slot 3, its long run there
    const run = longRun(3);
    const fp = practice('fp2', [run], { 0: KEY(0), 3: moved });
    // qualifying: the moved car in slot 5 (a fast lap), the other car in slot 3
    const quali = qualifying('q3', [qualiLap(5, 1, 85_000), qualiLap(3, 1, 89_000)], { 0: KEY(0), 3: other, 5: moved });
    // the race: the moved car in slot 7, the other car in slot 3
    const out = calc.compute(viewOf({ seats: { 0: KEY(0), 3: other, 7: moved }, weekend: weekendOf([fp, quali]) }));
    const pace = valueOf(out, 7);
    expect(pace.source).toBe('longRun');
    const expected = median(corrected(run.laps, NU));
    expect(Math.abs(pace.paceMs - expected), `pace ${pace.paceMs} against ${expected}`).toBeLessThanOrEqual(50);
    // slot 3 of the race is another car: its own qualifying lap, not the long run practice's slot 3 ran
    const third = valueOf(out, 3);
    expect(third.source).toBe('qualifying');
    expect(third.paceMs).toBe(89_000 + raceTrimOffsetMs);
  });

  it('5. planning view: on the qualifying session`s own as-of view its own laps count', () => {
    const earlier = qualifying('q2', [qualiLap(2, 1, 89_700)], seats(4), QUALIFYING);
    const weekend = weekendOf([practice('fp3', [shortRun(2)], seats(4)), earlier]);
    const own = { laps: [qualiLap(2, 1, 90_100), qualiLap(2, 2, 89_400)] };
    const q3: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 3 };
    const view = viewOf({ seats: seats(4), phase: q3, lists: own, weekend });
    const out = calc.compute(view);
    const pace = valueOf(out, 2);
    expect(pace.source).toBe('qualifying');
    // the session's own 89.400 beats the earlier session's 89.700
    expect(pace.paceMs).toBe(89_400 + raceTrimOffsetMs);
    // the as-of form is the calculator on the as-of view (the planning round's view, C62d)
    expect(asOf(asOfNow(view))).toEqual(out);
    // in the race the session's own laps are no qualifying laps: the earlier session's best stands
    const race = valueOf(calc.compute(viewOf({ seats: seats(4), phase: RACE, lists: own, weekend })), 2);
    expect(race.paceMs).toBe(89_700 + raceTrimOffsetMs);
  });

  it('5b. priors: with a priors snapshot passed explicitly (C84) the tyre-age correction uses its slope; without one the stint`s own', () => {
    const run = longRun(3);
    const weekend = weekendOf([practice('fp2', [run])]);
    // the calibration set's medium slope, well below the stint's own NU
    const slope = 40;
    const priors = viewPriors(priorsSnapshot({ medium: { nuMsPerLap: slope, nuSdMs: 20 } }));
    const withPriors = valueOf(calc.compute(viewOf({ seats: seats(6), weekend, priors })), 3);
    const byPriors = median(corrected(run.laps, slope));
    expect(withPriors.source).toBe('longRun');
    expect(Math.abs(withPriors.paceMs - byPriors), `pace ${withPriors.paceMs} against ${byPriors}`).toBeLessThanOrEqual(50);
    const without = valueOf(calc.compute(viewOf({ seats: seats(6), weekend })), 3);
    const byOwn = median(corrected(run.laps, NU));
    expect(Math.abs(without.paceMs - byOwn), `pace ${without.paceMs} against ${byOwn}`).toBeLessThanOrEqual(50);
    // the two corrections are far apart: the slope used is the priors' one
    expect(Math.abs(byPriors - byOwn)).toBeGreaterThan(200);
  });

  describe('6. contract', () => {
    it('is a registered quick calculator reading degradation, decisions (view.priors, C62a), laps, stints, weekend-phase and car-status (C41)', () => {
      const registered = CALCULATORS.find((c) => c.id === WEEKEND_PACE);
      expect(registered, 'weekend-pace among the package`s calculators').toBeDefined();
      expect(registered?.kind).toBe('quick');
      expect(registered?.reads).toEqual(expect.arrayContaining([{ calculator: DEGRADATION }, 'decisions', 'laps', 'stints', 'spans:weekend-phase', 'spans:car-status']));
    });

    it('its behaviour table covers every kind of weekend-phase and car-status (C44)', () => {
      for (const machine of ['weekend-phase', 'car-status']) {
        const kinds = SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];
        expect(kinds.length, machine).toBeGreaterThan(0);
        expect(Object.keys(WEEKEND_PACE_BEHAVIOUR[machine] ?? {}).sort(), machine).toEqual([...kinds].sort());
      }
    });

    it("while the weekend phase is pending, and in phase none, every car is unknown('notApplicable')", () => {
      const weekend = weekendOf([practice('fp2', [longRun(3)])]);
      for (const phase of [{ kind: 'pending' }, { kind: 'none' }] as const) {
        const out = calc.compute(viewOf({ seats: seats(6), phase, weekend }));
        expect(Object.keys(out).length, phase.kind).toBeGreaterThan(0);
        for (const [car, pace] of Object.entries(out)) expect(pace, `${phase.kind}: car ${car}`).toEqual(unknown('notApplicable'));
      }
    });

    it('a car that is not competing has no entry', () => {
      const weekend = weekendOf([practice('fp2', [longRun(3), longRun(4)])]);
      const out = calc.compute(viewOf({ seats: seats(6), weekend, status: { 4: 'retired' } }));
      expect(valueOf(out, 3).source).toBe('longRun');
      expect(out[carId(4)]).toBeUndefined();
    });
  });
});
