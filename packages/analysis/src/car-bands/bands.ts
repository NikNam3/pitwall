// The bands of `car-bands` and the lap they judge.
import { known, unknown, type ActualCompound, type BandState, type CarId, type CarState, type Corners, type Known, type LapRecord, type Range, type SessionTime, type VisualCompound } from '@pitwall/domain';
import type { DeepReadonly, EngineView } from '@pitwall/engine/readers';
import { classifyLap, LAP_CLASSES_CONFIG, lapPhaseRowOf, RACE_LAP_PHASE_ROWS, type LapClassOptions } from '../lap-classes/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import type { CAR_BANDS_CONFIG } from './config.ts';

type Config = ReturnType<typeof CAR_BANDS_CONFIG.read>;

/** One band, in the channel's unit (°C or psi). */
export type Band = { lo: number; hi: number };
/**
 * The band of every channel kind for one car on one tyre: the surface by its tyre kind, the carcass by its actual
 * compound (unknown for a compound without a reference temperature), the pressure per corner by the car's setup on that
 * carcass band (`pressureBands`).
 */
export type Bands = { surface: Band; carcass: Known<Band>; pressure: Known<Corners<Band>>; brakes: Band; engine: Band };

/** The compound of a tyre: its sidewall colour (the surface band's tyre kind) and its actual compound (the carcass band's). */
export type Compound = { visualCompound: VisualCompound; actualCompound: ActualCompound };

/**
 * The game's reference carcass temperature of an actual compound, from the config (C1–C5, inter, wet); every other
 * compound (C0, C6, classic, F2, unknown) has none: `notApplicable`.
 */
export const refTempC = (actual: ActualCompound, c: Config, at: SessionTime): Known<number> => {
  const ref: Partial<Record<ActualCompound, number>> = {
    C1: c.refTempC1C,
    C2: c.refTempC2C,
    C3: c.refTempC3C,
    C4: c.refTempC4C,
    C5: c.refTempC5C,
    inter: c.refTempInterC,
    wet: c.refTempWetC,
  };
  const t = ref[actual];
  return t === undefined ? unknown('notApplicable') : known(t, at);
};

/** The carcass band of an actual compound: its reference temperature minus `carcassBelowRefC` to plus `carcassAboveRefC`. */
const carcassBand = (actual: ActualCompound, c: Config, at: SessionTime): Known<Band> => {
  const ref = refTempC(actual, c, at);
  return ref.known ? known({ lo: ref.value - c.carcassBelowRefC, hi: ref.value + c.carcassAboveRefC }, at) : ref;
};

/** The surface band of a tyre kind: inter and wet have their own, every other compound is a slick. */
const surfaceBand = (visual: VisualCompound, c: Config): Band =>
  visual === 'inter' ? { lo: c.surfaceInterLo, hi: c.surfaceInterHi } : visual === 'wet' ? { lo: c.surfaceWetLo, hi: c.surfaceWetHi } : { lo: c.surfaceDryLo, hi: c.surfaceDryHi };

/** The bands of `car` on `tyre` (`Bands`): the fitted tyre, or the one a judged lap was driven on; `at` stamps the known bands. */
export const bandsFor = (car: DeepReadonly<CarState>, tyre: DeepReadonly<Compound>, c: Config, at: SessionTime): Bands => ({
  surface: surfaceBand(tyre.visualCompound, c),
  carcass: carcassBand(tyre.actualCompound, c, at),
  pressure: pressureBands(car, tyre.actualCompound, c, at),
  brakes: { lo: c.brakeLo, hi: c.brakeHi },
  engine: { lo: 0, hi: c.engineHi },
});

const KELVIN = 273.15;

/**
 * The car's tyre pressure band per corner: its setup's cold pressure on the actual compound's carcass band by the gas
 * law, setup × (Tref − below + 273.15) / (Tref + 273.15) … setup × (Tref + above + 273.15) / (Tref + 273.15). The game
 * sends the setup for the player's car only (`ownCar`, C8): every other car's band is unknown (`notReceived`), and the
 * player's carries its setup's own reason until the setup arrives; a compound without a reference has none
 * (`notApplicable`).
 */
export const pressureBands = (car: DeepReadonly<CarState>, actual: ActualCompound, c: Config, at: SessionTime): Known<Corners<Band>> => {
  const setup = car.ownCar?.setup;
  if (setup === undefined) return unknown('notReceived');
  if (!setup.known) return unknown(setup.reason);
  const ref = refTempC(actual, c, at);
  if (!ref.known) return unknown(ref.reason);
  const t = ref.value + KELVIN;
  const lo = (t - c.carcassBelowRefC) / t;
  const hi = (t + c.carcassAboveRefC) / t;
  const { fl, fr, rl, rr } = setup.value.tyrePressurePsi;
  const band = (psi: number): Band => ({ lo: psi * lo, hi: psi * hi });
  return known({ fl: band(fl), fr: band(fr), rl: band(rl), rr: band(rr) }, at);
};

/**
 * The one number of a lap's range a channel's lap is judged by: its maximum (`peak`, the brakes and the engine), or the
 * middle of min and max (`midRange`, the tyre channels; the lap record keeps no mean).
 */
export type Measure = 'peak' | 'midRange';
export const measured = (range: DeepReadonly<Range>, measure: Measure): number => (measure === 'peak' ? range.max : (range.min + range.max) / 2);

/** Where a value is against a band. */
export const stateOf = (value: number, { lo, hi }: Band): BandState => (value < lo ? 'below' : value > hi ? 'above' : 'in');

/**
 * The `classifyLap` options of the judged lap, the same for `car-bands` and `alarms` (C43): the session's `weekend-phase`
 * row of `RACE_LAP_PHASE_ROWS` (a read of `spans:weekend-phase`; without an open span the phase is pending and reads as
 * the race, `lapPhaseRowOf`, C14) and the `lap-classes` config.
 */
export const judgedLapClasses = (view: EngineView): LapClassOptions => {
  const row = behaviourFor({ 'weekend-phase': RACE_LAP_PHASE_ROWS }, view)[0] ?? lapPhaseRowOf(RACE_LAP_PHASE_ROWS, 'pending');
  return { isRace: row.isRace, ...LAP_CLASSES_CONFIG.read(view) };
};

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
