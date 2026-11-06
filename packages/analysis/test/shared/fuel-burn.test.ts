// `burnPerLapKg` (contract C43): the one burn rate per lap of a car, shared by `fuel` (its `burnKgPerLap`) and
// `degradation` (a rival's hidden fuel past our car's last lap, spec 4.1), so both agree. Its rule is `fuel`'s: the
// median (`per-lap-rate`) of the own burns (start minus end) of the car's rate laps (`classifyLap(...).forRate`),
// a lap with a rising fuel (a refuel) or an unknown start or end being no sample.
import { known, unknown, type LapRecord } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { LAP_CLASSES_CONFIG } from '../../src/lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG } from '../../src/per-lap-rate/index.ts';
import { burnPerLapKg } from '../../src/shared/fuel-burn.ts';
import { lap } from '../../../../test-support/builders/index.ts';

/** The default options: `lap-classes`' and `per-lap-rate`'s config defaults. */
const OPTS = { lapClasses: LAP_CLASSES_CONFIG.defaults, rate: PER_LAP_RATE_CONFIG.defaults };

const insufficient = unknown('insufficientData');

/** Lap `n` of car 0 from `startKg` to `endKg`; `completedAt` is `n * 1000`. */
const fuelLap = (n: number, startKg: number, endKg: number, over: Partial<LapRecord> = {}): LapRecord =>
  lap({ lapNumber: n, completedAt: n * 1000, fuelAtStartKg: known(startKg, n * 1000), fuelAtEndKg: known(endKg, n * 1000), ...over });

/** Laps `from..to`, each burning `burn` kg, the first starting at `startKg`. */
const burnLaps = (from: number, to: number, burn: number, startKg: number, over: Partial<LapRecord> = {}): LapRecord[] =>
  Array.from({ length: to - from + 1 }, (_, i) => fuelLap(from + i, startKg - burn * i, startKg - burn * (i + 1), over));

const valueOf = (k: ReturnType<typeof burnPerLapKg>): number => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

describe('burnPerLapKg', () => {
  it('is the median of the rate laps` own burns, as of the newest sample', () => {
    // burns 1.5, 1.6, 1.4, 1.5, 1.7: sorted 1.4, 1.5, 1.5, 1.6, 1.7
    const laps = [fuelLap(1, 100, 98.5), fuelLap(2, 98.5, 96.9), fuelLap(3, 96.9, 95.5), fuelLap(4, 95.5, 94), fuelLap(5, 94, 92.3)];
    const burn = burnPerLapKg(laps, OPTS);
    expect(valueOf(burn)).toBeCloseTo(1.5, 9);
    expect(burn).toMatchObject({ known: true, at: 5000 });
  });

  it('a lap`s burn is its own start minus its own end: a drop between laps is in no lap', () => {
    // lap 2 starts 4 kg below lap 1's end: both laps burn 1.5 kg
    expect(valueOf(burnPerLapKg([fuelLap(1, 100, 98.5), fuelLap(2, 94.5, 93)], OPTS))).toBeCloseTo(1.5, 9);
  });

  it('a lap on which the fuel rose (a refuel) is no sample, never a negative burn', () => {
    const laps = [...burnLaps(1, 2, 1.5, 100), fuelLap(3, 97, 110), ...burnLaps(4, 5, 1.5, 110)];
    expect(valueOf(burnPerLapKg(laps, OPTS))).toBeCloseTo(1.5, 9);
    // a lap that burnt nothing is a sample
    expect(valueOf(burnPerLapKg([fuelLap(1, 100, 100), fuelLap(2, 100, 100)], OPTS))).toBe(0);
  });

  it('a refuel does not restart the samples: the laps before it stay in the window', () => {
    // laps 1-3 burn 3 kg/lap, lap 4 refuels from 91 to 110 kg, laps 5-6 burn 1.5 kg/lap: median of 3, 3, 3, 1.5, 1.5
    const laps = [...burnLaps(1, 3, 3, 100), fuelLap(4, 91, 110), ...burnLaps(5, 6, 1.5, 110)];
    expect(valueOf(burnPerLapKg(laps, OPTS))).toBeCloseTo(3, 9);
  });

  it('only rate laps are samples: no in or out lap, no lap with the lap-classes` neutralised time or more', () => {
    const laps = [
      fuelLap(1, 100, 98),
      fuelLap(2, 98, 97.5, { inLap: true }),
      fuelLap(3, 97.5, 97, { outLap: true }),
      fuelLap(4, 97, 96.5, { scShare: 1 }),
      fuelLap(5, 96.5, 96, { vscShare: 0.5 }),
      fuelLap(6, 96, 94),
    ];
    expect(valueOf(burnPerLapKg(laps, OPTS))).toBeCloseTo(2, 9);
    // under 2 s under SC (the flag lag at a restart) is a sample; the limit is the options'
    const lag = [fuelLap(1, 100, 98), fuelLap(2, 98, 96, { scShare: 0.01 })];
    expect(valueOf(burnPerLapKg(lag, OPTS))).toBeCloseTo(2, 9);
    expect(burnPerLapKg(lag, { ...OPTS, lapClasses: { maxNeutralisedMs: 500 } })).toEqual(insufficient);
  });

  it('a lap whose start or end fuel is unknown is no sample', () => {
    const joined = fuelLap(1, 0, 98, { fuelAtStartKg: unknown('notReceived') });
    expect(burnPerLapKg([joined, fuelLap(2, 98, 96)], OPTS)).toEqual(insufficient);
    const noEnd = fuelLap(2, 98, 0, { fuelAtEndKg: unknown('realism') });
    expect(burnPerLapKg([fuelLap(1, 100, 98), noEnd, fuelLap(3, 96, 94)], OPTS)).toMatchObject({ known: true, value: 2, at: 3000 });
  });

  it('the window and the minimum of samples are the options` (per-lap-rate)', () => {
    // laps 1-5 burn 3 kg, laps 6-8 burn 1 kg: the newest 5 are 3, 3, 1, 1, 1; all 8 have the median 3
    const laps = [...burnLaps(1, 5, 3, 100), ...burnLaps(6, 8, 1, 85)];
    expect(valueOf(burnPerLapKg(laps, OPTS))).toBeCloseTo(1, 9);
    expect(valueOf(burnPerLapKg(laps, { ...OPTS, rate: { window: 8, minSamples: 2 } }))).toBeCloseTo(3, 9);
    // one lap is below the default minimum of 2; two give a burn; a minimum of 3 refuses two
    expect(burnPerLapKg(burnLaps(1, 1, 1.5, 100), OPTS)).toEqual(insufficient);
    expect(valueOf(burnPerLapKg(burnLaps(1, 2, 1.5, 100), OPTS))).toBeCloseTo(1.5, 9);
    expect(burnPerLapKg(burnLaps(1, 2, 1.5, 100), { ...OPTS, rate: { window: 5, minSamples: 3 } })).toEqual(insufficient);
    expect(burnPerLapKg([], OPTS)).toEqual(insufficient);
  });
});
