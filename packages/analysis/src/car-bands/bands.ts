// The bands of `car-bands` and the lap they judge, shared with `alarms`, which judges the judged lap's aggregates against them.
import { known, unknown, type BandState, type CarId, type CarState, type Corners, type Known, type LapRecord, type SessionTime, type VisualCompound } from '@pitwall/domain';
import type { DeepReadonly, EngineView } from '@pitwall/engine/readers';
import { classifyLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import type { CAR_BANDS_CONFIG } from './config.ts';

type Config = ReturnType<typeof CAR_BANDS_CONFIG.read>;

/** One band, in the channel's unit (°C or psi). */
export type Band = { lo: number; hi: number };
/** The band of every channel kind the config fixes for one tyre kind; the pressure band is the car's own (`pressureBands`). */
export type Bands = { surface: Band; carcass: Band; brakes: Band; engine: Band };

/** The bands of a tyre kind: inter and wet have their own, every other compound is dry. */
export const bandsFor = (compound: VisualCompound, c: Config): Bands => {
  const tyre =
    compound === 'inter'
      ? { surface: { lo: c.surfaceInterLo, hi: c.surfaceInterHi }, carcass: { lo: c.carcassInterLo, hi: c.carcassInterHi } }
      : compound === 'wet'
        ? { surface: { lo: c.surfaceWetLo, hi: c.surfaceWetHi }, carcass: { lo: c.carcassWetLo, hi: c.carcassWetHi } }
        : { surface: { lo: c.surfaceDryLo, hi: c.surfaceDryHi }, carcass: { lo: c.carcassDryLo, hi: c.carcassDryHi } };
  return { ...tyre, brakes: { lo: c.brakeLo, hi: c.brakeHi }, engine: { lo: 0, hi: c.engineHi } };
};

/**
 * The car's tyre pressure band per corner: its setup's cold pressure minus `pressureBelowSetupPsi` to plus
 * `pressureAboveSetupPsi`. The game sends the setup for the player's car only (`ownCar`, C8): every other car's band is
 * unknown (`notReceived`), and the player's carries its setup's own reason until the setup arrives.
 */
export const pressureBands = (car: DeepReadonly<CarState>, c: Config, at: SessionTime): Known<Corners<Band>> => {
  const setup = car.ownCar?.setup;
  if (setup === undefined) return unknown('notReceived');
  if (!setup.known) return unknown(setup.reason);
  const { fl, fr, rl, rr } = setup.value.tyrePressurePsi;
  const band = (psi: number): Band => ({ lo: psi - c.pressureBelowSetupPsi, hi: psi + c.pressureAboveSetupPsi });
  return known({ fl: band(fl), fr: band(fr), rl: band(rl), rr: band(rr) }, at);
};

/** Where a value is against a band. */
export const stateOf = (value: number, { lo, hi }: Band): BandState => (value < lo ? 'below' : value > hi ? 'above' : 'in');

/**
 * The `weekend-phase` rows of the judged lap (C44), one table part of `car-bands` and `alarms` alike, so both judge the
 * same lap (C43): only the race has the lap-1 rule. `pending` has no span, so no lap-1 rule.
 */
export const JUDGED_LAP_PHASE_ROWS: Record<'practice' | 'qualifying' | 'race' | 'none', { isRace?: true }> = {
  practice: {},
  qualifying: {},
  race: { isRace: true },
  none: {},
};

/** The `classifyLap` options of the judged lap: the session's `weekend-phase` row (a read of `spans:weekend-phase`) and the `lap-classes` config. */
export const judgedLapClasses = (view: EngineView): LapClassOptions => ({
  isRace: behaviourFor({ 'weekend-phase': JUDGED_LAP_PHASE_ROWS }, view).some((row) => row.isRace === true),
  ...LAP_CLASSES_CONFIG.read(view),
});

/**
 * Each car's judged lap (Q1 A): its newest completed lap that is a rate lap (`classifyLap`: no in or out lap, at most a
 * flag lag of SC or VSC) and not lap 1 of a race. A car without one has none. The provisional and confirmed records of a
 * lap share their ranges.
 */
export const judgedLaps = (laps: readonly DeepReadonly<LapRecord>[], classes: LapClassOptions): Map<CarId, DeepReadonly<LapRecord>> => {
  const judged = new Map<CarId, DeepReadonly<LapRecord>>();
  for (const lap of laps) {
    if (!classifyLap(lap, classes).forBands) continue;
    const seen = judged.get(lap.carId);
    if (seen === undefined || lap.lapNumber > seen.lapNumber) judged.set(lap.carId, lap);
  }
  return judged;
};
