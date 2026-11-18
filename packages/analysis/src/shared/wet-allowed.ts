// The wet rule, its one owner (SP4.3e Task 4, spec §4.4 item 4; Task 23a; SP4.3c O3a; C43): inters and wets are
// allowed only where rain can come, the track wet now (`track-wetness`'s `wet`) or rain coming from the given lap on
// by `rain-outlook`'s rule and threshold. `strategy`'s candidates, `pit-window` and `sc-call`'s Box call read it; each
// adapter below only feeds the rule from what its unit holds.
import type { CarId, NoiseCompound, Policy, StartingPoint, TrackWetness } from '@pitwall/domain';
import { startLapOf } from '../race-forecast/index.ts';
import { rainComing, type RainOutlook } from '../rain-outlook/index.ts';

/** The wet compounds: inters and wets. */
const WET: ReadonlySet<string> = new Set<NoiseCompound>(['inter', 'wet']);

/** Whether `compound` is a wet compound (inter or wet). */
export const isWetCompound = (compound: string): boolean => WET.has(compound);

/** The rule's inputs: whether the track is wet now, and whether rain is coming by `rain-outlook`'s rule and threshold. */
export type WetInputs = { wetNow: boolean; rainComing: boolean };

/** The wet rule: inters and wets are allowed only where rain can come (the track wet now, or rain coming). */
export const wetRule = ({ wetNow, rainComing: coming }: WetInputs): boolean => wetNow || coming;

/** Whether a policy (its stops, a free start's `startCompound`) uses a wet compound. */
const usesWet = (p: Pick<Policy, 'stops' | 'startCompound'>): boolean =>
  (p.startCompound !== undefined && isWetCompound(p.startCompound)) || p.stops.some((s) => isWetCompound(s.compound));

/**
 * The wet rule on a starting point from lap `fromLap` on: its wetness (`track-wetness`'s `wet`) and its forecast's
 * chance per lap up to the flag (`rainComing` at `rainPct`); no forecast counts as no rain.
 */
export function wetAllowed(start: StartingPoint, fromLap: number, rainPct: number): boolean {
  const coming = start.weather.known && rainComing(start.weather.value.byLap, fromLap, start.lapsTotal, rainPct);
  return wetRule({ wetNow: start.wetness.wet, rainComing: coming });
}

/** Car `car`'s policy filter on `start`: a policy that starts on or stops for a wet compound only where the wet rule allows it. */
export function allowedPolicy(start: StartingPoint, car: CarId, rainPct: number): (p: Pick<Policy, 'stops' | 'startCompound'>) => boolean {
  const wet = wetAllowed(start, startLapOf(start, car), rainPct);
  return (p) => wet || !usesWet(p);
}

/**
 * The wet rule on the calculators' outputs: `track-wetness`'s `wet` and `rain-outlook`'s first rain (its threshold
 * already applied over the samples ahead); a missing or unknown output counts as dry, no rain.
 */
export function wetAllowedFrom(outlook: RainOutlook | undefined, wetness: TrackWetness | undefined): boolean {
  return wetRule({ wetNow: wetness?.wet.known === true && wetness.wet.value, rainComing: outlook?.firstRain.known === true });
}
