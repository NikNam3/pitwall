// The plain forecast's lap time at horizon 1 (SP4.3a final review F7): on real races the h1 lap-time error was 5–11 s
// a lap (Texas 5.5 s with bias +3.0 s, Singapore 8.6 s, Zandvoort 11.4 s with bias −10.2 s) while the positions were
// close. A forecast one lap ahead on a green, dry lap with no stop must land within the lap's own noise.
//
// The reproduction is a generator race whose truth is known: the defaults' 20 cars and their stops (laps 18 to 22,
// medium to hard), every car an AI car with lap scatter σ = 200 ms and no mistakes, 30 laps, no safety car, dry. The
// cases scored are the h = 1 lap-time cases of the job's report whose start lap L and target lap L + 1 are green racing
// laps of that car: lap L ≥ 3, neither lap an in lap or an out lap, no SC or VSC share. Their mean absolute error must
// be under 3 σ (the brief's bound). Before the fix the cases in the stop window were forecast about 20 s slow (a stop
// on a lap the car did not stop on), so the mean was about 0.9 s.
import { addLaps, emptyCurrentLaps, type LapRecord, type ScoreCase } from '@pitwall/domain';
import { createRng } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/forecast-score/job.ts';
import { GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { generated, inputAt } from './support.ts';

/** The generator's lap scatter of every car (ms). */
const SIGMA_MS = 200;

/** The defaults' field and stops, every car an AI car with σ 200 ms and no mistakes, 30 laps. */
const PARAMS: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  laps: 30,
  field: GENERATOR_DEFAULTS.field.map((car) => ({ ...car, human: false, sigmaMs: SIGMA_MS, rho: 0.3, mistakeRate: 0 })),
};

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

describe('forecast-score: the plain forecast one lap ahead (F7)', () => {
  it('on green dry laps with no stop, the h1 lap-time mean absolute error is under 3σ of the generator', () => {
    const input = inputAt(generated(PARAMS, 2));
    const report = run(input, createRng(0));

    const laps = addLaps(emptyCurrentLaps(), input.history.laps as readonly LapRecord[]);
    const lapOf = (car: number, n: number): LapRecord | undefined => laps[car]?.[n];
    /** A green racing lap of the car: no in lap, no out lap, no SC or VSC share. */
    const racing = (l: LapRecord | undefined): boolean => l !== undefined && !l.inLap && !l.outLap && l.scShare === 0 && l.vscShare === 0;

    const h1 = report.forecasts.filter((f) => f.horizon === 1).flatMap((f) => f.lapTime.cases);
    const scored: ScoreCase[] = h1.filter((c) => c.lap >= 3 && racing(lapOf(c.carId, c.lap)) && racing(lapOf(c.carId, c.lap + 1)));
    expect(scored.length, 'h1 lap-time cases on green racing laps').toBeGreaterThanOrEqual(300);

    // every case is scored against the car's own confirmed lap L + 1
    for (const c of scored) expect(c.actual).toBe(lapOf(c.carId, c.lap + 1)!.lapTimeMs);

    const errors = scored.map((c) => c.error);
    const meanAbs = mean(errors.map(Math.abs));
    const worst = [...scored].sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, 4);
    const detail = `mean abs ${meanAbs.toFixed(0)} ms, bias ${mean(errors).toFixed(0)} ms over ${scored.length} cases; worst ${worst
      .map((c) => `car ${c.carId} lap ${c.lap}: predicted ${c.predicted}, actual ${c.actual}`)
      .join('; ')}`;
    expect(meanAbs, detail).toBeLessThan(3 * SIGMA_MS);
  }, 300_000);
});
