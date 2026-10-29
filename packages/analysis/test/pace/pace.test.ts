import { carId, type LapRecord, type StintRecord } from '@pitwall/domain';
import { historyLengths, type EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { PACE, PACE_CONFIG } from '../../src/pace/index.ts';
import { paceCalculator } from '../../src/pace/calculator.ts';
import { engineView, field, lap } from '../../../../test-support/builders/index.ts';
import { engineShaped } from '../engine-shaped.ts';

const stint = (over: Partial<StintRecord> & Pick<StintRecord, 'firstLap' | 'lastLap'>): StintRecord => ({
  carId: carId(0),
  actualCompound: 'C3',
  visualCompound: 'soft',
  tyreAgeAtFitting: 0,
  ...over,
});

const raceView = (laps: LapRecord[], stints: StintRecord[] = [], kind: 'race' | 'practice' = 'race'): EngineView =>
  engineView({ history: { laps, stints }, session: { kind } });

/** `init` over the laps, as the scheduler does on a fresh run. */
const run = (view: EngineView) => paceCalculator.output(paceCalculator.init(view));

const timed = (n: number, lapTimeMs: number, over: Partial<LapRecord> = {}) => lap({ lapNumber: n, lapTimeMs, ...over });

describe('pace calculator', () => {
  it('is the incremental calculator `pace` over laps, due when a lap completes', () => {
    expect(paceCalculator.id).toBe(PACE);
    expect(paceCalculator.kind).toBe('incremental');
    expect(paceCalculator.cadence).toBe('lapCompleted');
    expect(paceCalculator.reads).toContain('laps');
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

  it('uses the window from the config', () => {
    const laps = [timed(2, 90_000), timed(3, 92_000), timed(4, 94_000)];
    const view = engineView({ history: { laps }, session: { kind: 'race' }, config: { [PACE_CONFIG.key]: { window: 2 } } });
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

  it('lap 1 is a pace lap in practice, so the race flag comes from the session kind', () => {
    const laps = [timed(1, 100_000)];
    expect(run(raceView(laps, [], 'practice')).byCar[carId(0)]!.samples).toBe(1);
    expect(run(raceView(laps, [], 'race')).byCar[carId(0)]!.samples).toBe(0);
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
    const acc = paceCalculator.init(first);
    const delta = { before: historyLengths(first.state.history), after: historyLengths(both.state.history), truncated: false };
    const next = paceCalculator.update(acc, delta, both);
    expect(paceCalculator.output(next)).toEqual(run(both));
  });

  it('update over a delta equals init over the whole history', () => {
    const { laps } = field({ cars: 3, laps: 8, paceMs: [90_000, 91_000, 92_500] });
    let acc = paceCalculator.init(raceView([]));
    let before = historyLengths(raceView([]).state.history);
    for (let n = 1; n <= laps.length; n += 3) {
      const view = raceView(laps.slice(0, n + 2));
      const after = historyLengths(view.state.history);
      acc = paceCalculator.update(acc, { before, after, truncated: false }, view);
      before = after;
      expect(paceCalculator.output(acc)).toEqual(run(view));
    }
  });

  it('flashback equals fresh run', () => {
    const { laps } = field({ cars: 3, laps: 8, paceMs: [90_000, 91_000, 92_500] });
    const full = raceView(laps);
    const acc = paceCalculator.update(paceCalculator.init(raceView(laps.slice(0, 6))), {
      before: historyLengths(raceView(laps.slice(0, 6)).state.history),
      after: historyLengths(full.state.history),
      truncated: false,
    }, full);
    const kept = laps.filter((l) => l.lapNumber <= 4);
    const truncatedView = raceView(kept);
    const truncated = paceCalculator.update(acc, { before: historyLengths(full.state.history), after: historyLengths(truncatedView.state.history), truncated: true }, truncatedView);
    expect(paceCalculator.output(truncated)).toEqual(run(truncatedView));
  });
});
