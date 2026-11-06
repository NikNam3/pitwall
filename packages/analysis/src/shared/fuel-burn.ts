// The one burn rate per lap of a car (contract C43): `fuel`'s `burnKgPerLap` and `degradation`'s stand-in for a rival's
// hidden fuel (spec 4.1) both come from here, so they agree.
import { known, type Kg, type Known, type LapRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { classifyLap, type LapClassOptions } from '../lap-classes/index.ts';
import { perLapGainRate, type GainSample, type RateOptions } from '../per-lap-rate/index.ts';

/** What the burn rate is computed with: `lap-classes`' and `per-lap-rate`'s config. */
export type BurnOptions = { lapClasses: Omit<LapClassOptions, 'isRace'>; rate: RateOptions };

/**
 * The burn per lap of one car's laps (in lap order): the median (`per-lap-rate`) of the own burns (start minus end) of
 * its rate laps (`forRate`, which has no lap-1 rule). Fuel is not tied to the tyre set, and a refuel keeps the window: the
 * burn per lap does not change with the fuel in the car. A lap whose fuel rose was refuelled on the way, and a lap with
 * an unknown start or end has no burn: neither is a sample.
 */
export function burnPerLapKg(laps: readonly DeepReadonly<LapRecord>[], o: BurnOptions): Known<Kg> {
  const classes: LapClassOptions = { ...o.lapClasses, isRace: false };
  const samples: GainSample[] = [];
  for (const l of laps) {
    if (!l.fuelAtStartKg.known || !l.fuelAtEndKg.known || !classifyLap(l, classes).forRate) continue;
    const burn = l.fuelAtStartKg.value - l.fuelAtEndKg.value;
    if (burn >= 0) samples.push({ lap: l.lapNumber, gain: burn, at: l.completedAt });
  }
  const rate = perLapGainRate(samples, o.rate);
  return rate.known ? known(rate.value.perLap as Kg, rate.at) : rate;
}
