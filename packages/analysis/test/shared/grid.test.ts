// The race's grid from qualifying (SP4.3d2 Task 7, spec §7.0 rule 5, §7.2; contract C3, C25, C62): `shared/grid.ts`'s
// `gridOf(view)` orders the session's cars by their best valid lap (the current lap records, `currentLaps`, C25; on a
// tie the earlier lap first). In a long format's last segment (Q3, SQ3) the cars it eliminated earlier follow from
// `view.basis`: the newest stored session of segment 2 of the same qualifying format (a league restart's newest
// attempt), then the newest of segment 1, each's eliminated cars by their best valid lap there, matched to this
// session's slots by team and race number (`fixed.carKeys` and each stored session's `cars`, C62). Cars without a valid
// time come last, in car order. Outside qualifying the grid is `notApplicable`.
//
// How these tests read the interface (the test agent's decisions, Task 7): "the session's cars" are the slots with a
// car-status span other than `absent` (C17); a stored session's weekend phase is its projection's `weekend-phase` span
// (`BasisContext`); a stored session's slots differ from this session's (a league lobby reorders them), so only the
// car keys match them.
import { carId, known, unknown, type CarId, type CarKey, type FactRef, type LapRecord, type Span, type WeekendPhase } from '@pitwall/domain';
import type { AsOfView, Projection, StoredSession, BasisContext } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { history, lap } from '../../../../test-support/builders/index.ts';
import { gridOf } from '../../src/shared/grid.ts';
import { openSpan } from '../situated.ts';

/** The session's slots: 20 cars (0 … 19), slots 20 and 21 empty (absent, no car key). */
const CARS = 20;
const SLOTS = 22;

/** Car slot `k`'s team and race number in this session: every car its own key. */
const keyOf = (k: number): CarKey => ({ teamId: k % 10, raceNumber: 2 + k * 3 });

const Q1: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 1 };
const Q2: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 2 };
const Q3: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 3 };
const SQ1: WeekendPhase = { kind: 'qualifying', format: 'sprintShootout', segment: 1 };
const SQ2: WeekendPhase = { kind: 'qualifying', format: 'sprintShootout', segment: 2 };
const ONE_SHOT: WeekendPhase = { kind: 'qualifying', format: 'oneShot', segment: undefined };
const PRACTICE: WeekendPhase = { kind: 'practice', format: 'practice', segment: 3 };
const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };

/** One timed lap: a car's lap `n` of `ms`, valid unless `valid: false`, completed at `at` (its frame `at`). */
type Timed = { car: number; ms: number; n?: number; valid?: boolean; at?: number; status?: LapRecord['status']; supersedes?: FactRef };

/** Lap records of `times`, in the order given; each completes at its `at` (default: its index × 100 s). */
function lapsOf(times: readonly Timed[]): LapRecord[] {
  return times.map((t, i) => {
    const at = t.at ?? (i + 1) * 100_000;
    return lap({
      carId: carId(t.car),
      lapNumber: t.n ?? 2,
      lapTimeMs: t.ms,
      valid: { lap: t.valid ?? true, sectors: [true, true, true] },
      completedAt: at,
      status: t.status ?? 'confirmed',
      ...(t.supersedes !== undefined && { supersedes: t.supersedes }),
      outLap: false,
      inLap: false,
      frame: Math.floor(at / 100),
    });
  });
}

/** The weekend-phase span's detail of `phase`: its format and segment (C14). */
const detailOf = (phase: WeekendPhase): unknown => {
  const { kind: _kind, ...detail } = phase;
  return detail;
};

/** The weekend-phase span of `phase` as a stored session's projection holds it: closed (C28). */
function phaseSpan(phase: WeekendPhase): Span {
  if (phase.kind === 'pending') throw new Error('no span while pending');
  return { ...openSpan('weekend-phase', phase.kind, { detail: detailOf(phase) }), end: 3_600_000, endFrame: 36_000 } as Span;
}

/**
 * A stored earlier session of the weekend in `phase` with `times`, its slots `slotOf(k)` for this session's car `k`
 * (default: shifted by 7, so a stored slot is never this session's), every car of this session in it.
 */
function stored(uid: string, phase: WeekendPhase, times: readonly Timed[], slotOf: (k: number) => number = (k) => (k + 7) % CARS): StoredSession {
  const laps = lapsOf(times.map((t) => ({ ...t, car: slotOf(t.car) })));
  const projection: Projection = history({ laps, spans: { 'weekend-phase': [phaseSpan(phase)] } });
  const cars = Array.from({ length: CARS }, (_, k) => ({ carId: carId(slotOf(k)), carKey: keyOf(k) }));
  return { sessionUid: uid as StoredSession['sessionUid'], weekendId: 'w1', playerCar: carId(slotOf(0)), cars, projection };
}

/** The weekend context with `sessions` (oldest first), our car slot 0's key. */
const weekendOf = (sessions: StoredSession[]): BasisContext => ({ basis: { practice: [], qualifying: null }, player: keyOf(0), sessions });

/**
 * The ended session's as-of view in `phase` with `times`: 20 competing cars (slots 0 … 19, each its car key), slots 20
 * and 21 absent (no key), `weekend` as given.
 */
function sessionView(phase: WeekendPhase, times: readonly Timed[], weekend?: BasisContext): AsOfView {
  const status = Array.from({ length: SLOTS }, (_, k) => openSpan('car-status', k < CARS ? 'competing' : 'absent', { car: k }));
  const weekendSpan = phase.kind === 'pending' ? [] : [openSpan('weekend-phase', phase.kind, { detail: detailOf(phase) })];
  const keys: (CarKey | null)[] = Array.from({ length: SLOTS }, (_, k) => (k < CARS ? keyOf(k) : null));
  return {
    history: history({ laps: lapsOf(times) }),
    situation: { weekendPhase: phase, byMachine: { 'car-status': status, 'weekend-phase': weekendSpan } },
    frame: 'now',
    at: 3_600_000,
    config: {},
    priors: unknown('notApplicable'),
    drivers: Array.from({ length: SLOTS }, () => unknown('notApplicable')),
    track: unknown('notApplicable'),
    basis: weekend,
    outputs: new Map(),
    fixed: {
      totalLaps: known(30, 0),
      playerCar: known(carId(0), 0),
      teammateCar: known(carId(1), 0),
      aiDifficulty: known(90, 0),
      safetyCar: unknown('notReceived'),
      carKeys: known(keys, 0),
      setsNow: null,
      weatherNow: null,
    },
  };
}

/** The known grid of `view`; throws when it is unknown. */
function gridValue(view: AsOfView): CarId[] {
  const g = gridOf(view);
  if (!g.known) throw new Error(`the grid is unknown (${g.reason})`);
  return [...g.value];
}

/** Times for `cars` in that order: the first `base` ms, each next one 100 ms slower. */
const ranked = (cars: readonly number[], base: number): Timed[] => cars.map((car, i) => ({ car, ms: base + i * 100 }));

// The long format (row 1): Q3's ten, Q2's five eliminated, Q1's five eliminated, each in its own order. Q2's eliminated
// are faster in Q2 than every Q3 time, and Q1's eliminated faster in Q1 than Q2's eliminated were in Q1: the segments'
// order, not the times across them, decides.
const Q3_ORDER = [12, 3, 17, 0, 8, 5, 19, 1, 10, 14];
const Q2_OUT = [6, 15, 2, 11, 9];
const Q1_OUT = [18, 4, 13, 7, 16];
const Q3_TIMES = ranked(Q3_ORDER, 92_000);
const Q2_TIMES = [...ranked(Q2_OUT, 91_000), ...ranked([...Q3_ORDER].reverse(), 90_000)];
const Q1_TIMES = [...ranked(Q1_OUT, 89_000), ...ranked([...Q2_OUT].reverse(), 89_600), ...ranked(Q3_ORDER, 90_200)];

describe('the grid from qualifying (SP4.3d2 Task 7)', () => {
  it("1: long format: Q3's 10 cars in Q3's order, then Q2's 5 eliminated by Q2, then Q1's 5 by Q1: 20 cars", () => {
    // a practice in the weekend, faster than every qualifying time, counts for nothing
    const practice = stored('fp3', PRACTICE, ranked([...Q1_OUT, ...Q2_OUT, ...Q3_ORDER].reverse(), 80_000));
    const view = sessionView(Q3, Q3_TIMES, weekendOf([practice, stored('q1', Q1, Q1_TIMES), stored('q2', Q2, Q2_TIMES)]));
    const grid = gridValue(view);
    expect(grid).toEqual([...Q3_ORDER, ...Q2_OUT, ...Q1_OUT]);
    expect(grid).toHaveLength(CARS);
  });

  it('1: the stored slots are matched by team and race number: another slot layout in each stored session gives the same grid', () => {
    const reversed = (k: number) => CARS - 1 - k;
    const view = sessionView(Q3, Q3_TIMES, weekendOf([stored('q1', Q1, Q1_TIMES, reversed), stored('q2', Q2, Q2_TIMES, (k) => (k + 11) % CARS)]));
    expect(gridValue(view)).toEqual([...Q3_ORDER, ...Q2_OUT, ...Q1_OUT]);
  });

  it("1: SQ3 reads the shootout's SQ2 and SQ1, never a grand prix qualifying's Q2 and Q1 (the same qualifying format)", () => {
    const sq3: WeekendPhase = { kind: 'qualifying', format: 'sprintShootout', segment: 3 };
    // the grand prix qualifying's segments order the eliminated cars the other way round
    const gpQ1 = stored('q1', Q1, [...ranked([...Q1_OUT].reverse(), 85_000), ...ranked([...Q2_OUT, ...Q3_ORDER], 86_000)]);
    const gpQ2 = stored('q2', Q2, [...ranked([...Q2_OUT].reverse(), 85_000), ...ranked(Q3_ORDER, 86_000)]);
    const view = sessionView(sq3, Q3_TIMES, weekendOf([stored('sq1', SQ1, Q1_TIMES), stored('sq2', SQ2, Q2_TIMES), gpQ1, gpQ2]));
    expect(gridValue(view)).toEqual([...Q3_ORDER, ...Q2_OUT, ...Q1_OUT]);
    // and Q3 reads the grand prix's Q2 and Q1, not the shootout's
    const q3 = sessionView(Q3, Q3_TIMES, weekendOf([gpQ1, gpQ2, stored('sq1', SQ1, Q1_TIMES), stored('sq2', SQ2, Q2_TIMES)]));
    expect(gridValue(q3)).toEqual([...Q3_ORDER, ...[...Q2_OUT].reverse(), ...[...Q1_OUT].reverse()]);
  });

  it('2: no time: a car without a valid lap is last, in car order; an invalid faster lap does not count', () => {
    // cars 0 … 16 timed in reverse slot order; 17 only an invalid lap (the fastest of all), 18 and 19 no lap
    const times: Timed[] = [...ranked(Array.from({ length: 17 }, (_, i) => 16 - i), 95_000), { car: 17, ms: 80_000, valid: false }];
    const grid = gridValue(sessionView(ONE_SHOT, times));
    expect(grid).toEqual([...Array.from({ length: 17 }, (_, i) => 16 - i), 17, 18, 19]);
    // the absent slots are not on the grid
    expect(grid).not.toContain(20);
    expect(grid).not.toContain(21);
  });

  it("2: a car's best valid lap counts, over the current lap records (C25): a confirmed record that invalidates its provisional", () => {
    const times: Timed[] = [
      // car 0: lap 2 provisional valid at 90 s, then confirmed invalid (superseding it); its valid lap 3 at 93 s counts
      { car: 0, n: 2, ms: 90_000, status: 'provisional', at: 100_000 },
      { car: 1, n: 2, ms: 92_000, at: 110_000 },
      { car: 0, n: 2, ms: 90_000, valid: false, status: 'confirmed', supersedes: { list: 'laps', index: 0 }, at: 120_000 },
      { car: 0, n: 3, ms: 93_000, at: 200_000 },
      { car: 2, n: 2, ms: 92_500, at: 210_000 },
    ];
    expect(gridValue(sessionView(ONE_SHOT, times)).slice(0, 3)).toEqual([1, 2, 0]);
  });

  it('2: on a tie the earlier lap goes first', () => {
    const times: Timed[] = [
      { car: 4, ms: 91_000, at: 300_000 },
      { car: 9, ms: 91_000, at: 200_000 },
      { car: 2, ms: 91_000, at: 250_000 },
    ];
    expect(gridValue(sessionView(ONE_SHOT, times)).slice(0, 3)).toEqual([9, 2, 4]);
  });

  it("2: a one-shot session uses its own order only: an earlier attempt's times in the weekend count for nothing", () => {
    // an earlier one-shot attempt (a league restart) and a grand prix qualifying in the weekend, each with every car timed
    const earlier = stored('attempt-1', ONE_SHOT, ranked(Array.from({ length: CARS }, (_, k) => k), 85_000));
    const weekend = weekendOf([stored('q1', Q1, Q1_TIMES), stored('q2', Q2, Q2_TIMES), earlier]);
    const times = ranked([5, 3, 1], 90_000);
    const rest = Array.from({ length: CARS }, (_, k) => k).filter((k) => ![5, 3, 1].includes(k));
    expect(gridValue(sessionView(ONE_SHOT, times, weekend))).toEqual([5, 3, 1, ...rest]);
  });

  it("2: with two stored Q2 sessions (a restart) the newest one's eliminations count", () => {
    // the first Q2 attempt eliminated Q2_OUT in that order; the restart in the reverse order
    const first = stored('q2-a', Q2, Q2_TIMES);
    const restart = stored('q2-b', Q2, [...ranked([...Q2_OUT].reverse(), 91_000), ...ranked(Q3_ORDER, 90_000)]);
    const view = sessionView(Q3, Q3_TIMES, weekendOf([stored('q1', Q1, Q1_TIMES), first, restart]));
    expect(gridValue(view)).toEqual([...Q3_ORDER, ...[...Q2_OUT].reverse(), ...Q1_OUT]);
    // the restart's order wins whichever stored slot layout it has
    const relaid = stored('q2-b', Q2, [...ranked([...Q2_OUT].reverse(), 91_000), ...ranked(Q3_ORDER, 90_000)], (k) => (k + 3) % CARS);
    expect(gridValue(sessionView(Q3, Q3_TIMES, weekendOf([stored('q1', Q1, Q1_TIMES), first, relaid])))).toEqual([...Q3_ORDER, ...[...Q2_OUT].reverse(), ...Q1_OUT]);
  });

  it('2: Q3 without its earlier segments in the weekend: its own order, then the cars without a time in car order', () => {
    const rest = Array.from({ length: CARS }, (_, k) => k).filter((k) => !Q3_ORDER.includes(k));
    expect(gridValue(sessionView(Q3, Q3_TIMES))).toEqual([...Q3_ORDER, ...rest]);
    expect(gridValue(sessionView(Q3, Q3_TIMES, weekendOf([])))).toEqual([...Q3_ORDER, ...rest]);
  });

  it("2: outside qualifying the grid is notApplicable (C3)", () => {
    for (const phase of [RACE, PRACTICE, { kind: 'none' } as WeekendPhase]) {
      expect(gridOf(sessionView(phase, Q3_TIMES)), phase.kind).toEqual(unknown('notApplicable'));
    }
  });
});
