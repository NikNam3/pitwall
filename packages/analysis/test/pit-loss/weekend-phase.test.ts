// `pit-loss` and the weekend phase (contract C14, C41, C44; finding F1): the calculator and the priors aggregate judge a
// session's laps by its weekend phase (lap 1 of a race is no reference lap, `lap-classes`). They read it as `degradation`
// does: through one behaviour table over every weekend-phase kind (`PIT_LOSS_BEHAVIOUR`), the calculator declaring
// `spans:weekend-phase` in its reads. A pending phase reads as the race's grid (C14). Spec 4.3 names no phase, so `none`
// (a time trial or an unknown session type) follows degradation's row: it computes, lap 1 counting as in practice.
//
// The probe: car 0 stops on lap 2 with lap 1 its only reference lap. In the race lap 1 is no `forPace` lap, so the stop
// has no reference (`noReference`); in practice, qualifying and `none` it is, and the stop is `used`.
import { carId, unknown, weekendPhaseSpans, type LapRecord, type PitStopRecord, type WeekendPhase } from '@pitwall/domain';
import type { EngineView, StoredSource } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { lap, history } from '../../../../test-support/builders/index.ts';
import { pitLossCalculator } from '../../src/pit-loss/calculator.ts';
import { PIT_LOSS, PIT_LOSS_BEHAVIOUR, PIT_LOSS_PRIORS, type PitLossOutput } from '../../src/pit-loss/index.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';
import { CALCULATORS } from '../units.ts';

const calc = guardedQuick(pitLossCalculator);

/** Car 0's laps around its stop on lap 2: lap 1 (its only reference), the in-lap and the out-lap. */
const LAPS: LapRecord[] = [
  lap({ carId: carId(0), lapNumber: 1, lapTimeMs: 80_000, frame: 100 }),
  lap({ carId: carId(0), lapNumber: 2, lapTimeMs: 92_000, inLap: true, frame: 200 }),
  lap({ carId: carId(0), lapNumber: 3, lapTimeMs: 92_000, outLap: true, frame: 300 }),
];

/** Car 0's stop on lap 2. */
const STOP: PitStopRecord = {
  carId: carId(0),
  lap: 2,
  pitLaneEntry: 175_000,
  pitLaneExit: 195_000,
  pitLaneTimeMs: 20_000,
  stationaryTimeMs: 2_500,
  flag: 'green',
  penaltyServed: false,
  frame: 250,
};

/** The probe's view in weekend phase `phase` (its open `weekend-phase` span, none while pending); no priors, no track file. */
const viewIn = (phase: WeekendPhase): EngineView =>
  situatedView({ phase, history: history({ laps: LAPS, pitStops: [STOP] }), priors: unknown('notApplicable'), track: unknown('notApplicable') });

/** `compute` through the guarded view (C41): a read the calculator does not declare throws. */
const compute = (phase: WeekendPhase): PitLossOutput => calc.compute(viewIn(phase));

/** The probe as a stored source (C62a) of a session in weekend phase `phase`. */
const storedSource = (phase: WeekendPhase): StoredSource => ({
  source: { sessionUid: '1', weekendId: 'w1', feedCar: carId(0), car: carId(0), firstLap: 1, excludedLaps: [] },
  phase,
  aiDifficulty: unknown('notReceived'),
  projection: history(),
  stint: { carId: carId(0), firstLap: 1, lastLap: 2, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 0, frame: 100 },
  laps: LAPS,
  pitStops: [STOP],
  sessionLaps: LAPS,
  track: unknown('notApplicable'),
});

/** The green-flag aggregate of the probe's session in weekend phase `phase`. */
const aggregateIn = (phase: WeekendPhase) => {
  const aggregate = PIT_LOSS_PRIORS.entries['pitLoss.ms.green']?.aggregate;
  if (aggregate === undefined) throw new Error('pitLoss.ms.green declares an aggregate');
  return aggregate([storedSource(phase)], { config: {}, overrides: {} });
};

describe('pit-loss: the weekend phase (C14, C41, C44)', () => {
  it("pit-loss's behaviour table covers every weekend-phase kind", () => {
    expect(Object.keys(PIT_LOSS_BEHAVIOUR)).toEqual(['weekend-phase']);
    expect(Object.keys(PIT_LOSS_BEHAVIOUR['weekend-phase']!).sort()).toEqual([...weekendPhaseSpans.kinds].sort());
    // the rows: only the race makes lap 1 no reference lap; `none` follows degradation's row (spec 4.3 names no phase)
    expect(PIT_LOSS_BEHAVIOUR['weekend-phase']).toEqual({
      practice: { isRace: false },
      qualifying: { isRace: false },
      race: { isRace: true },
      none: { isRace: false },
    });
    // the generic completeness tests (behaviour-completeness, guarded-view-completeness) see the calculator
    expect(CALCULATORS.map((c) => c.id)).toContain(PIT_LOSS);
  });

  it('the guarded-view test passes with the declared read', () => {
    expect(pitLossCalculator.reads).toContain('spans:weekend-phase');
    // every kind computes through the guarded view: the weekend-phase span is read only as declared
    for (const phase of [RACE, PRACTICE, QUALIFYING, NONE, { kind: 'pending' } as const]) expect(() => compute(phase)).not.toThrow();
  });

  it('lap 1 of a race is no reference lap; in practice and qualifying it is', () => {
    expect(compute(RACE).stops).toMatchObject([{ carId: carId(0), lap: 2, use: 'noReference' }]);
    // 92 000 + 92 000 − 2 × 80 000
    for (const phase of [PRACTICE, QUALIFYING]) {
      expect(compute(phase).stops).toMatchObject([{ carId: carId(0), lap: 2, use: 'used', lossMs: { known: true, value: 24_000 } }]);
    }
  });

  it('a pending weekend phase computes as the race', () => {
    const pending = compute({ kind: 'pending' });
    expect(pending.stops).toMatchObject([{ carId: carId(0), lap: 2, use: 'noReference' }]);
    expect(pending).toEqual(compute(RACE));
  });

  // Spec 4.3 gives `none` no `notApplicable`: pit-loss's output has no such shape, and its priors count practice
  // sessions' stops; `none` follows degradation's row, as practice.
  it('weekend phase none computes as practice: lap 1 is a reference lap', () => {
    expect(compute(NONE)).toEqual(compute(PRACTICE));
    expect(compute(NONE).stops).toMatchObject([{ use: 'used', lossMs: { known: true, value: 24_000 } }]);
  });

  it("the aggregate judges a source session's laps by its weekend phase's row: pending as the race, none as practice", () => {
    expect(aggregateIn(RACE)).toEqual(unknown('insufficientData'));
    expect(aggregateIn({ kind: 'pending' })).toEqual(aggregateIn(RACE));
    expect(aggregateIn(PRACTICE)).toMatchObject({ known: true, value: 24_000 });
    expect(aggregateIn(QUALIFYING)).toEqual(aggregateIn(PRACTICE));
    expect(aggregateIn(NONE)).toEqual(aggregateIn(PRACTICE));
  });
});
