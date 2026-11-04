import { carId, unknown, type LapRecord, type StintRecord, type WeekendPhase } from '@pitwall/domain';
import { projectionLengths, type EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { PACE, PACE_BEHAVIOUR, PACE_CONFIG } from '../../src/pace/index.ts';
import { paceCalculator } from '../../src/pace/calculator.ts';
import { paceHistoryCalculator } from '../../src/index.ts';
import { field, lap } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';
import { NONE, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';
import { split } from '../split.ts';

/**
 * `pace` and its fold `pace-history`, each part through its own guarded view (C31.2, C41): every init and update fails
 * on a read it does not declare.
 */
const pace = split(paceCalculator, paceHistoryCalculator);

const stint = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
  frame: 0,
  ...over,
});

const raceView = (laps: LapRecord[], stints: StintRecord[] = [], phase: WeekendPhase = RACE): EngineView =>
  situatedView({ history: { laps, stints }, phase });

/** `init` over the laps, as the scheduler does on a fresh run. */
const run = (view: EngineView) => pace.output(pace.init(view));

const timed = (n: number, lapTimeMs: number, over: Partial<LapRecord> = {}) => lap({ lapNumber: n, lapTimeMs, ...over });

describe('pace calculator', () => {
  // Restated in Task 22 round 2 (C31.2): `pace` is quick and reads its fold `pace-history` of the laps and stints; the
  // reads are the two parts' together.
  it('is the quick calculator `pace` over its fold of laps and stints (`pace-history`, incremental) and the weekend phase, due when a lap completes; not the session', () => {
    expect(paceCalculator.id).toBe(PACE);
    expect(paceCalculator.kind).toBe('quick');
    expect(paceCalculator.cadence).toBe('lapCompleted');
    expect(paceCalculator.reads).toContainEqual({ calculator: 'pace-history' });
    expect(paceHistoryCalculator.kind).toBe('incremental');
    expect(paceHistoryCalculator.reads).toEqual(expect.arrayContaining(['laps', 'stints']));
    expect(pace.reads()).toEqual(expect.arrayContaining(['laps', 'stints', 'spans:weekend-phase']));
    expect(pace.reads()).not.toContain('session');
  });

  it('recent is the mean of the last 3 pace laps; an SC lap in between is skipped', () => {
    const laps = [
      timed(2, 91_000),
      timed(3, 92_000),
      timed(4, 120_000, { scShare: 0.5 }),
      timed(5, 93_000),
      timed(6, 94_000),
    ];
    const car = run(raceView(laps)).byCar[carId(0)]!;
    // pace laps are 2, 3, 5, 6: the last three are 92, 93 and 94 s
    expect(car.recentMs).toEqual({ known: true, value: 93_000, at: laps[4]!.completedAt });
    expect(car.samples).toBe(3);
  });

  it('a lap with under 2 s under SC (the flag lag at a restart, user ruling 2026-10-30) is a pace lap', () => {
    // lap 4 is green but for 0.9 s: scShare 0.01 of 90 s
    const laps = [timed(2, 92_000), timed(3, 94_000), timed(4, 90_000, { scShare: 0.01 })];
    const car = run(raceView(laps)).byCar[carId(0)]!;
    expect(car.recentMs).toEqual({ known: true, value: 92_000, at: laps[2]!.completedAt });
    expect(car.samples).toBe(3);
  });

  it('uses the window from the config', () => {
    const laps = [timed(2, 90_000), timed(3, 92_000), timed(4, 94_000)];
    const view = situatedView({ history: { laps }, config: { [PACE_CONFIG.key]: { window: 2 } } });
    const car = run(view).byCar[carId(0)]!;
    expect(car.recentMs).toMatchObject({ known: true, value: 93_000 });
    expect(car.samples).toBe(2);
  });

  it('with fewer pace laps than the window, recent is the mean of those', () => {
    const car = run(raceView([timed(2, 90_000), timed(3, 92_000)])).byCar[carId(0)]!;
    expect(car.recentMs).toMatchObject({ known: true, value: 91_000 });
    expect(car.samples).toBe(2);
  });

  it('stint mean resets at a new stint', () => {
    const laps = [2, 3, 4, 5, 6, 7].map((n) => timed(n, n < 5 ? 90_000 : 96_000 + (n - 5) * 1_000));
    // the engine writes a record when a stint closes: stint 1 has one, the open stint (lap 5 on) none
    const stints = [stint({ firstLap: 1, lastLap: 4 })];
    const car = run(raceView(laps, stints)).byCar[carId(0)]!;
    // current stint: laps 5, 6, 7 = 96, 97, 98 s
    expect(car.stintMs).toEqual({ known: true, value: 97_000, at: laps[5]!.completedAt });
    expect(car.recentMs).toMatchObject({ known: true, value: 97_000 });
  });

  it('the stint mean spans the whole stint, not only the window', () => {
    const laps = [2, 3, 4, 5].map((n) => timed(n, 90_000 + (n - 2) * 2_000)); // 90, 92, 94, 96
    const car = run(raceView(laps)).byCar[carId(0)]!;
    expect(car.stintMs).toMatchObject({ known: true, value: 93_000 });
    expect(car.recentMs).toMatchObject({ known: true, value: 94_000 });
  });

  it('a stint record that ends on the newest lap (the session ended) is the current stint', () => {
    const laps = [2, 3, 4, 5, 6].map((n) => timed(n, n < 4 ? 90_000 : 96_000));
    const stints = [stint({ firstLap: 1, lastLap: 3 }), stint({ firstLap: 4, lastLap: 6 })];
    expect(run(raceView(laps, stints)).byCar[carId(0)]!.stintMs).toMatchObject({ known: true, value: 96_000 });
  });

  it('engine-shaped: closed stint 1, the open stint 2 without a record, every lap provisional then confirmed', () => {
    // stint 1: laps 2-4 at 90 s (lap 4 the in lap); stint 2 from lap 5 (the out lap), then 96, 97, 98 s
    const laps = engineShaped(
      [
        timed(2, 90_000),
        timed(3, 90_000),
        timed(4, 110_000, { inLap: true }),
        timed(5, 115_000, { outLap: true }),
        timed(6, 96_000),
        timed(7, 97_000),
        timed(8, 98_000),
      ],
      { lapTimeMs: 80_000 },
    );
    const car = run(raceView(laps, [stint({ firstLap: 1, lastLap: 4 })])).byCar[carId(0)]!;
    expect(car.stintMs).toMatchObject({ known: true, value: 97_000 });
    expect(car.recentMs).toMatchObject({ known: true, value: 97_000 });
    expect(car.samples).toBe(3);
  });

  it('without a stint record the history counts as one stint', () => {
    const car = run(raceView([timed(2, 90_000), timed(3, 92_000)])).byCar[carId(0)]!;
    expect(car.stintMs).toMatchObject({ known: true, value: 91_000 });
  });

  it('a car with no pace lap has recentMs insufficientData', () => {
    const laps = [
      timed(1, 100_000), // lap 1 of a race
      timed(2, 100_000, { inLap: true }),
      timed(3, 100_000, { valid: { lap: false, sectors: [true, true, true] } }),
    ];
    const car = run(raceView(laps)).byCar[carId(0)]!;
    expect(car.recentMs).toEqual({ known: false, reason: 'insufficientData' });
    expect(car.stintMs).toEqual({ known: false, reason: 'insufficientData' });
    expect(car.samples).toBe(0);
  });

  it('a car without any lap has no entry', () => {
    expect(run(raceView([timed(2, 90_000)])).byCar[carId(1)]).toBeUndefined();
  });

  it('keeps cars apart', () => {
    const laps = [timed(2, 90_000), timed(2, 80_000, { carId: carId(1) })];
    const out = run(raceView(laps));
    expect(out.byCar[carId(0)]!.recentMs).toMatchObject({ value: 90_000 });
    expect(out.byCar[carId(1)]!.recentMs).toMatchObject({ value: 80_000 });
  });

  it('a provisional then confirmed lap counts once', () => {
    const provisional = timed(2, 90_500, { status: 'provisional' });
    const confirmed = timed(2, 90_000);
    const both = raceView([provisional, confirmed]);
    const car = run(both).byCar[carId(0)]!;
    expect(car.samples).toBe(1);
    expect(car.recentMs).toMatchObject({ known: true, value: 90_000 });

    // the same through update: the provisional arrives first, the confirmation in the next delta
    const first = raceView([provisional]);
    const acc = pace.init(first);
    const delta = { before: projectionLengths(first.history), after: projectionLengths(both.history) };
    const next = pace.update(acc, delta, both);
    expect(pace.output(next)).toEqual(run(both));
  });

  it('update over a delta equals init over the whole history', () => {
    const { laps } = field({ cars: 3, laps: 8, paceMs: [90_000, 91_000, 92_500] });
    let acc = pace.init(raceView([]));
    let before = projectionLengths(raceView([]).history);
    for (let n = 1; n <= laps.length; n += 3) {
      const view = raceView(laps.slice(0, n + 2));
      const after = projectionLengths(view.history);
      acc = pace.update(acc, { before, after }, view);
      before = after;
      expect(pace.output(acc)).toEqual(run(view));
    }
  });

  it('flashback equals fresh run', () => {
    const { laps } = field({ cars: 3, laps: 8, paceMs: [90_000, 91_000, 92_500] });
    const full = raceView(laps);
    const acc = pace.update(pace.init(raceView(laps.slice(0, 6))), {
      before: projectionLengths(raceView(laps.slice(0, 6)).history),
      after: projectionLengths(full.history),
    }, full);
    const kept = laps.filter((l) => l.lapNumber <= 4);
    const truncatedView = raceView(kept);
    const truncated = pace.update(acc, { before: projectionLengths(full.history), after: projectionLengths(truncatedView.history), rewound: { frameId: -1, at: 0 } }, truncatedView);
    expect(pace.output(truncated)).toEqual(run(truncatedView));
  });

  describe('behaviour table (C44): a row per weekend-phase kind', () => {
    it('exports PACE_BEHAVIOUR over the weekend phase alone (laps by activity come from the lap records)', () => {
      expect(Object.keys(PACE_BEHAVIOUR)).toEqual(['weekend-phase']);
    });

    // lap 1 at 100 s, laps 2 and 3 at 90 s
    const laps = [timed(1, 100_000), timed(2, 90_000), timed(3, 90_000)];

    it('race: lap 1 of the race is no pace lap', () => {
      const car = run(raceView(laps, [], RACE)).byCar[carId(0)]!;
      expect(car.samples).toBe(2);
      expect(car.recentMs).toMatchObject({ known: true, value: 90_000 });
    });

    it('practice: lap 1 is a pace lap like any other', () => {
      const car = run(raceView(laps, [], PRACTICE)).byCar[carId(0)]!;
      expect(car.samples).toBe(3);
      expect(car.recentMs).toMatchObject({ known: true, value: 93_333 });
    });

    it('qualifying: lap 1 is a pace lap like any other', () => {
      const car = run(raceView(laps, [], QUALIFYING)).byCar[carId(0)]!;
      expect(car.samples).toBe(3);
      expect(car.stintMs).toMatchObject({ known: true, value: 93_333 });
    });

    it('none (a time trial, C14): every car with laps has recent and stint pace notApplicable, no samples', () => {
      const both = [...laps, timed(2, 80_000, { carId: carId(1) })];
      const out = run(raceView(both, [], NONE));
      for (const id of [carId(0), carId(1)]) {
        expect(out.byCar[id]).toEqual({ recentMs: unknown('notApplicable'), stintMs: unknown('notApplicable'), samples: 0 });
      }
    });

    it('none: update over a delta equals init over the whole history', () => {
      const first = raceView(laps.slice(0, 1), [], NONE);
      const all = raceView(laps, [], NONE);
      const acc = pace.update(pace.init(first), { before: projectionLengths(first.history), after: projectionLengths(all.history) }, all);
      expect(pace.output(acc)).toEqual(run(all));
    });
  });
});
